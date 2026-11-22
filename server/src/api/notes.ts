import type { FastifyInstance } from "fastify";
import { createManualNotePage, getNotePage, listNotePages, reviseNotePage } from "../notes/store.ts";
import { generateNoteDraft } from "../notes/draft.ts";
import { listNoteExperts } from "../notes/experts.ts";
import { SandboxError } from "../sandbox-fs.ts";
import { requireRequestedProject } from "./project-scope.ts";

export async function registerNotesRoutes(app: FastifyInstance): Promise<void> {
  app.get("/notes/experts", async (req, reply) => {
    reply.header("Cache-Control", "no-store");
    try { return { experts: listNoteExperts(requireRequestedProject(req)) }; }
    catch (error) {
      if (error instanceof SandboxError) return reply.code(error.statusCode).send({ detail: error.message });
      throw error;
    }
  });

  app.post<{ Body: unknown }>("/notes/draft", { bodyLimit: 256 * 1024 }, async (req, reply) => {
    reply.header("Cache-Control", "no-store");
    try { return await generateNoteDraft(requireRequestedProject(req), req.body); }
    catch (error) {
      if (error instanceof SandboxError) return reply.code(error.statusCode).send({ detail: error.message });
      throw error;
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
    try { return reviseNotePage(requireRequestedProject(req), req.params.id, req.body); }
    catch (error) {
      if (error instanceof SandboxError) return reply.code(error.statusCode).send({ detail: error.message });
      throw error;
    }
  });
}
