import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { helperPython } from "../src/helpers-env.ts";
import { runSciHelper } from "../src/api/sci-helpers.ts";
const root = fs.mkdtempSync(path.join(os.tmpdir(), "duckdb-preview-"));
const file = path.join(root, "quoted #data.duckdb");
const available = spawnSync(helperPython(), ["-c", "import duckdb"], { stdio: "ignore" }).status === 0;
beforeAll(() => {
  if (!available) return;
  fs.writeFileSync(path.join(root, "secret.csv"), "secret\nprivate\n");
  const result = spawnSync(helperPython(), ["-c", String.raw`
import duckdb, sys
c=duckdb.connect(sys.argv[1])
c.execute('CREATE SCHEMA "研究"')
c.execute('CREATE TABLE "研究"."quoted""table" AS SELECT 9007199254740993::BIGINT id, \'001\' code, false flag, repeat(\'x\',1000) note')
c.execute('CREATE TABLE main.measurements AS SELECT i, i*0.5 AS measurement FROM range(205) t(i)')
c.execute('CREATE VIEW "研究".local_view AS SELECT * FROM main.measurements')
c.execute("CREATE VIEW main.external_view AS SELECT * FROM read_csv('"+sys.argv[2].replace("'", "''")+"')")
c.close()
`, file, path.join(root, "secret.csv")], { encoding: "utf8" });
  expect(result.status, result.stderr).toBe(0);
});
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));
async function preview(key = "") { return runSciHelper("tables", "summarize", [file, key]); }
describe.runIf(available)("DuckDB read-only previews", () => {
  beforeAll(() => fs.writeFileSync(path.join(root, "secret.csv"), "secret\nprivate\n"));
  it("lists schemas, quoted tables and views; preserves values and file bytes", async () => {
    const before = fs.readFileSync(file);
    // The external view appears in metadata but is not evaluated until selected.
    const result = await preview(JSON.stringify(["main", "measurements"]));
    expect(result.status, result.stderr).toBe(0);
    const data = JSON.parse(result.stdout);
    expect(data.collections).toContain(JSON.stringify(["研究", 'quoted"table']));
    expect(data.collection_labels[JSON.stringify(["研究", "local_view"])]).toContain("[view]");
    expect(data.head).toHaveLength(200);
    expect(data.rows_truncated).toBe(true);
    const quoted = await preview(JSON.stringify(["研究", 'quoted"table']));
    expect(quoted.status, quoted.stderr).toBe(0);
    const row = JSON.parse(quoted.stdout).head[0];
    expect(row.slice(0, 3)).toEqual(["9007199254740993", "001", "false"]);
    expect(row[3]).toHaveLength(512);
    const view = await preview(JSON.stringify(["研究", "local_view"]));
    expect(view.status, view.stderr).toBe(0);
    expect(JSON.parse(view.stdout).head).toHaveLength(200);
    expect(fs.readFileSync(file)).toEqual(before);
  });
  it("rejects external file reads and unlisted selection strings", async () => {
    const blocked = await preview(JSON.stringify(["main", "external_view"]));
    expect(blocked.status, blocked.stderr).toBe(0);
    expect(JSON.parse(blocked.stdout).preview_error).toMatch(/disabled|permission|external/i);
    expect(JSON.parse(blocked.stdout).head).toEqual([]);
    expect((await preview('main.measurements; DROP TABLE measurements')).status).toBe(5);
  });
});
