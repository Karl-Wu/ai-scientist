import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { vocabularyCsv } from "./omop.mjs";
import { createHttpServer, KNOWLEDGE_SERVICE_TITLE } from "./server.mjs";
import { openStore } from "./store.mjs";

const command = process.argv[2];
const dbPath = process.env.KADY_KB_DB ?? fileURLToPath(new URL("./data/crf.sqlite", import.meta.url));

if (command === "serve") {
  const pidFile = process.argv[3] === "--pid-file" ? process.argv[4] : undefined;
  if (process.argv.length > 3 && (!pidFile || process.argv.length !== 5)) {
    throw new Error("Usage: node cli.mjs serve [--pid-file path]");
  }
  const host = process.env.KADY_KB_HOST ?? "127.0.0.1";
  const port = Number(process.env.KADY_KB_PORT ?? 8100);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Invalid KADY_KB_PORT.");

  let store;
  const server = createHttpServer({
    store: {
      search: (query, crfTable) => store.search(query, crfTable),
      create: (entry) => store.create(entry),
    },
    writeToken: process.env.KADY_KB_TOKEN,
    readToken: process.env.KADY_KB_READ_TOKEN,
  });
  server.on("error", (error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
  server.once("close", () => store?.close());
  for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, () => server.close());
  server.listen(port, host, () => {
    try {
      // Reserve the service port before migrating so an older listener cannot lose its tables.
      store = openStore(dbPath, { migrateLegacy: true });
      if (pidFile) writeFileSync(pidFile, `${process.pid}\n`, { flag: "wx", mode: 0o600 });
      console.log(`${KNOWLEDGE_SERVICE_TITLE}已启动，MCP 地址为 ${host}:${port}/mcp`);
    } catch (error) {
      console.error(error.message);
      process.exitCode = 1;
      server.close();
    }
  });
} else if (command === "export-omop") {
  const languageId = Number(process.env.KADY_KB_ZH_LANGUAGE_CONCEPT_ID ?? 0);
  if (!Number.isInteger(languageId) || languageId < 0 || languageId > 2_147_483_647) {
    throw new Error("Invalid KADY_KB_ZH_LANGUAGE_CONCEPT_ID.");
  }
  const store = openStore(dbPath);
  try {
    const tables = store.exportVocabulary(languageId);
    const directory = process.argv[3];
    if (directory) {
      mkdirSync(directory, { mode: 0o700 });
      for (const [name, content] of Object.entries(vocabularyCsv(tables))) {
        writeFileSync(join(directory, name), content, { flag: "wx", mode: 0o600 });
      }
    } else {
      console.log(JSON.stringify(tables, null, 2));
    }
  } finally {
    store.close();
  }
} else {
  console.error("Usage: node cli.mjs serve | export-omop [new-output-directory]");
  process.exitCode = 1;
}
