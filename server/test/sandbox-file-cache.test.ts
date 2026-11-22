import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PROJECTS_ROOT } from "../src/config.ts";
import { buildApp } from "../src/index.ts";
import { ensureProjectExists, resolvePaths } from "../src/projects.ts";

const app = await buildApp();
const target = () => path.join(resolvePaths("default").sandbox, "preview.txt");
const get = (etag?: string) => app.inject({ method: "GET", url: "/sandbox/file?path=preview.txt", headers: { "x-project-id": "default", ...(etag ? { "if-none-match": etag } : {}) } });
beforeEach(() => { fs.rmSync(PROJECTS_ROOT, { recursive: true, force: true }); ensureProjectExists("default"); });
afterAll(async () => { await app.close(); fs.rmSync(PROJECTS_ROOT, { recursive: true, force: true }); });
describe("conditional file previews", () => {
  it("loads full text tables across first-phase formats and rejects oversized inputs", async () => {
    for (const ext of ["tsv", "json", "jsonl", "ndjson"]) {
      const target = path.join(resolvePaths("default").sandbox, `data.${ext}`);
      const getTable = () => app.inject({ method: "GET", url: `/sandbox/file?path=data.${ext}`, headers: { "x-project-id": "default" } });
      fs.writeFileSync(target, " ".repeat(600_000));
      expect((await getTable()).body).toHaveLength(600_000);
      fs.writeFileSync(target, " ".repeat(8_000_001));
      expect((await getTable()).statusCode).toBe(413);
    }
  });
  it("previews paginated research CSVs up to 8 MB while retaining the text limit", async () => {
    const csv = path.join(resolvePaths("default").sandbox, "research.CSV");
    const readCsv = () => app.inject({ method: "GET", url: "/sandbox/file?path=research.CSV", headers: { "x-project-id": "default" } });
    const content = "sample,mass\n" + "penguin,4000\n".repeat(50_000);
    fs.writeFileSync(csv, content);
    expect((await readCsv()).body).toBe(content);
    fs.writeFileSync(csv, Buffer.alloc(8_000_000, 32));
    expect((await readCsv()).statusCode).toBe(200);
    fs.appendFileSync(csv, "x");
    expect((await readCsv()).statusCode).toBe(413);
    fs.writeFileSync(target(), content);
    expect((await get()).statusCode).toBe(413);
  });
  it("gives HTML reports a separate size limit while serving them as inert text", async () => {
    const name = "research.HTM";
    const file = path.join(resolvePaths("default").sandbox, name);
    const preview = () => app.inject({ url: "/sandbox/file?path=" + name });
    const html = "<!doctype html><script type=\"application/json\">" + " ".repeat(658_000) + "</script>";
    fs.writeFileSync(file, html);
    const loaded = await preview();
    expect(loaded.statusCode).toBe(200);
    expect(loaded.headers["content-type"]).toMatch(/^text\/plain/);
    expect(loaded.headers["content-security-policy"]).toMatch(/^sandbox;/);
    expect(loaded.body).toBe(html);
    fs.writeFileSync(file, Buffer.alloc(8_000_001, 32));
    expect((await preview()).statusCode).toBe(413);
  });
  it("saves an edit beyond 5,000 CSV rows and rejects a stale save", async () => {
    const name = "editable.csv";
    const file = path.join(resolvePaths("default").sandbox, name);
    const url = "/sandbox/file?path=" + name;
    const headers = { "x-project-id": "default" };
    const read = () => app.inject({ method: "GET", url, headers });
    const save = (payload: string, revision: string) => app.inject({
      method: "PUT", url,
      headers: { ...headers, "content-type": "text/plain; charset=utf-8", "if-match": revision },
      payload,
    });
    const source = "\uFEFFid,value\r\n" + Array.from({ length: 5_025 }, (_, i) => (i + 1) + ",original\r\n").join("");
    fs.writeFileSync(file, source);
    const initial = await read();
    expect(initial.body).toBe(source);
    const revision = String(initial.headers["x-content-sha256"]);
    expect(revision).toBe(createHash("sha256").update(source).digest("hex"));

    const edited = source.replace("\r\n5001,original\r\n", '\r\n5001,"reviewed, yes"\r\n');
    const response = await save(edited, revision);
    expect(response.statusCode).toBe(200);
    const updated = await read();
    expect(updated.headers["x-content-sha256"]).toBe(response.headers["x-content-sha256"]);
    expect(updated.body).toBe(edited);
    expect(fs.readFileSync(file, "utf8")).toBe(edited);

    const external = edited.replace("\r\n5002,original", "\r\n5002,external");
    fs.writeFileSync(file, external);
    expect((await save(edited, String(updated.headers["x-content-sha256"]))).statusCode).toBe(412);
    expect(fs.readFileSync(file, "utf8")).toBe(external);
  });

  it("bounds the actual read when an external writer grows a file after stat", async () => {
    fs.writeFileSync(target(), "small");
    const open = fs.promises.open;
    const spy = vi.spyOn(fs.promises, "open").mockImplementationOnce(async (filePath, flags, mode) => {
      const handle = await open(filePath, flags, mode);
      const stat = handle.stat.bind(handle);
      vi.spyOn(handle, "stat").mockImplementationOnce(async () => {
        const before = await stat({ bigint: true });
        fs.appendFileSync(target(), Buffer.alloc(600_000));
        return before;
      });
      return handle;
    });
    try { expect((await get()).statusCode).toBe(413); }
    finally { spy.mockRestore(); }
  });
  it("accepts the exact preview limit and rejects directories", async () => {
    fs.writeFileSync(target(), "a".repeat(512_000));
    expect((await get()).body).toHaveLength(512_000);
    fs.rmSync(target());
    fs.mkdirSync(target());
    expect((await get()).statusCode).toBe(404);
  });
  it("returns 304 without a body when unchanged, and invalidates for same-size edits and replacements", async () => {
    fs.writeFileSync(target(), "one");
    const first = await get();
    expect(first.statusCode).toBe(200);
    expect(first.body).toBe("one");
    expect(first.headers["cache-control"]).toBe("private, no-cache");
    const etag = String(first.headers.etag);
    const unchanged = await get(etag);
    expect(unchanged.statusCode).toBe(304);
    expect(unchanged.body).toBe("");
    const times = fs.statSync(target());
    fs.writeFileSync(target(), "two");
    fs.utimesSync(target(), times.atime, times.mtime);
    const changed = await get(etag);
    expect(changed.statusCode).toBe(200);
    expect(changed.body).toBe("two");
    fs.writeFileSync(target() + ".tmp", "new");
    fs.renameSync(target() + ".tmp", target());
    expect((await get(String(changed.headers.etag))).body).toBe("new");
  });
  it("does not let an old validator hide missing or oversized files", async () => {
    fs.writeFileSync(target(), "one");
    const etag = String((await get()).headers.etag);
    fs.writeFileSync(target(), Buffer.alloc(512001));
    expect((await get(etag)).statusCode).toBe(413);
    fs.rmSync(target());
    expect((await get(etag)).statusCode).toBe(404);
  });
});
