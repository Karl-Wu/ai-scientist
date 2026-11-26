import { PassThrough } from "node:stream";
import type { FastifyInstance } from "fastify";
import type { NoteDraftEvent } from "../../../web/src/lib/note-pages.ts";
import { createManualNotePage, getNotePage, listNotePages, saveNoteBatch, updateNotePage } from "../notes/store.ts";
import { generateNoteCandidates, generateNoteDraft } from "../notes/draft.ts";
import { changeNoteCuration, getNoteCuration, startNoteCuration } from "../notes/curation.ts";
import { SandboxError } from "../sandbox-fs.ts";
import { requireRequestedProject } from "./project-scope.ts";

export async function registerNotesRoutes(app: FastifyInstance): Promise<void> {
  const curation = "/notes/curation/:taskId";
  app.get<{ Params: { taskId: string } }>(curation, (req, reply) => {
    reply.header("Cache-Control", "no-store");
    try { return reply.send(getNoteCuration(requireRequestedProject(req), req.params.taskId)); }
    catch (error) {
      if (error instanceof SandboxError) return reply.code(error.statusCode).send({ detail: error.message });
      throw error;
    }
  });
  app.post<{ Params: { taskId: string }; Body: unknown }>(curation, (req, reply) => {
    reply.header("Cache-Control", "no-store");
    try { return reply.code(202).send(startNoteCuration(requireRequestedProject(req), req.params.taskId, req.body)); }
    catch (error) {
      if (error instanceof SandboxError) return reply.code(error.statusCode).send({ detail: error.message });
      throw error;
    }
  });
  app.patch<{ Params: { taskId: string }; Body: unknown }>(curation, (req, reply) => {
    reply.header("Cache-Control", "no-store");
    try { return changeNoteCuration(requireRequestedProject(req), req.params.taskId, req.body); }
    catch (error) {
      if (error instanceof SandboxError) return reply.code(error.statusCode).send({ detail: error.message });
      throw error;
    }
  });

  app.post<{ Body: unknown }>("/notes/draft", { bodyLimit: 256 * 1024 }, async (req, reply) => {
    reply.header("Cache-Control", "no-store");
    const controller = new AbortController();
    const onClose = () => { if (!reply.raw.writableFinished) controller.abort(); };
    reply.raw.on("close", onClose);
    if (reply.raw.destroyed) controller.abort();
    try {
      const body = req.body;
      const projectId = requireRequestedProject(req);
      const candidates = body && typeof body === "object" && "format" in body && body.format === "candidates";
      const signal = controller.signal;
      if (candidates && req.headers.accept?.split(",").some((value) => value.split(";")[0].trim() === "text/event-stream")) {
        const output = new PassThrough();
        reply.type("text/event-stream; charset=utf-8").header("Cache-Control", "no-store, no-transform")
          .header("X-Accel-Buffering", "no").send(output);
        const send = (event: NoteDraftEvent) => {
          if (!signal.aborted && !output.destroyed) output.write(`data: ${JSON.stringify(event)}\n\n`);
        };
        try {
          const batch = await generateNoteCandidates(projectId, body, { signal, onProgress: (progress) => send({ type: "progress", progress }) });
          send({ type: "result", batch });
        } catch (error) {
          send(error instanceof SandboxError
            ? { type: "error", status: error.statusCode, detail: error.message } : { type: "error", status: 500 });
        } finally {
          output.end();
        }
        return reply;
      }
      return await (candidates ? generateNoteCandidates : generateNoteDraft)(projectId, body, { signal });
    }
    catch (error) {
      if (error instanceof SandboxError) return reply.code(error.statusCode).send({ detail: error.message });
      throw error;
    } finally {
      reply.raw.removeListener("close", onClose);
    }
  });

  app.post<{ Body: unknown }>("/notes", (req, reply) => {
    reply.header("Cache-Control", "no-store");
    try {
      const page = createManualNotePage(requireRequestedProject(req), req.body);
      return reply.code(201).send(page);
    } catch (error) {
      if (error instanceof SandboxError) return reply.code(error.statusCode).send({ detail: error.message });
      throw error;
    }
  });

  app.post<{ Body: unknown }>("/notes/batch", { bodyLimit: 3 * 1024 * 1024 }, (req, reply) => {
    reply.header("Cache-Control", "no-store");
    try { return saveNoteBatch(requireRequestedProject(req), req.body); }
    catch (error) {
      if (error instanceof SandboxError) return reply.code(error.statusCode).send({ detail: error.message });
      throw error;
    }
  });

  app.get<{ Querystring: { q?: string } }>("/notes", (req, reply) => {
    reply.header("Cache-Control", "no-store");
    try {
      const q = req.query.q;
      if (q !== undefined && (typeof q !== "string" || q.length > 300)) throw new SandboxError(400, "Invalid note search");
      return listNotePages(requireRequestedProject(req), q?.trim().toLowerCase());
    }
    catch (error) {
      if (error instanceof SandboxError) return reply.code(error.statusCode).send({ detail: error.message });
      throw error;
    }
  });

  app.get<{ Params: { id: string } }>("/notes/:id", (req, reply) => {
    reply.header("Cache-Control", "no-store");
    try { return getNotePage(requireRequestedProject(req), req.params.id); }
    catch (error) {
      if (error instanceof SandboxError) return reply.code(error.statusCode).send({ detail: error.message });
      throw error;
    }
  });

  app.patch<{ Params: { id: string }; Body: unknown }>("/notes/:id", (req, reply) => {
    reply.header("Cache-Control", "no-store");
    try { return updateNotePage(requireRequestedProject(req), req.params.id, req.body); }
    catch (error) {
      if (error instanceof SandboxError) return reply.code(error.statusCode).send({ detail: error.message });
      throw error;
    }
  });
}
