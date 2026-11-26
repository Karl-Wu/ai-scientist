import { openDatabase } from "./database.ts";
import { buildGateway } from "./app.ts";
import { readConfig } from "./config.ts";

const config = readConfig(process.env);
const database = await openDatabase(config.database);
const app = buildGateway(async () => { await database.query("SELECT 1"); });
app.addHook("onClose", () => database.close());
await app.listen({ host: config.host, port: config.port });
console.info("Gateway listening on port", config.port, "using", config.database.kind);
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => { void app.close(); });
}
