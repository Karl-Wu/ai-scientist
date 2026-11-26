import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { readConfig } from "../src/config.ts";
import { openDatabase } from "../src/database.ts";

test("a configured PostgreSQL URL wins, and production requires one", () => {
  assert.equal(readConfig({ GATEWAY_DATABASE_URL: "postgres://db/gateway" }).database.kind, "postgres");
  assert.throws(() => readConfig({ NODE_ENV: "production" }), /GATEWAY_DATABASE_URL/);
});

test("development defaults to PGlite and data survives reopening", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "gateway-pglite-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const { database } = readConfig({ GATEWAY_PGLITE_DIR: directory });
  const first = await openDatabase(database);
  try {
    await first.query("CREATE TABLE marker (name text)");
    await first.query("INSERT INTO marker VALUES ($1)", ["persisted"]);
  } finally {
    await first.close();
  }
  const second = await openDatabase(database);
  try {
    assert.deepEqual((await second.query("SELECT name FROM marker")).rows, [{ name: "persisted" }]);
  } finally {
    await second.close();
  }
});
