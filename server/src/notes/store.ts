import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { atomicJson } from "../atomic-json.ts";
import { getProject, resolvePaths } from "../projects.ts";
import { isUserVisible, safePath, SandboxError } from "../sandbox-fs.ts";
import { findSessionFile, readEntries, type SessionEntryRow } from "../agent/session-export.ts";
import { isValidSessionId } from "../agent/notebook-store.ts";
import { AGENT_NAME_RE } from "../agent/agent-files.ts";
import { SKILL_NAME_RE } from "../agent/skills.ts";
import { matchesNoteAnchor, parseNoteAnchor, resolveNoteAnchor } from "./source.ts";
import {
  NOTE_PAGE_ID, NOTE_TYPES, type NoteCitation, type NoteContent, type NoteDraftCredit, type NotePage, type NoteRevision, type NoteSource, type NoteSourceLink, type NoteSummary, type NoteType,
} from "../../../web/src/lib/note-pages.ts";

// Keep previously recorded events in their original on-disk revisions.
type StoredRevision = NoteRevision & { timeline?: unknown };
type StoredPage = Omit<NotePage, "revisions"> & { revisions: StoredRevision[] };
type TimelinePage = Omit<StoredPage, "schemaVersion"> & { schemaVersion: 2 };

type LegacyPage = Omit<NotePage, "schemaVersion" | "type" | "sources" | "revisions"> & {
  schemaVersion?: undefined;
  type: Exclude<NoteType, "note"> | "general";
  sources: NoteSource[];
  revisions: (Omit<NoteRevision, "summary"> & { body: string })[];
};

function notesDir(projectId: string) {
  if (!getProject(projectId)) throw new SandboxError(404, "Project not found");
  return path.join(resolvePaths(projectId).kadyDir, "note-pages");
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
  const skill = record(raw.skill, "draft skill");
  const name = text(skill.name, "skill name", 64, true);
  const scope = skill.scope;
  const sha256 = text(skill.sha256, "skill digest", 64, true);
  if (!AGENT_NAME_RE.test(expert) || !SKILL_NAME_RE.test(name) || (scope !== "project" && scope !== "global") || !/^[a-f0-9]{64}$/.test(sha256)) {
    throw new SandboxError(400, "Invalid note draft credit");
  }
  return { expert, skill: { name, scope, sha256 } };
}

function normalizeContent(raw: Record<string, unknown>, type: NoteType): NoteContent {
  const schema = NOTE_TYPES[type].fields;
  const fields = record(raw.fields, "note fields");
  for (const key of Object.keys(fields)) {
    if (!Object.hasOwn(schema, key)) throw new SandboxError(400, "Unknown field for this note type");
  }
  return {
    title: text(raw.title, "title", 300, true),
    summary: text(raw.summary === undefined ? raw.body : raw.summary, "current summary", 32_000),
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
      return { ...common, kind: "file", path: path.relative(paths.sandbox, absolute).split(path.sep).join("/"), sessionId, sha256 };
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

function readPage(dir: string, id: string): StoredPage {
  if (!NOTE_PAGE_ID.test(id)) throw new SandboxError(404, "Note page not found");
  try {
    const page = JSON.parse(fs.readFileSync(path.join(dir, id + ".json"), "utf8")) as StoredPage | TimelinePage | LegacyPage;
    const type = page.schemaVersion === undefined && page.type === "general" ? "note" : page.type;
    if (page.id !== id || !Object.hasOwn(NOTE_TYPES, type) || page.typeVersion !== 1 || !page.revisions?.length) {
      throw new Error("Invalid saved note page");
    }
    if (page.schemaVersion === 3) return page;
    if (page.schemaVersion === 2) return { ...page, schemaVersion: 3 };
    if (page.schemaVersion !== undefined) throw new Error("Unsupported note page schema version");
    return {
      ...page, schemaVersion: 3, type: type as NoteType, sources: page.sources.map(cite),
      revisions: page.revisions.map(({ body, ...revision }) => ({ ...revision, summary: body })),
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new SandboxError(404, "Note page not found");
    throw error;
  }
}

function publicRevision({ timeline: _legacyTimeline, ...revision }: StoredRevision): NoteRevision {
  return revision;
}

function publicPage(page: StoredPage): NotePage {
  return { ...page, revisions: page.revisions.map(publicRevision) };
}

function sourceLink({ id: _id, excerpt: _excerpt, ...link }: NoteCitation): NoteSourceLink {
  return link;
}

function savePage(dir: string, page: StoredPage): NotePage {
  atomicJson(path.join(dir, page.id + ".json"), page);
  return publicPage(page);
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
  const summary = raw.summary === undefined ? raw.body : raw.summary;
  const draftCredit = normalizeDraftCredit(raw.draftCredit);
  const content = normalizeContent({ title: raw.title, summary: summary === undefined ? "" : summary, fields: {} }, "note");
  let id: string = randomUUID();
  if (raw.requestId !== undefined) {
    const key = text(raw.requestId, "note request id", 32);
    const parts = /^([a-f0-9]{8})([a-f0-9]{4})([a-f0-9]{4})([a-f0-9]{4})([a-f0-9]{12})$/.exec(key);
    if (!parts) throw new SandboxError(400, "Invalid note request id");
    // Reuse the page ID when the browser retries after a lost response.
    id = parts.slice(1).join("-");
    let existing: StoredPage | undefined;
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
          sameSource && JSON.stringify(first.draftCredit) === JSON.stringify(draftCredit)) return publicPage(existing);
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
  return publicPage(readPage(notesDir(projectId), id));
}

export function readNoteRevision(projectId: string, id: string, version: number) {
  const page = readPage(notesDir(projectId), id);
  const revision = page.revisions.find((candidate) => candidate.version === version);
  if (!revision) throw new SandboxError(404, "Note page revision not found");
  const { title, summary, fields, status } = revision;
  return {
    id, type: page.type, version, latestVersion: page.revisions.at(-1)!.version,
    title, summary, fields, status, sources: page.sources.map(sourceLink),
  };
}

export function listNotePages(projectId: string, search = ""): NoteSummary[] {
  const dir = notesDir(projectId);
  let files: string[];
  try { files = fs.readdirSync(dir); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  return files.flatMap((file) => {
    if (!file.endsWith(".json") || !NOTE_PAGE_ID.test(file.slice(0, -5))) return [];
    const page = readPage(dir, file.slice(0, -5));
    const revision = page.revisions.at(-1)!;
    if (search && ![revision.title, revision.summary,
      ...page.sources.map((source) => source.label), ...Object.values(revision.fields)]
      .some((value) => value.toLowerCase().includes(search))) return [];
    const tasks = [...new Set(page.sources.flatMap((source) => "sessionId" in source && source.sessionId ? [source.sessionId] : []))];
    const primarySource = page.sources[0];
    return [{
      id: page.id, type: page.type, version: revision.version, organizer: page.organizer, title: revision.title,
      excerpt: revision.summary.slice(0, 320), savedAt: revision.savedAt, status: revision.status,
      tasks, draftExpert: revision.draftCredit?.expert, sourceCount: page.sources.length,
      source: primarySource ? sourceLink(primarySource) : undefined,
    }];
  }).sort((a, b) => b.savedAt - a.savedAt || a.id.localeCompare(b.id));
}

export function reviseNotePage(projectId: string, id: string, input: unknown): NotePage {
  const dir = notesDir(projectId);
  const page = readPage(dir, id);
  const raw = record(input, "note revision");
  const last = publicRevision(page.revisions.at(-1)!);
  if (raw.expectedVersion !== last.version) throw new SandboxError(409, "This note page has a newer revision");
  if (raw.action !== "review" && raw.action !== "edit") throw new SandboxError(400, "Invalid note action");
  if (raw.action === "review" && last.status !== "pending") return publicPage(page);
  const savedAt = Date.now();
  const content = raw.action === "edit" ? normalizeContent(raw, page.type) : last;
  page.revisions.push({
    ...content, version: last.version + 1, savedAt,
    status: raw.action === "review" ? "reviewed" : last.status === "saved" ? "saved" : "pending",
    ...(last.draftCredit ? { draftCredit: last.draftCredit } : {}),
  });
  return savePage(dir, page);
}
