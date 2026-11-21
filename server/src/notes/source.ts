import fs from "node:fs";
import path from "node:path";
import { scientificResultFromDetails } from "../agent/scientific-result.ts";
import { findSessionFile, readEntries } from "../agent/session-export.ts";
import { toHistory } from "../agent/session-history.ts";
import { redactText } from "../agent/task-event-recorder.ts";
import { PdfAnnotationStoreError, pdfAnnotationSidecarPath, readPdfAnnotations } from "../pdf-annotations-store.ts";
import { resolvePaths } from "../projects.ts";
import { isUserVisible, isWithin, safePath, SandboxError, toApiPath } from "../sandbox-fs.ts";
import { commandPreview } from "../../../web/src/lib/command-blocks.ts";
import type { NoteAnchor, NoteSource } from "../../../web/src/lib/note-pages.ts";

export function parseNoteAnchor(input: unknown): NoteAnchor {
  if (typeof input !== "object" || input === null || Array.isArray(input)) throw new SandboxError(400, "Invalid note source");
  const source = input as Record<string, unknown>;
  if (source.kind === "file" || source.kind === "pdfAnnotation") {
    const file = source.path;
    if (typeof file !== "string" || !file || file.length > 2_000 || file.includes("\0") || path.isAbsolute(file)) {
      throw new SandboxError(400, "Invalid source path");
    }
    const sourcePath = toApiPath(path.normalize(file));
    if (source.kind === "file") return { kind: "file", path: sourcePath };
    if (!sourcePath.toLowerCase().endsWith(".pdf") || typeof source.annotationId !== "string" ||
        !source.annotationId.trim() || source.annotationId.length > 500 || source.annotationId.includes("\0")) {
      throw new SandboxError(400, "Invalid PDF annotation source");
    }
    return { kind: "pdfAnnotation", path: sourcePath, annotationId: source.annotationId };
  }
  const sessionId = source.sessionId;
  if (typeof sessionId !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/.test(sessionId)) {
    throw new SandboxError(400, "Invalid source task");
  }
  if (source.kind === "message" && typeof source.entryId === "string" && source.entryId.trim() && source.entryId.length <= 500) {
    return { kind: "message", sessionId, entryId: source.entryId };
  }
  if (source.kind === "result" && typeof source.toolCallId === "string" && source.toolCallId.trim() && source.toolCallId.length <= 500) {
    return { kind: "result", sessionId, toolCallId: source.toolCallId };
  }
  throw new SandboxError(400, "Invalid note source");
}

export function matchesNoteAnchor(source: NoteSource | undefined, anchor: NoteAnchor): boolean {
  if (source?.kind !== anchor.kind) return false;
  if (anchor.kind === "file") return source.kind === "file" && source.path === anchor.path;
  if (anchor.kind === "pdfAnnotation") {
    return source.kind === "pdfAnnotation" && source.path === anchor.path && source.annotationId === anchor.annotationId;
  }
  if (source.kind === "pdfAnnotation") return false;
  if (source.sessionId !== anchor.sessionId) return false;
  if (anchor.kind === "message") return source.kind === "message" && source.entryId === anchor.entryId;
  return source.kind === "result" && source.toolCallId === anchor.toolCallId;
}

function existingFile(root: string, file: string, requireVisible = false): string {
  const unavailable = new SandboxError(404, "The selected source is no longer available");
  try {
    const realRoot = fs.realpathSync(root);
    const realFile = fs.realpathSync(file);
    if (!isWithin(realRoot, realFile) || (requireVisible && !isUserVisible(realFile, realRoot)) || !fs.statSync(realFile).isFile()) {
      throw unavailable;
    }
    return realFile;
  } catch (error) {
    if (error instanceof SandboxError || ["ENOENT", "ENOTDIR", "EACCES", "EPERM", "ELOOP"].includes((error as NodeJS.ErrnoException).code ?? "")) throw unavailable;
    throw error;
  }
}

export function resolveNoteAnchor(projectId: string, anchor: NoteAnchor):
  | { source: NoteSource; material: string }
  | { source: NoteSource; file: string } {
  const paths = resolvePaths(projectId);
  if (anchor.kind === "file" || anchor.kind === "pdfAnnotation") {
    const absolute = safePath(anchor.path, paths.sandbox);
    if (!isUserVisible(absolute, paths.sandbox)) throw new SandboxError(403, "Source file is outside the visible project files");
    const file = existingFile(paths.sandbox, absolute, true);
    const label = path.posix.basename(anchor.path).slice(0, 300);
    if (anchor.kind === "file") return { source: { ...anchor, label, excerpt: "" }, file };

    let annotations;
    try {
      existingFile(paths.sandbox, pdfAnnotationSidecarPath(paths.sandbox, anchor.path));
      annotations = readPdfAnnotations(paths.sandbox, anchor.path).doc.annotations;
    } catch (error) {
      if (error instanceof PdfAnnotationStoreError) throw new SandboxError(404, "The selected PDF annotation is unavailable");
      throw error;
    }
    const annotation = annotations.find((item) => item?.id === anchor.annotationId);
    if (!annotation || !Number.isSafeInteger(annotation.page) || annotation.page < 1) {
      throw new SandboxError(404, "The selected PDF annotation is unavailable");
    }
    const highlighted = annotation.type === "highlight" ? annotation.text : "";
    const comment = annotation.type === "highlight" ? annotation.note : annotation.body;
    const excerpts = (limit: number) => [
      typeof highlighted === "string" && highlighted.trim() ? "Highlighted text\n" + highlighted.trim().slice(0, limit) : "",
      typeof comment === "string" && comment.trim() ? "Annotation text\n" + comment.trim().slice(0, limit) : "",
    ].filter(Boolean).join("\n\n");
    const material = excerpts(16_000);
    return { source: { ...anchor, page: annotation.page, label, excerpt: excerpts(1_980) }, material };
  }

  const session = findSessionFile(paths, anchor.sessionId);
  if (!session) throw new SandboxError(404, "Source task is unavailable in this project");
  const file = existingFile(paths.sessionsDir, session);
  if (anchor.kind === "message") {
    // The saved ID identifies a user-visible answer bubble, which can combine
    // text from multiple model messages separated by tool calls.
    const answer = toHistory(file, paths.sandbox).find((item) => item.role === "assistant" && item.entryId === anchor.entryId);
    const material = answer?.frames?.flatMap((frame) => frame.type === "text_delta" ? [String(frame.delta ?? "")] : []).join("").trim();
    if (!material) throw new SandboxError(404, "Source answer is unavailable in this task");
    const label = commandPreview(redactText(material)).replace(/\s+/g, " ").trim().slice(0, 100) || "Answer";
    return { source: { ...anchor, label, excerpt: "" }, material };
  }

  const result = readEntries(file).find((entry) => entry.type === "message" && entry.message.role === "toolResult" &&
    entry.message.toolName === "scientific_result" && entry.message.toolCallId === anchor.toolCallId && !entry.message.isError);
  const card = result?.type === "message" && scientificResultFromDetails(result.message.details);
  if (!card) throw new SandboxError(404, "Source scientific result is unavailable in this task");
  return { source: { ...anchor, label: card.title.slice(0, 300), excerpt: "" }, material: JSON.stringify(card, null, 2) };
}
