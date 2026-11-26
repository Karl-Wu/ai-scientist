import { resolve } from "node:path";

export function readConfig(env: NodeJS.ProcessEnv) {
  const databaseUrl = env.GATEWAY_DATABASE_URL?.trim();
  if (!databaseUrl && (env.NODE_ENV === "production" || env.GATEWAY_DATABASE_URL !== undefined)) {
    throw new Error("GATEWAY_DATABASE_URL must be a PostgreSQL URL");
  }
  if (databaseUrl) {
    const database = URL.canParse(databaseUrl) ? new URL(databaseUrl) : undefined;
    if (!database || !["postgres:", "postgresql:"].includes(database.protocol) || !database.hostname) {
      throw new Error("GATEWAY_DATABASE_URL must be a PostgreSQL URL with a host");
    }
  }
  const database = databaseUrl
    ? { kind: "postgres" as const, url: databaseUrl }
    : { kind: "pglite" as const, directory: resolve(env.GATEWAY_PGLITE_DIR?.trim() || ".pglite") };
  const rawPort = env.GATEWAY_PORT ?? "8080";
  const port = Number(rawPort);
  if (!/^\d+$/.test(rawPort) || port < 1 || port > 65535) {
    throw new Error("GATEWAY_PORT must be between 1 and 65535");
  }
  return { database, port, host: env.GATEWAY_HOST ?? "127.0.0.1" };
}
