/** Server-owned answer feedback and task lineage. Never inserted into model context. */
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import type { ProjectPaths } from "../projects.ts";
import { findSessionFile } from "./session-export.ts";
import { toHistory } from "./session-history.ts";
import { commandPreview } from "../../../web/src/lib/command-blocks.ts";

export type Feedback = "up" | "down" | null;
interface Origin { sessionId: string; entryId: string; inheritedIds: string[]; createdAt: string }
interface Store {
  version: 1;
  origins: Record<string, Origin>;
  feedback: Record<string, Exclude<Feedback, null>>;
}
export class TaskResponseError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
function storePath(paths: ProjectPaths) { return path.join(paths.sandbox, ".kady", "task-responses.json"); }
function readStore(paths: ProjectPaths): Store {
  const file = storePath(paths);
  if (!fs.existsSync(file)) return { version: 1, origins: {}, feedback: {} };
  const data = JSON.parse(fs.readFileSync(file, "utf8")) as Store;
  if (data.version !== 1 || !data.origins || !data.feedback) throw new Error("Invalid task response metadata");
  return data;
}
// All mutations are synchronous and server-owned, so concurrent HTTP requests cannot lose updates.
function saveStore(paths: ProjectPaths, data: Store) {
  const file = storePath(paths);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${randomUUID()}.tmp`;
  try { fs.writeFileSync(temp, JSON.stringify(data), { mode: 0o600 }); fs.renameSync(temp, file); }
  finally { fs.rmSync(temp, { force: true }); }
}
function managerFor(paths: ProjectPaths, id: string) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(id)) throw new TaskResponseError(400, "Invalid task id");
  const file = findSessionFile(paths, id);
  if (!file) throw new TaskResponseError(404, "Task not found");
  return { file, manager: SessionManager.open(file, paths.sessionsDir, paths.sandbox) };
}
function answer(paths: ProjectPaths, id: string, entryId: string) {
  const { file, manager } = managerFor(paths, id);
  const row = manager.getBranch().find((entry) => entry.id === entryId);
  if (row?.type !== "message" || row.message.role !== "assistant" ||
    !["stop", "length"].includes(row.message.stopReason) ||
    !row.message.content.some((part) => part.type === "text" && part.text.trim()) ||
    !toHistory(file).some((message) => message.role === "assistant" && message.entryId === entryId)) {
    throw new TaskResponseError(400, "Select a completed answer");
  }
  return { file, manager };
}
function canonical(data: Store, sessionId: string, entryId: string) {
  const seen = new Set<string>();
  while (data.origins[sessionId]?.inheritedIds.includes(entryId)) {
    if (seen.has(sessionId)) throw new Error("Cyclic task lineage");
    seen.add(sessionId);
    sessionId = data.origins[sessionId].sessionId;
  }
  return `${sessionId}:${entryId}`;
}
function taskName(manager: SessionManager, leafId?: string) {
  if (manager.getSessionName()) return manager.getSessionName()!;
  const firstUser = manager.getBranch(leafId).find((entry) => entry.type === "message" && entry.message.role === "user");
  const prompt = firstUser?.type === "message" && firstUser.message.role === "user" ? firstUser.message.content : "";
  const text = typeof prompt === "string" ? prompt : prompt.filter((part) => part.type === "text").map((part) => part.type === "text" ? part.text : "").join(" ");
  return commandPreview(text).replace(/\s+/g, " ").trim().slice(0, 100) || "Task";
}
function taskLink(paths: ProjectPaths, id: string) {
  const file = findSessionFile(paths, id);
  if (!file) return null;
  const manager = SessionManager.open(file, paths.sessionsDir, paths.sandbox);
  return { id, name: taskName(manager) };
}
export function taskResponses(paths: ProjectPaths, id: string) {
  const { file, manager } = managerFor(paths, id);
  const data = readStore(paths);
  const entries = new Map(manager.getBranch().map((entry) => [entry.id, entry]));
  const responses = toHistory(file).filter((message) => message.role === "assistant" && message.entryId).flatMap((message) => {
    const row = entries.get(message.entryId!);
    if (row?.type !== "message" || row.message.role !== "assistant" || !["stop", "length"].includes(row.message.stopReason)) return [];
    if (!row.message.content.some((part) => part.type === "text" && part.text.trim())) return [];
    const content = (message.frames ?? []).filter((frame) => frame.type === "text_delta").map((frame) => frame.delta ?? "").join("");
    if (!content.trim()) return [];
    const key = canonical(data, id, message.entryId!);
    const children = Object.entries(data.origins).flatMap(([childId, origin]) => {
      if (canonical(data, origin.sessionId, origin.entryId) !== key) return [];
      const link = taskLink(paths, childId);
      return link ? [{ ...link, createdAt: origin.createdAt }] : [];
    });
    return [{ entryId: message.entryId!, content, feedback: data.feedback[key] ?? null, children }];
  });
  const origin = data.origins[id];
  const parent = origin ? taskLink(paths, origin.sessionId) : null;
  return { responses, source: parent && origin ? { ...parent, entryId: origin.entryId, createdAt: origin.createdAt } : null };
}
export function setAnswerFeedback(paths: ProjectPaths, id: string, entryId: string, value: Feedback) {
  answer(paths, id, entryId);
  const data = readStore(paths);
  const key = canonical(data, id, entryId);
  if (value === null) delete data.feedback[key]; else data.feedback[key] = value;
  saveStore(paths, data);
}
export function forkAnswer(paths: ProjectPaths, id: string, entryId: string) {
  const { manager } = answer(paths, id, entryId);
  const data = readStore(paths);
  const baseName = taskName(manager, entryId).slice(0, 100);
  const siblings = Object.values(data.origins).filter((origin) => origin.sessionId === id).length;
  const name = `${baseName} (${siblings + 1})`;
  const branch = manager.getBranch(entryId);
  const pending = new Set<string>();
  for (const entry of branch) {
    if (entry.type !== "message") continue;
    if (entry.message.role === "assistant") for (const part of entry.message.content) if (part.type === "toolCall") pending.add(part.id);
    if (entry.message.role === "toolResult") pending.delete(entry.message.toolCallId);
  }
  if (pending.size) throw new TaskResponseError(409, "Cannot branch an incomplete tool exchange");
  const inheritedIds = branch.map((entry) => entry.id);
  // Use a separate cold manager: SDK branching switches its own file, never the live source session.
  const file = manager.createBranchedSession(entryId);
  if (!file) throw new Error("Could not persist task");
  const childId = manager.getSessionId();
  try {
    manager.appendSessionInfo(name);
    data.origins[childId] = { sessionId: id, entryId, inheritedIds, createdAt: new Date().toISOString() };
    saveStore(paths, data);
  } catch (error) { fs.rmSync(file, { force: true }); throw error; }
  return { id: childId, name };
}
