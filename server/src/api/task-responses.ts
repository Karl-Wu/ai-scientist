import type { FastifyInstance } from "fastify";
import { activePaths } from "../projects.ts";
import { currentProjectId } from "../scope.ts";
import { claimRun } from "../agent/run-pipeline.ts";
import { schedulerSessionId } from "../agent/scheduler-state.ts";
import { forkAnswer, setAnswerFeedback, taskResponses, TaskResponseError } from "../agent/task-responses.ts";

export function registerTaskResponseRoutes(app: FastifyInstance) {
  app.get<{ Params: { id: string } }>("/sessions/:id/responses", async (req, reply) => {
    reply.header("Cache-Control", "no-store");
    try { return taskResponses(activePaths(), req.params.id); }
    catch (error) { if (error instanceof TaskResponseError) return reply.code(error.status).send({ detail: error.message }); throw error; }
  });
  app.put<{ Params: { id: string; entryId: string }; Body: { feedback?: unknown } }>("/sessions/:id/responses/:entryId/feedback", async (req, reply) => {
    const value = req.body?.feedback;
    if (value !== null && value !== "up" && value !== "down") return reply.code(400).send({ detail: "Invalid feedback" });
    try { setAnswerFeedback(activePaths(), req.params.id, req.params.entryId, value); return { feedback: value }; }
    catch (error) { if (error instanceof TaskResponseError) return reply.code(error.status).send({ detail: error.message }); throw error; }
  });
  app.post<{ Params: { id: string; entryId: string } }>("/sessions/:id/responses/:entryId/fork", async (req, reply) => {
    const paths = activePaths();
    if (req.params.id === schedulerSessionId(paths)) return reply.code(409).send({ detail: "System tasks cannot be branched" });
    const claim = claimRun(currentProjectId(), req.params.id);
    if (!claim) return reply.code(409).send({ detail: "Wait for the task to finish before creating a follow-up task" });
    try { return forkAnswer(paths, req.params.id, req.params.entryId); }
    catch (error) { if (error instanceof TaskResponseError) return reply.code(error.status).send({ detail: error.message }); throw error; }
    finally { claim.release(); }
  });
}
