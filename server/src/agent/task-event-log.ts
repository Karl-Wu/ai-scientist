import { randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import * as fs from "node:fs/promises";
import path from "node:path";
import type { ProjectPaths } from "../projects.ts";
import {
  TASK_EVENT_SCHEMA_VERSION,
  type StoredTaskEvent,
  type TaskEvent,
  type TaskEventDraft,
  type TaskEventScope,
} from "./task-events.ts";

export const TASK_TIMELINE_MAX_PAGE = 200;
const MAX_ROW_BYTES = 512 * 1024;
const writes = new Map<string, Promise<unknown>>();
const writeFailures = new Map<string, string>();

interface Checkpoint {
  bytes: number;
  taskSeq: number;
  openRunId: string | null;
  hasGap: boolean;
}

const empty: Checkpoint = { bytes: 0, taskSeq: 0, openRunId: null, hasGap: false };

export function taskEventLogPath(paths: ProjectPaths, sessionId: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(sessionId)) throw new Error("Invalid session id");
  return path.join(paths.runsDir, sessionId, "events.v1.jsonl");
}

export function reportTaskEventWriteFailure(paths: ProjectPaths, scope: TaskEventScope, runId: string, failed: boolean): void {
  const file = taskEventLogPath(paths, scope.sessionId);
  if (!failed) {
    if (writeFailures.get(file) === runId) writeFailures.delete(file);
    return;
  }
  writeFailures.set(file, runId);
  if (writeFailures.size > 256) writeFailures.delete(writeFailures.keys().next().value!);
}

function serialize<T>(file: string, operation: () => Promise<T>): Promise<T> {
  const pending = (writes.get(file) ?? Promise.resolve()).then(operation, operation);
  writes.set(file, pending);
  const release = () => { if (writes.get(file) === pending) writes.delete(file); };
  void pending.then(release, release);
  return pending;
}

function missing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException)?.code === "ENOENT";
}

const checkpointFile = (file: string) => file + ".commit";

async function readCheckpoint(file: string): Promise<Checkpoint | null> {
  try {
    const value: Checkpoint = JSON.parse(await fs.readFile(checkpointFile(file), "utf8"));
    if (!Number.isSafeInteger(value.bytes) || value.bytes < 0 ||
        !Number.isSafeInteger(value.taskSeq) || value.taskSeq < 0 ||
        !(value.openRunId === null || typeof value.openRunId === "string") ||
        typeof value.hasGap !== "boolean") {
      throw new Error("Invalid task event checkpoint");
    }
    return value;
  } catch (error) {
    if (missing(error)) return null;
    throw error;
  }
}

async function fileSize(file: string): Promise<number> {
  try { return (await fs.stat(file)).size; }
  catch (error) { if (missing(error)) return 0; throw error; }
}

async function syncDirectory(dir: string): Promise<void> {
  // Directory handles / fsync are unsupported on some platforms (e.g. Windows).
  try {
    const fd = await fs.open(dir, "r");
    try { await fd.sync(); }
    finally { await fd.close(); }
  } catch {
    // The data file and checkpoint contents themselves are always synced.
  }
}

async function publishCheckpoint(file: string, head: Checkpoint): Promise<void> {
  const dir = path.dirname(file);
  const created = await fs.mkdir(dir, { recursive: true });
  const temporary = checkpointFile(file) + "." + randomUUID() + ".tmp";
  try {
    const manifest = await fs.open(temporary, "wx", 0o600);
    try {
      await manifest.writeFile(JSON.stringify(head));
      await manifest.sync();
    } finally {
      await manifest.close();
    }
    await fs.rename(temporary, checkpointFile(file));
  } catch (error) {
    await fs.rm(temporary, { force: true }).catch(() => {});
    throw error;
  }
  await syncDirectory(dir);
  if (created) {
    for (let parent = path.dirname(dir); parent !== path.dirname(created); parent = path.dirname(parent)) {
      await syncDirectory(parent);
    }
    await syncDirectory(path.dirname(created));
  }
}

/** The checkpoint makes a batch visible atomically, after syncing its bytes. */
async function commit(
  file: string, scope: TaskEventScope, prior: Checkpoint, drafts: readonly TaskEventDraft[],
): Promise<Checkpoint> {
  if (drafts.length === 0) return prior;
  const next = { ...prior };
  const rows = drafts.map((draft) => {
    const event: TaskEvent = { ...draft, ...scope, schemaVersion: TASK_EVENT_SCHEMA_VERSION, taskSeq: ++next.taskSeq };
    if (event.type === "run_started") next.openRunId = event.runId;
    if (event.type === "run_ended" && next.openRunId === event.runId) next.openRunId = null;
    if (event.type === "record_gap") next.hasGap = true;
    const line = JSON.stringify(event) + "\n";
    if (Buffer.byteLength(line) > MAX_ROW_BYTES) throw new Error("Task event exceeds row limit");
    return line;
  });
  const buffer = Buffer.from(rows.join(""));
  const handle = await fs.open(file, "a", 0o600);
  try {
    const { size } = await handle.stat();
    if (size < prior.bytes) throw new Error("Task event log lost committed bytes");
    if (size > prior.bytes) await handle.truncate(prior.bytes);
    await handle.appendFile(buffer);
    await handle.sync();
  } finally {
    await handle.close();
  }
  next.bytes += buffer.length;

  await publishCheckpoint(file, next);
  return next;
}

function repairEvents(head: Checkpoint, size: number, shouldEnd: boolean): TaskEventDraft[] {
  const base = { runId: head.openRunId ?? "unknown", observedAt: Date.now(), source: "recovery" as const };
  const drafts: TaskEventDraft[] = [];
  if (size > head.bytes) {
    drafts.push({ ...base, eventId: randomUUID(), type: "record_gap", payload: { reason: "uncommitted_tail" } });
  }
  if (shouldEnd && head.openRunId) {
    drafts.push({ ...base, eventId: randomUUID(), type: "run_ended", payload: { outcome: "interrupted", reason: "owner_lost" } });
  }
  return drafts;
}

export async function appendTaskEvents(
  paths: ProjectPaths, scope: TaskEventScope, drafts: readonly TaskEventDraft[], startsRun: boolean,
): Promise<number> {
  const file = taskEventLogPath(paths, scope.sessionId);
  return serialize(file, async () => {
    const checkpoint = await readCheckpoint(file);
    const size = await fileSize(file);
    if (!checkpoint) {
      if (size > 0) throw new Error("Task event checkpoint is missing for a non-empty log");
      if (drafts.length === 0) return 0;
      await publishCheckpoint(file, empty);
    }
    const head = checkpoint ?? empty;
    const repairs = repairEvents(head, size, startsRun);
    const failedRun = writeFailures.get(file);
    if (startsRun && failedRun && failedRun !== drafts[0]?.runId) {
      repairs.unshift({ eventId: randomUUID(), runId: failedRun, observedAt: Date.now(),
        source: "recovery", type: "record_gap", payload: { reason: "write_failed" } });
    }
    const next = await commit(file, scope, head, [...repairs, ...drafts]);
    if (startsRun && failedRun && failedRun !== drafts[0]?.runId) writeFailures.delete(file);
    return next.taskSeq;
  });
}

interface TimelineQuery { after: number; limit: number; through?: number }

function decodeRow(line: Buffer, scope: TaskEventScope, seq: number): StoredTaskEvent | null {
  try {
    const event = JSON.parse(line.toString("utf8")) as StoredTaskEvent;
    if (event?.projectId === scope.projectId && event.sessionId === scope.sessionId &&
        event.taskSeq === seq && Number.isInteger(event.schemaVersion) && event.schemaVersion > 0 &&
        typeof event.type === "string" && typeof event.eventId === "string" &&
        typeof event.runId === "string" && Number.isFinite(event.observedAt) &&
        typeof event.source === "string" && "payload" in event) return event;
  } catch {
    // A malformed row stops the readable prefix.
  }
  return null;
}

async function scanEvents(
  file: string, scope: TaskEventScope, head: Checkpoint, through: number,
  visit: (event: StoredTaskEvent) => boolean | void,
): Promise<boolean> {
  if (through === 0) return false;
  if (head.bytes === 0) return true;
  // Scan without loading the entire task or exposing an in-flight append.
  const stream = createReadStream(file, { end: head.bytes - 1 });
  let pending = Buffer.alloc(0);
  let seq = 0;
  for await (const chunk of stream) {
    const buffer = pending.length ? Buffer.concat([pending, chunk as Buffer]) : chunk as Buffer;
    let start = 0;
    let newline: number;
    while ((newline = buffer.indexOf(0x0a, start)) !== -1) {
      if (newline - start > MAX_ROW_BYTES) return true;
      const event = decodeRow(buffer.subarray(start, newline), scope, ++seq);
      if (!event) return true;
      if (visit(event) === false || seq === through) return false;
      start = newline + 1;
    }
    pending = Buffer.from(buffer.subarray(start));
    if (pending.length > MAX_ROW_BYTES) return true;
  }
  return seq < through;
}

/** Recover lazily on first access (or before a newer run starts). Never call Pi. */
function recoverCheckpoint(file: string, scope: TaskEventScope, isActive: () => boolean) {
  return serialize(file, async () => {
    let head = empty;
    let size: number;
    try {
      const checkpoint = await readCheckpoint(file);
      size = await fileSize(file);
      if (!checkpoint) return { head, incomplete: size > 0 };
      head = checkpoint;
    } catch {
      return { head, incomplete: true };
    }
    if (size < head.bytes) return { head, incomplete: true };
    const active = isActive();
    if (!active) {
      const repairs = repairEvents(head, size, true);
      if (repairs.length) {
        try { head = await commit(file, scope, head, repairs); }
        catch { return { head, incomplete: true }; }
      }
    }
    return { head, incomplete: head.hasGap || writeFailures.has(file) || (active && size > head.bytes) };
  });
}

/** Scan one confirmed prefix without retaining message and argument bodies. */
export async function scanTaskTimeline(
  paths: ProjectPaths, scope: TaskEventScope, isActive: () => boolean, visit: (event: StoredTaskEvent) => void,
): Promise<void> {
  const file = taskEventLogPath(paths, scope.sessionId);
  const { head } = await recoverCheckpoint(file, scope, isActive);
  await scanEvents(file, scope, head, head.taskSeq, visit).catch(() => {});
}

export async function readTaskTimeline(
  paths: ProjectPaths, scope: TaskEventScope, query: TimelineQuery, isActive: () => boolean,
) {
  const file = taskEventLogPath(paths, scope.sessionId);
  const { head, incomplete } = await recoverCheckpoint(file, scope, isActive);
  const through = Math.min(query.through ?? head.taskSeq, head.taskSeq);
  const events: StoredTaskEvent[] = [];
  const corrupt = through > query.after && await scanEvents(file, scope, head, through, (event) => {
    if (event.taskSeq > query.after) events.push(event);
    return events.length < query.limit;
  }).catch(() => true);
  const coverage = incomplete || corrupt ? "incomplete"
    : head.taskSeq === 0 ? "legacy"
    : "recorded";
  const last = events.at(-1)?.taskSeq;
  return {
    events,
    coverage,
    committedThrough: head.taskSeq,
    through,
    nextAfter: !corrupt && last !== undefined && last < through ? last : null,
  };
}
