import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { atomicJson } from "../atomic-json.ts";
import { getProject, resolvePaths, type ProjectPaths } from "../projects.ts";
import { apiRelative, isUserVisible, safePath, SandboxError } from "../sandbox-fs.ts";
import { findSessionFile, readEntries, type SessionEntryRow } from "../agent/session-export.ts";
import { isValidSessionId } from "../agent/notebook-store.ts";
import { AGENT_NAME_RE } from "../agent/agent-files.ts";
import { matchesNoteAnchor, parseNoteAnchor, resolveNoteAnchor } from "./source.ts";
import {
  NOTE_PAGE_ID, NOTE_SOURCE_LABELS, NOTE_STATUS_LABELS, NOTE_TYPES, type NoteCitation, type NoteContent, type NoteDraftCredit, type NoteListResult, type NotePage, type NoteSource, type NoteSourceLink, type NoteSummary, type NoteType,
} from "../../../web/src/lib/note-pages.ts";

function notePagesDirectory(paths: ProjectPaths) {
  return safePath(path.join(paths.kadyDir, "note-pages"), paths.sandbox);
}

function notesDir(projectId: string) {
  if (!getProject(projectId)) throw new SandboxError(404, "Project not found");
  return notePagesDirectory(resolvePaths(projectId));
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new SandboxError(400, "Invalid " + label);
  return value as Record<string, unknown>;
}

function text(value: unknown, label: string, max: number, required = false): string {
  if (typeof value !== "string" || value.length > max || (required && !value.trim())) {
    throw new SandboxError(400, "Invalid " + label);
  }
  return required ? value.trim() : value;
}

function normalizeDraftCredit(input: unknown): NoteDraftCredit | undefined {
  if (input === undefined) return undefined;
  const raw = record(input, "note draft credit");
  const expert = text(raw.expert, "expert name", 64, true);
  if (!AGENT_NAME_RE.test(expert)) throw new SandboxError(400, "Invalid note draft credit");
  return { expert };
}

function normalizeContent(raw: Record<string, unknown>, type: NoteType): NoteContent {
  const schema = NOTE_TYPES[type].fields;
  const fields = record(raw.fields, "note fields");
  for (const key of Object.keys(fields)) {
    if (!Object.hasOwn(schema, key)) throw new SandboxError(400, "Unknown field for this note type");
  }
  return {
    title: text(raw.title, "title", 300, true),
    summary: text(raw.summary, "current summary", 32_000),
    fields: Object.fromEntries(Object.keys(fields).map((key) => [key, text(fields[key], key, 4_000)])),
  };
}

function taskSessionFile(projectId: string, sessionId: string): string {
  const file = isValidSessionId(sessionId) ? findSessionFile(resolvePaths(projectId), sessionId) : null;
  if (!file) throw new SandboxError(400, "Source task is unavailable in this project");
  return file;
}

function cite(source: NoteSource, index: number): NoteCitation {
  return { ...source, id: `s${index + 1}` };
}

function normalizeSource(
  projectId: string,
  input: unknown,
  sessionRows: Map<string, SessionEntryRow[]>,
): NoteSource {
  const raw = record(input, "note source");
  if (raw.kind === "pdfAnnotation") return resolveNoteAnchor(projectId, parseNoteAnchor(raw)).source;
  const paths = resolvePaths(projectId);
  const common = { label: text(raw.label, "source label", 300, true), excerpt: text(raw.excerpt, "source excerpt", 4_000) };
  let sessionId: string | undefined;
  let sessionFile: string | null = null;
  if (raw.sessionId !== undefined) {
    sessionId = text(raw.sessionId, "source task", 200, true);
    sessionFile = taskSessionFile(projectId, sessionId);
  }
  switch (raw.kind) {
    case "file": {
      const sourcePath = text(raw.path, "source path", 2_000, true);
      const absolute = safePath(sourcePath, paths.sandbox);
      if (path.isAbsolute(sourcePath) || absolute === paths.sandbox || !isUserVisible(absolute, paths.sandbox)) {
        throw new SandboxError(400, "Source file is outside the visible project files");
      }
      const sha256 = raw.sha256;
      if (sha256 !== undefined && (typeof sha256 !== "string" || !/^[a-f0-9]{64}$/.test(sha256))) {
        throw new SandboxError(400, "Invalid source file digest");
      }
      return { ...common, kind: "file", path: apiRelative(paths.sandbox, absolute), sessionId, sha256 };
    }
    case "task":
    case "message":
    case "tool":
    case "result": {
      if (!sessionId || !sessionFile) throw new SandboxError(400, "Source task is required");
      if (raw.kind === "task") return { ...common, kind: raw.kind, sessionId };
      const rows = sessionRows.get(sessionId) ?? readEntries(sessionFile);
      sessionRows.set(sessionId, rows);
      if (raw.kind === "message") {
        const entryId = text(raw.entryId, "message reference", 500, true);
        if (!rows.some((row) => row.id === entryId && row.type === "message" &&
            (row.message.role === "user" || row.message.role === "assistant"))) {
          throw new SandboxError(400, "Source message is unavailable in this task");
        }
        return { ...common, kind: raw.kind, sessionId, entryId };
      }
      const toolCallId = text(raw.toolCallId, "tool reference", 500, true);
      if (!rows.some((row) => row.type === "message" && row.message.role === "toolResult" &&
          row.message.toolCallId === toolCallId && (raw.kind === "tool" || row.message.toolName === "scientific_result"))) {
        throw new SandboxError(400, "Source tool result is unavailable in this task");
      }
      return { ...common, kind: raw.kind, sessionId, toolCallId };
    }
    default: throw new SandboxError(400, "Invalid source kind");
  }
}

function readPage(dir: string, id: string): NotePage {
  if (!NOTE_PAGE_ID.test(id)) throw new SandboxError(404, "Note page not found");
  let raw: string;
  try {
    raw = fs.readFileSync(safePath(id + ".json", dir), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new SandboxError(404, "Note page not found");
    throw error;
  }

  try {
    const page = JSON.parse(raw) as NotePage;
    if (page.schemaVersion !== 3 || page.id !== id || !Object.hasOwn(NOTE_TYPES, page.type) || page.typeVersion !== 1 ||
        typeof page.organizer !== "string" || !Array.isArray(page.sources) || !Array.isArray(page.revisions) || !page.revisions.length) {
      throw new Error("Invalid saved note page");
    }
    if (page.deletedAt !== undefined && (!Number.isSafeInteger(page.deletedAt) || page.deletedAt <= 0)) {
      throw new Error("Invalid note deletion time");
    }
    if (page.sources.some((source) => !source || typeof source.label !== "string" || !Object.hasOwn(NOTE_SOURCE_LABELS, source.kind))) {
      throw new Error("Invalid saved note source");
    }
    if (page.revisions.some((revision) => !revision || typeof revision.title !== "string" || typeof revision.summary !== "string" ||
        !Number.isSafeInteger(revision.version) || !Number.isFinite(revision.savedAt) || !Object.hasOwn(NOTE_STATUS_LABELS, revision.status) ||
        !revision.fields || typeof revision.fields !== "object" || Array.isArray(revision.fields) ||
        Object.values(revision.fields).some((value) => typeof value !== "string"))) {
      throw new Error("Invalid saved note revision");
    }
    return page;
  } catch {
    throw new SandboxError(422, "Could not read this note page");
  }
}

function sourceLink({ id: _id, excerpt: _excerpt, ...link }: NoteCitation): NoteSourceLink {
  return link;
}

function savePage(dir: string, page: NotePage): NotePage {
  atomicJson(path.join(dir, page.id + ".json"), page);
  return page;
}

// Structured pages from server-side writers require citations and start pending review.
export function createNotePage(projectId: string, input: unknown): NotePage {
  const dir = notesDir(projectId);
  const raw = record(input, "note page");
  if (typeof raw.type !== "string" || !Object.hasOwn(NOTE_TYPES, raw.type)) throw new SandboxError(400, "Unknown note type");
  if (!Array.isArray(raw.sources) || raw.sources.length === 0 || raw.sources.length > 30) throw new SandboxError(400, "A note page needs 1–30 source references");
  const type = raw.type as NoteType;
  const sessionRows = new Map<string, SessionEntryRow[]>();
  const sources = raw.sources.map((source, index) => cite(normalizeSource(projectId, source, sessionRows), index));
  const savedAt = Date.now();
  return savePage(dir, {
    id: randomUUID(),
    schemaVersion: 3,
    type,
    typeVersion: 1,
    organizer: text(raw.organizer, "organizer", 100, true),
    sources,
    revisions: [{ ...normalizeContent(raw, type), version: 1, savedAt, status: "pending" }],
  });
}

export function createManualNotePage(projectId: string, input: unknown): NotePage {
  const dir = notesDir(projectId);
  const raw = record(input, "note page");
  if (raw.task !== undefined && raw.source !== undefined) throw new SandboxError(400, "Select one note source");
  const anchor = raw.source === undefined ? undefined : parseNoteAnchor(raw.source);
  const task = raw.task === undefined ? undefined : record(raw.task, "source task");
  const taskId = task && text(task.id, "source task", 200, true);
  const label = task ? text(task.title ?? "", "source title", 300).trim() || "Source task" : undefined;
  const savedAt = Date.now();
  const draftCredit = normalizeDraftCredit(raw.draftCredit);
  const content = normalizeContent({ title: raw.title, summary: raw.summary === undefined ? "" : raw.summary, fields: {} }, "note");
  let id: string = randomUUID();
  if (raw.requestId !== undefined) {
    const key = text(raw.requestId, "note request id", 32);
    const parts = /^([a-f0-9]{8})([a-f0-9]{4})([a-f0-9]{4})([a-f0-9]{4})([a-f0-9]{12})$/.exec(key);
    if (!parts) throw new SandboxError(400, "Invalid note request id");
    // Reuse the page ID when the browser retries after a lost response.
    id = parts.slice(1).join("-");
    let existing: NotePage | undefined;
    try {
      existing = readPage(dir, id);
    } catch (error) {
      if (!(error instanceof SandboxError) || error.statusCode !== 404) throw error;
    }
    if (existing) {
      const first = existing.revisions[0];
      const source = existing.sources[0];
      const sameSource = anchor ? matchesNoteAnchor(source, anchor) : taskId
        ? source?.kind === "task" && source.sessionId === taskId && source.label === label : !source;
      if (first.status === "saved" && first.title === content.title && first.summary === content.summary &&
          sameSource && JSON.stringify(first.draftCredit) === JSON.stringify(draftCredit)) return existing;
      throw new SandboxError(409, "The request already created a different note page");
    }
  }
  if (taskId) taskSessionFile(projectId, taskId);
  const sources = anchor ? [cite(resolveNoteAnchor(projectId, anchor).source, 0)]
    : taskId && label ? [cite({ kind: "task", sessionId: taskId, label, excerpt: "" }, 0)] : [];
  return savePage(dir, {
    id, schemaVersion: 3, type: "note", typeVersion: 1, organizer: "Created manually", sources,
    revisions: [{ ...content, version: 1, savedAt, status: "saved", ...(draftCredit ? { draftCredit } : {}) }],
  });
}

export function getNotePage(projectId: string, id: string): NotePage {
  return readPage(notesDir(projectId), id);
}

export function readNoteRevision(projectId: string, id: string, version: number) {
  const page = readPage(notesDir(projectId), id);
  const revision = page.revisions.find((candidate) => candidate.version === version);
  if (!revision) throw new SandboxError(404, "Note page revision not found");
  const { title, summary, fields, status } = revision;
  return {
    id, type: page.type, version, latestVersion: page.revisions.at(-1)!.version,
    title, summary, fields, status, sources: page.sources.map(sourceLink),
    ...(page.deletedAt === undefined ? {} : { deletedAt: page.deletedAt }),
  };
}

function* readProjectNotePages(dir: string): Generator<{ id: string; page?: NotePage }> {
  let files: fs.Dirent[];
  try { files = fs.readdirSync(dir, { withFileTypes: true }); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  for (const file of files) {
    if (!file.name.endsWith(".json")) continue;
    const id = file.name.slice(0, -5);
    if (!NOTE_PAGE_ID.test(id)) continue;
    let page: NotePage | undefined;
    try { if (file.isFile()) page = readPage(dir, id); }
    catch { /* Keep other pages readable when this one cannot be loaded. */ }
    yield { id, page };
  }
}

export function exportNotePages(paths: ProjectPaths) {
  const pages: NotePage[] = [];
  const unavailablePageIds: string[] = [];
  for (const { id, page } of readProjectNotePages(notePagesDirectory(paths))) {
    if (page) pages.push(page);
    else unavailablePageIds.push(id);
  }
  return { pages, unavailablePageIds: unavailablePageIds.sort() };
}

export function listNotePages(projectId: string, search = ""): NoteListResult {
  const pages: NoteSummary[] = [];
  let unavailableCount = 0;
  for (const { page } of readProjectNotePages(notesDir(projectId))) {
    if (!page) {
      unavailableCount++;
      continue;
    }
    if (page.deletedAt !== undefined) continue;
    const revision = page.revisions.at(-1)!;
    if (search && ![revision.title, revision.summary,
      ...page.sources.map((source) => source.label), ...Object.values(revision.fields)]
      .some((value) => value.toLowerCase().includes(search))) continue;
    const tasks = [...new Set(page.sources.flatMap((source) => "sessionId" in source && source.sessionId ? [source.sessionId] : []))];
    const primarySource = page.sources[0];
    pages.push({
      id: page.id, type: page.type, version: revision.version, organizer: page.organizer, title: revision.title,
      excerpt: revision.summary.slice(0, 320), savedAt: revision.savedAt, status: revision.status,
      tasks, draftExpert: revision.draftCredit?.expert, sourceCount: page.sources.length,
      source: primarySource ? sourceLink(primarySource) : undefined,
    });
  }
  pages.sort((a, b) => b.savedAt - a.savedAt || a.id.localeCompare(b.id));
  return { pages, unavailableCount };
}

export function updateNotePage(projectId: string, id: string, input: unknown): NotePage {
  const dir = notesDir(projectId);
  const page = readPage(dir, id);
  const raw = record(input, "note update");
  if (raw.action === "restore") {
    const expectedDeletedAt = raw.expectedDeletedAt;
    if (typeof expectedDeletedAt !== "number" || !Number.isSafeInteger(expectedDeletedAt) || expectedDeletedAt <= 0) {
      throw new SandboxError(400, "Invalid note deletion time");
    }
    if (page.deletedAt === undefined) return page;
    if (expectedDeletedAt !== page.deletedAt) throw new SandboxError(409, "This note was deleted again");
    delete page.deletedAt;
    return savePage(dir, page);
  }
  if (raw.action !== "delete" && raw.action !== "review" && raw.action !== "edit") throw new SandboxError(400, "Invalid note action");
  const last = page.revisions.at(-1)!;
  if (raw.expectedVersion !== last.version) throw new SandboxError(409, "This note page has a newer revision");
  if (raw.action === "delete") {
    if (page.deletedAt !== undefined) return page;
    page.deletedAt = Date.now();
    return savePage(dir, page);
  }
  if (page.deletedAt !== undefined) throw new SandboxError(410, "This note page was deleted");
  if (raw.action === "review" && last.status !== "pending") return page;
  const savedAt = Date.now();
  const content = raw.action === "edit" ? normalizeContent(raw, page.type) : last;
  page.revisions.push({
    ...content, version: last.version + 1, savedAt,
    status: raw.action === "review" ? "reviewed" : last.status === "saved" ? "saved" : "pending",
    ...(last.draftCredit ? { draftCredit: last.draftCredit } : {}),
  });
  return savePage(dir, page);
}
