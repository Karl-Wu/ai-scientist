import fs from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { PROJECTS_ROOT } from "../src/config.ts";
import { resolvePaths } from "../src/projects.ts";
import { readNotebookEntries } from "../src/agent/notebook-store.ts";
import { appendNotebookEntry, recordedResultSnapshot } from "./helpers/notebook-fixtures.ts";
import { lookupSessionResults, resolveNotebookResult, RESULT_SCAN_BYTES } from "../src/agent/notebook-results.ts";

const card = { schemaVersion: 1, kind: "statistical-test", title: "Treatment comparison", tests: [{ name: "Welch t-test", estimate: 2.3, confidenceInterval: [1, 3.6], sampleSize: 100 }] };
function resultRow(toolCallId = "result-1", value: unknown = card, over: object = {}) {
  return JSON.stringify({ type: "message", message: { role: "toolResult", toolName: "scientific_result", toolCallId, details: { scientificResult: value }, content: [], ...over } }) + "\n";
}
function session(id = "source", rows = resultRow(), project = "default", filename = `${id}.jsonl`) {
  const dir = resolvePaths(project).sessionsDir; fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, filename);
  fs.writeFileSync(file, JSON.stringify({ type: "session", id }) + "\n" + rows); return file;
}
async function lookup(project = "default") {
  return (await lookupSessionResults(project, "source", ["result-1"], { bytes: RESULT_SCAN_BYTES })).get("result-1")!;
}
function entry(snapshot?: ReturnType<typeof recordedResultSnapshot>[]) {
  appendNotebookEntry("lead", { id: "observation", type: "observation", title: "Finding", timestamp: 1, role: "agent", results: [{ toolCallId: "result-1", sessionId: "source" }], ...(snapshot ? { resultSnapshots: snapshot } : {}) });
}
beforeEach(() => { fs.rmSync(PROJECTS_ROOT, { recursive: true, force: true }); fs.mkdirSync(PROJECTS_ROOT, { recursive: true }); });

describe("persisted scientific-result references", () => {
  it("resolves the original measurements for a recorded card identity", async () => {
    session();
    const snapshot = recordedResultSnapshot("source", "result-1", card);
    expect(await lookup()).toMatchObject({ status: "available", sha256: snapshot.sha256 });
    entry([snapshot]);
    const result = await resolveNotebookResult("default", "lead", "observation", 0);
    expect(result.status).toBe("available"); expect(result.card).toEqual(card);
    expect(readNotebookEntries("lead")[0]).not.toHaveProperty("card");
  });
  it("does not substitute changed saved results for pinned evidence", async () => {
    session();
    entry([recordedResultSnapshot("source", "result-1", card)]);
    session("source", resultRow("result-1", { ...card, title: "Replacement" }));
    const result = await resolveNotebookResult("default", "lead", "observation", 0);
    expect(result.status).toBe("changed"); expect(result.card).toBeUndefined();
  });
  it("labels unpinned historical references as unverified while showing the currently saved card", async () => {
    session(); entry(); const result = await resolveNotebookResult("default", "lead", "observation", 0);
    expect(result.status).toBe("unverified"); expect(result.card).toEqual(card); expect(result.reason).toMatch(/not pinned/);
  });
  it("never uses model arguments or failed results as canonical scientific results", async () => {
    const fake = JSON.stringify({ type: "message", message: { role: "assistant", content: [{ type: "toolCall", id: "result-1", name: "scientific_result", arguments: card }] } }) + "\n";
    session("source", fake + resultRow("result-1", card, { isError: true }));
    expect((await lookup()).status).toBe("missing");
  });
  it("reports ambiguous ids rather than choosing one of different results", async () => {
    session("source", resultRow() + resultRow("result-1", { ...card, title: "Other" }));
    expect((await lookup()).status).toBe("ambiguous");
  });
  it("isolates projects, session ids and filename suffix collisions", async () => {
    session("xyzsource");
    expect((await lookup()).status).toBe("missing");
    session(); session("source", resultRow("result-1", { ...card, title: "Other project" }), "other");
    const a = await lookup();
    const b = await lookup("other");
    expect(a.sha256).not.toBe(b.sha256);
    session("wrong-header", resultRow(), "default", "source.jsonl");
    expect((await lookup()).status).toBe("unverified");
  });
  it("supports timestamp-prefixed Pi files but rejects ambiguous source files", async () => {
    session("source", resultRow(), "default", "2026-01-01_source.jsonl");
    expect((await lookup()).status).toBe("available");
    session();
    expect((await lookup()).status).toBe("ambiguous");
  });
  it("bounds file and line scans, exposing incomplete verification", async () => {
    const file = session(); fs.truncateSync(file, RESULT_SCAN_BYTES + 1);
    expect(await lookup()).toMatchObject({ status: "unverified", reason: expect.stringMatching(/budget/) });
    session("source", "x".repeat(270_000) + "\n" + resultRow());
    expect((await lookup()).status).toBe("unverified");
    session("source", resultRow().trimEnd());
    expect((await lookup()).status).toBe("unverified");
  });
  it("allows unverified inspection of a located card in a log containing large image rows", async () => {
    const imageRow = JSON.stringify({ type: "message", message: { role: "user", content: [{ type: "image", data: "x".repeat(270_000) }] } }) + "\n";
    session("source", imageRow + resultRow());
    entry();
    const inspected = await resolveNotebookResult("default", "lead", "observation", 0);
    expect(inspected.status).toBe("unverified"); expect(inspected.card).toEqual(card);
    expect(inspected.reason).toMatch(/uniqueness could not be fully verified/);
  });

  it("still rejects changed pinned content when other source rows are incomplete", async () => {
    session();
    entry([recordedResultSnapshot("source", "result-1", card)]);
    session("source", "x".repeat(270_000) + "\n" + resultRow("result-1", { ...card, title: "Replacement" }));
    const result = await resolveNotebookResult("default", "lead", "observation", 0);
    expect(result.status).toBe("changed"); expect(result.card).toBeUndefined();
  });

  it("distinguishes missing/unreadable/malformed references", async () => {
    entry(); expect((await resolveNotebookResult("default", "lead", "observation", 0)).status).toBe("missing");
    session("source", resultRow("result-1", { schemaVersion: 999 }));
    expect((await resolveNotebookResult("default", "lead", "observation", 0)).status).toBe("unverified");
    await expect(resolveNotebookResult("default", "lead", "observation", 12)).rejects.toMatchObject({ statusCode: 400 });
    await expect(resolveNotebookResult("default", "lead", "absent", 0)).rejects.toMatchObject({ statusCode: 404 });
  });
  it("never resolves child-local references against a colliding parent call id", async () => {
    session("lead", resultRow("worker:r"));
    appendNotebookEntry("lead", { id: "child-note", type: "observation", title: "Child finding", timestamp: 1, role: "worker", results: [{ toolCallId: "worker:r", childLocal: true }] });
    const resolved = await resolveNotebookResult("default", "lead", "child-note", 0);
    expect(resolved.status).toBe("unverified"); expect(resolved.card).toBeUndefined();
    expect(resolved.reason).toMatch(/child-local/);
  });
  it.skipIf(process.platform === "win32")("rejects an entire source-directory symlink into another project", async () => {
    session("source", resultRow(), "other");
    const root = resolvePaths("default").sessionsDir; fs.mkdirSync(path.dirname(root), { recursive: true });
    fs.symlinkSync(resolvePaths("other").sessionsDir, root);
    expect((await lookup()).status).toBe("unverified");
  });
});
