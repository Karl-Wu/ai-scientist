import Fastify from "fastify";

export function buildGateway(checkDatabase: () => Promise<void>) {
  const app = Fastify();
  app.get("/livez", async () => ({ status: "alive" }));
  app.get("/readyz", async (_request, reply) => {
    reply.header("Cache-Control", "no-store");
    try {
      await checkDatabase();
      return { status: "ready" };
    } catch {
      return reply.code(503).send({ status: "unavailable" });
    }
  });
  return app;
}
