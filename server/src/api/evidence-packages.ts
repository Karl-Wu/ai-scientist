import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { requireRequestedProject } from "./project-scope.ts";
import { SandboxError } from "../sandbox-fs.ts";
import { listEvidencePackages, evidencePackageDownload } from "../evidence/packages.ts";
import { EvidencePackageError, readPackage } from "../evidence/storage.ts";
function project(req: FastifyRequest, id: string): string {
  if (requireRequestedProject(req) !== id) throw new SandboxError(404, "Evidence packages must belong to the active project; no fallback was used");
  return id;
}
function fail(reply: FastifyReply, error: unknown) {
  if (error instanceof EvidencePackageError) return reply.code(error.statusCode).send({ detail: error.message, code: error.code });
  if (error instanceof SandboxError) return reply.code(error.statusCode).send({ detail: error.message });
  if ((error as NodeJS.ErrnoException).code === "ENOENT") return reply.code(404).send({ detail: "Package or required source record is unavailable" });
  throw error;
}
export async function registerEvidencePackageRoutes(app: FastifyInstance): Promise<void> {
  const base = "/projects/:projectId/notebook/evidence-packages";
  type Params = { projectId: string; packageId: string };
  app.get<{ Params: Params }>(base, async (req, reply) => {
    reply.header("Cache-Control", "no-store");
    try { return listEvidencePackages(project(req, req.params.projectId)); } catch (e) { return fail(reply, e); }
  });
  app.get<{ Params: Params }>(`${base}/:packageId`, async (req, reply) => {
    reply.header("Cache-Control", "no-store");
    try { return readPackage(project(req, req.params.projectId), req.params.packageId); } catch (e) { return fail(reply, e); }
  });
  app.post<{ Params: Params; Body: unknown }>(`${base}/:packageId/download`, { bodyLimit: 64 * 1024 }, async (req, reply) => {
    reply.header("Cache-Control", "no-store");
    try {
      const { preview, stream } = await evidencePackageDownload(project(req, req.params.projectId), req.params.packageId, req.body);
      reply.header("Content-Disposition", `attachment; filename="evidence-${preview.id}.zip"`);
      reply.header("Content-Length", preview.zipBytes);
      reply.header("ETag", `"${preview.zipSha256}"`);
      reply.header("X-Content-SHA256", preview.zipSha256);
      reply.type("application/zip");
      return reply.send(stream);
    } catch (e) { return fail(reply, e); }
  });
}
