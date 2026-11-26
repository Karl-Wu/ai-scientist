import fs from "node:fs";
import path from "node:path";
import { notebookPath, type NotebookEntry } from "../../src/agent/notebook-store.ts";
import { jsonDigest } from "../../src/canonical-json.ts";
import type { NotebookResultSnapshot } from "../../../web/src/lib/notebook-result-links.ts";

export function appendNotebookEntry(sessionId: string, entry: NotebookEntry, projectId?: string): void {
  const file = notebookPath(sessionId, projectId);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, JSON.stringify(entry) + "\n", "utf-8");
}

export function recordedResultSnapshot(sessionId: string, toolCallId: string, card: unknown): NotebookResultSnapshot {
  return { sessionId, toolCallId, status: "available", sha256: jsonDigest(card) };
}
