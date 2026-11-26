import type { FastifyInstance, FastifyReply } from "fastify";
import { requireRequestedProject } from "./project-scope.ts";
import { SandboxError } from "../sandbox-fs.ts";
import { ModalJobError } from "../modal/types.ts";
import { notebookRobustness, type NotebookRobustnessService } from "../agent/notebook-robustness.ts";

function fail(reply: FastifyReply, error: unknown) {
  if (error instanceof ModalJobError) return reply.code(error.statusCode).send({ detail: error.message, code: error.code });
  if (error instanceof SandboxError) return reply.code(error.statusCode).send({ detail: error.message });
  if ((error as NodeJS.ErrnoException).code === "ENOENT") return reply.code(404).send({ detail: "Required input or workflow record is missing" });
  throw error;
}
export async function registerNotebookRobustnessRoutes(app: FastifyInstance, service: NotebookRobustnessService = notebookRobustness): Promise<void> {
  type Params = { sessionId: string; entryId: string; workflowId: string };
  const base = "/sessions/:sessionId/notebook/:entryId/robustness";
  const source = (p: Params) => ({ sessionId: p.sessionId, entryId: p.entryId });
  app.get<{ Params: Params }>(base, async (req, reply) => {
    reply.header("Cache-Control", "no-store");
    try { return service.list(requireRequestedProject(req), source(req.params)); } catch (e) { return fail(reply, e); }
  });
  app.get<{ Params: Params }>(`${base}/:workflowId`, async (req, reply) => {
    reply.header("Cache-Control", "no-store");
    try { return service.get(requireRequestedProject(req), source(req.params), req.params.workflowId); } catch (e) { return fail(reply, e); }
  });
  app.post<{ Params: Params }>(`${base}/:workflowId/cancel`, async (req, reply) => {
    reply.header("Cache-Control", "no-store");
    try { return await service.cancel(requireRequestedProject(req), source(req.params), req.params.workflowId); } catch (e) { return fail(reply, e); }
  });
}
