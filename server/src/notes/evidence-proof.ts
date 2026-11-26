import fs from "node:fs";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { resolvePaths } from "../projects.ts";
import { safePath, SandboxError } from "../sandbox-fs.ts";
import type { NoteSource } from "../../../web/src/lib/note-pages.ts";

export type EvidenceScope = { sessionId: string; answerId?: string };

function projectKey(projectId: string, create: boolean) {
  // Keep the signing key with project metadata, outside agent-visible files.
  const file = safePath("note-evidence.key", resolvePaths(projectId).root);
  try { return fs.readFileSync(file); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    if (!create) throw new SandboxError(409, "These candidate sources can no longer be verified");
  }
  try { fs.writeFileSync(file, randomBytes(32), { mode: 0o600, flag: "wx" }); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
  return fs.readFileSync(file);
}

function digest(projectId: string, scope: EvidenceScope, expert: string, requestId: string, sources: unknown, create: boolean) {
  return createHmac("sha256", projectKey(projectId, create))
    .update(JSON.stringify([projectId, scope.sessionId, scope.answerId ?? null, expert, requestId, sources]))
    .digest();
}

export function signNoteEvidence(projectId: string, scope: EvidenceScope, expert: string, requestId: string, sources: NoteSource[]) {
  return digest(projectId, scope, expert, requestId, sources, true).toString("hex");
}

export function verifyNoteEvidence(projectId: string, scope: EvidenceScope | undefined, expert: string, requestId: string,
  sources: unknown, proof: unknown): NoteSource[] {
  if (!scope || !Array.isArray(sources) || !sources.length || sources.length > 8 ||
      typeof proof !== "string" || !/^[a-f0-9]{64}$/.test(proof)) {
    throw new SandboxError(409, "These candidate sources can no longer be verified");
  }
  if (!timingSafeEqual(digest(projectId, scope, expert, requestId, sources, false), Buffer.from(proof, "hex"))) {
    throw new SandboxError(409, "These candidate sources can no longer be verified");
  }
  return sources as NoteSource[];
}
