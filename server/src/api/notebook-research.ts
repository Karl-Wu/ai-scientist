import type { FastifyInstance } from "fastify";
import { requireRequestedProject } from "./project-scope.ts";
import { SandboxError } from "../sandbox-fs.ts";
import { readAnalysisPlans } from "../agent/notebook-plans.ts";
import { resolveNotebookResult } from "../agent/notebook-results.ts";
import type { PlanSource } from "../../../web/src/lib/notebook-plans.ts";

export async function registerNotebookResearchRoutes(app: FastifyInstance): Promise<void> {
  type Params = { sessionId: string; entryId: string };
  const base = "/sessions/:sessionId/notebook/:entryId";
  const source = (params: Params): PlanSource => ({ sessionId: params.sessionId, entryId: params.entryId });
  app.get<{ Params: Params }>(`${base}/plans`, async (req, reply) => {
    reply.header("Cache-Control", "no-store");
    try { return readAnalysisPlans(requireRequestedProject(req), source(req.params)); }
    catch (error) { if (error instanceof SandboxError) return reply.code(error.statusCode).send({ detail: error.message }); throw error; }
  });
  app.get<{ Params: Params & { index: string } }>(`${base}/results/:index`, async (req, reply) => {
    reply.header("Cache-Control", "no-store");
    try { return await resolveNotebookResult(requireRequestedProject(req), req.params.sessionId, req.params.entryId, Number(req.params.index)); }
    catch (error) { if (error instanceof SandboxError) return reply.code(error.statusCode).send({ detail: error.message }); throw error; }
  });
}
