import pg from "pg";
import type { readConfig } from "./config.ts";

export async function openDatabase(config: ReturnType<typeof readConfig>["database"]) {
  if (config.kind === "pglite") {
    const { PGlite } = await import("@electric-sql/pglite");
    const db = await PGlite.create(config.directory);
    return {
      query: (sql: string, params?: unknown[]) => db.query(sql, params),
      close: () => db.close(),
    };
  }

  const pool = new pg.Pool({
    connectionString: config.url,
    max: 4,
    connectionTimeoutMillis: 2000,
    query_timeout: 2000,
  });
  pool.on("error", () => console.error("Gateway database connection lost"));
  return {
    query: (sql: string, params?: unknown[]) => pool.query(sql, params),
    close: () => pool.end(),
  };
}
