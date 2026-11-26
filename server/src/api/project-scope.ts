import type { FastifyRequest } from "fastify";
import { SandboxError } from "../sandbox-fs.ts";
import { currentProjectId } from "../scope.ts";

/** Reject an explicit project header if the request hook fell back to another project. */
export function requireRequestedProject(req: FastifyRequest): string {
  const projectId = currentProjectId();
  const requested = req.headers["x-project-id"];
  if (requested !== undefined && requested !== projectId) {
    throw new SandboxError(404, "Requested project is unavailable; no fallback project was used");
  }
  return projectId;
}
