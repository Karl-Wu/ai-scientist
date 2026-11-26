import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { atomicJson } from "../atomic-json.ts";
import { getProject, resolvePaths, type ProjectPaths } from "../projects.ts";
import { apiRelative, isUserVisible, safePath, SandboxError } from "../sandbox-fs.ts";
import { findSessionFile, readEntries, type SessionEntryRow } from "../agent/session-export.ts";
import { isValidSessionId } from "../agent/notebook-store.ts";
import { AGENT_NAME_RE } from "../agent/agent-files.ts";
import { matchesNoteAnchor, parseNoteAnchor, resolveNoteAnchor } from "./source.ts";
import { verifyNoteEvidence, type EvidenceScope } from "./evidence-proof.ts";
import {
  MAX_NOTE_CANDIDATES, NOTE_PAGE_ID, NOTE_SOURCE_LABELS, NOTE_STATUS_LABELS, NOTE_TYPES, type NoteBatchResult, type NoteCitation, type NoteContent, type NoteDraftCredit, type NoteListResult, type NotePage, type NoteSource, type NoteSourceLink, type NoteSummary, type NoteType,
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

export function normalizeContent(raw: Record<string, unknown>, type: NoteType): NoteContent {
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
  const content = normalizeContent({ title: raw.title, summary: raw.summary === undefined ? "" : raw.summary, fields: {} }, "note");
  return createConfirmedPage(dir, raw.requestId === undefined ? randomUUID() : requestPageId(raw.requestId), "note", content,
    normalizeDraftCredit(raw.draftCredit), confirmedSource(projectId, raw));
}

function requestPageId(value: unknown): string {
  const key = text(value, "note request id", 32);
  const parts = /^([a-f0-9]{8})([a-f0-9]{4})([a-f0-9]{4})([a-f0-9]{4})([a-f0-9]{12})$/.exec(key);
  if (!parts) throw new SandboxError(400, "Invalid note request id");
  return parts.slice(1).join("-");
}

export function saveNoteBatch(projectId: string, input: unknown): { results: NoteBatchResult[] } {
  const dir = notesDir(projectId);
  const raw = record(input, "note batch");
  const credit = normalizeDraftCredit(raw.draftCredit);
  if (!credit || !Array.isArray(raw.pages) || raw.pages.length < 1 || raw.pages.length > MAX_NOTE_CANDIDATES) {
    throw new SandboxError(400, "Select one or more candidates and their expert");
  }
  const pages = raw.pages.map((value) => {
    const page = record(value, "note candidate");
    return { page, id: requestPageId(page.requestId), requestId: page.requestId as string };
  });
  if (new Set(pages.map(({ id }) => id)).size !== pages.length) throw new SandboxError(400, "Duplicate note request id");
  const source = confirmedSource(projectId, raw);
  return { results: pages.map(({ page, id, requestId }): NoteBatchResult => {
    try {
      if (typeof page.type !== "string" || !Object.hasOwn(NOTE_TYPES, page.type)) throw new SandboxError(400, "Unknown note type");
      const type = page.type as NoteType;
      const refs = page.sources !== undefined || page.sourceProof !== undefined
        ? verifyNoteEvidence(projectId, source.evidenceScope, credit.expert, requestId, page.sources, page.sourceProof) : [];
      const saved = createConfirmedPage(dir, id, type, normalizeContent(page, type), credit, source, refs);
      return { requestId, status: "saved", page: saved };
    } catch (error) {
      return { requestId, status: "failed", code: error instanceof SandboxError ? error.statusCode : 500 };
    }
  }) };
}

function confirmedSource(projectId: string, raw: Record<string, unknown>) {
  if (raw.task !== undefined && raw.source !== undefined) throw new SandboxError(400, "Select one note source");
  const anchor = raw.source === undefined ? undefined : parseNoteAnchor(raw.source);
  const task = raw.task === undefined ? undefined : record(raw.task, "source task");
  const taskId = task && text(task.id, "source task", 200, true);
  const label = task ? text(task.title ?? "", "source title", 300).trim() || "Source task" : undefined;
  let sources: NoteCitation[] | undefined;
  const evidenceScope: EvidenceScope | undefined = taskId ? { sessionId: taskId } : anchor?.kind === "message"
    ? { sessionId: anchor.sessionId, answerId: anchor.entryId } : undefined;
  return {
    evidenceScope,
    matches(source: NoteSource | undefined) {
      if (anchor) return matchesNoteAnchor(source, anchor);
      return taskId ? source?.kind === "task" && source.sessionId === taskId && source.label === label : !source;
    },
    resolve() {
      if (sources) return sources;
      if (taskId) taskSessionFile(projectId, taskId);
      sources = anchor ? [cite(resolveNoteAnchor(projectId, anchor).source, 0)]
        : taskId && label ? [cite({ kind: "task", sessionId: taskId, label, excerpt: "" }, 0)] : [];
      return sources;
    },
  };
}

function createConfirmedPage(dir: string, id: string, type: NoteType, content: NoteContent,
  draftCredit: NoteDraftCredit | undefined, source: ReturnType<typeof confirmedSource>, refs: NoteSource[] = []): NotePage {
  // The request ID continues to identify the original write after revisions or a lost response.
  let existing: NotePage | undefined;
  try {
    existing = readPage(dir, id);
  } catch (error) {
    if (!(error instanceof SandboxError) || error.statusCode !== 404) throw error;
  }
  if (existing) {
    const first = existing.revisions[0];
    if (existing.type === type && first.status === "saved" &&
        isDeepStrictEqual(content, { title: first.title, summary: first.summary, fields: first.fields }) &&
        source.matches(existing.sources[0]) && isDeepStrictEqual(first.draftCredit, draftCredit) &&
        isDeepStrictEqual(existing.sources.slice(1), refs.map((ref, index) => cite(ref, index + 1)))) return existing;
    throw new SandboxError(409, "The request already created a different note page");
  }
  return savePage(dir, {
    id, schemaVersion: 3, type, typeVersion: 1, organizer: "Created manually",
    sources: [...source.resolve(), ...refs.map((ref, index) => cite(ref, index + 1))],
    revisions: [{ ...content, version: 1, savedAt: Date.now(), status: "saved", ...(draftCredit ? { draftCredit } : {}) }],
  });
}

export function getNotePage(projectId: string, id: string): NotePage {
  return readPage(notesDir(projectId), id);
}

export function savedCandidatePages(projectId: string, candidates: readonly { requestId: string }[]): NotePage[] {
  const dir = notesDir(projectId);
  return candidates.flatMap(({ requestId }) => {
    try { return [readPage(dir, requestPageId(requestId))]; }
    catch (error) {
      if (error instanceof SandboxError && [404, 422].includes(error.statusCode)) return [];
      throw error;
    }
  });
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
