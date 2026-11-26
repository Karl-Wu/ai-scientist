import fs from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "../src/index.ts";
import { PROJECTS_ROOT } from "../src/config.ts";
import { ensureProjectExists } from "../src/projects.ts";
import { appendNotebookEntry } from "./helpers/notebook-fixtures.ts";
import {
  appendStep,
  PROVENANCE_SCHEMA_VERSION,
  type ArtifactRef,
  type ProvenanceStep,
} from "../src/provenance/store.ts";

const app = await buildApp();

beforeEach(() => {
  fs.rmSync(PROJECTS_ROOT, { recursive: true, force: true });
  fs.mkdirSync(PROJECTS_ROOT, { recursive: true });
});

afterAll(async () => {
  await app.close();
  fs.rmSync(PROJECTS_ROOT, { recursive: true, force: true });
});

const step = (over: Partial<ProvenanceStep> = {}): ProvenanceStep => ({
  schemaVersion: PROVENANCE_SCHEMA_VERSION,
  id: "tc_1",
  sessionId: "sess-a",
  timestamp: 1_000,
  toolName: "bash",
  role: "agent",
  inputs: [],
  outputs: [],
  ...over,
});

function get(url: string, projectId = "default") {
  return app.inject({ method: "GET", url, headers: { "x-project-id": projectId } });
}

describe("GET /sandbox/file-origin", () => {
  function ref(file: string, content: string, change: ArtifactRef["change"] = "created"): ArtifactRef {
    return { path: file, sha256: createHash("sha256").update(content).digest("hex"), size: content.length, mtimeMs: 1, change, confidence: "observed" };
  }

  function write(file: string, content: string) {
    fs.writeFileSync(path.join(ensureProjectExists("default").sandbox, file), content);
  }

  function origin(file: string, query: Record<string, string> = {}) {
    return get(`/sandbox/file-origin?${new URLSearchParams({ path: file, ...query })}`);
  }

  it("finds the original writing step through successive editor saves and a no-op save", async () => {
    write("result.csv", "v1");
    appendStep(step({ toolName: "write", outputs: [ref("result.csv", "v1")] }), "default");
    const clock = vi.spyOn(Date, "now");
    try {
      for (const [index, content] of ["v2", "v3", "v3"].entries()) {
        clock.mockReturnValue(2_000 + index);
        const save = await app.inject({
          method: "PUT", url: "/sandbox/file?path=result.csv", payload: content,
          headers: { "x-project-id": "default", "content-type": "text/plain" },
        });
        expect(save.statusCode).toBe(200);
      }
    } finally {
      clock.mockRestore();
    }
    const response = await origin("result.csv");
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body).toMatchObject({ status: "edited", source: { stepId: "tc_1", sessionId: "sess-a" } });
    expect(body.history.map((entry: { toolName: string }) => entry.toolName)).toEqual(["save", "save", "save", "write"]);
  });

  it("selects the current same-name overwrite and labels an inferred scan", async () => {
    write("result.csv", "new results");
    appendStep(step({ toolName: "write", outputs: [ref("result.csv", "old results")] }), "default");
    appendStep(step({
      id: "tc_2", sessionId: "sess-b", runId: "run_b", timestamp: 2_000,
      outputs: [{ ...ref("result.csv", "new results", "modified"), confidence: "inferred", via: "sandbox-scan" }],
    }), "default");
    expect((await origin("result.csv")).json()).toMatchObject({
      status: "matched",
      source: { stepId: "tc_2", sessionId: "sess-b", runId: "run_b", evidence: "scan-inferred" },
      history: [{ stepId: "tc_2" }, { stepId: "tc_1", evidence: "recorded" }],
    });
    write("result.csv", "changed outside the application");
    const changed = (await origin("result.csv")).json();
    expect(changed).toMatchObject({ status: "changed", lastKnown: { stepId: "tc_2" } });
    expect(changed).not.toHaveProperty("source");
  });

  it("resolves an intermediate file to the version used by a specific downstream step", async () => {
    write("cleaned.csv", "new");
    write("result.csv", "result");
    appendStep(step({
      id: "clean-v1", runId: "run_a", toolName: "write", timestamp: 1_000,
      inputs: [ref("raw.xlsx", "raw", "read")], outputs: [ref("cleaned.csv", "old")],
    }), "default");
    appendStep(step({
      id: "make-result", runId: "run_a", startedAt: 2_000, timestamp: 2_100,
      inputs: [{ ...ref("cleaned.csv", "old", "read"), confidence: "inferred" }], outputs: [ref("result.csv", "result")],
    }), "default");
    appendStep(step({
      id: "clean-v2", sessionId: "sess-b", timestamp: 3_000,
      outputs: [ref("cleaned.csv", "new", "modified")],
    }), "default");

    expect((await origin("result.csv")).json().source.inputs).toEqual([{ path: "cleaned.csv", confidence: "inferred" }]);
    expect((await origin("cleaned.csv")).json().source).toMatchObject({ stepId: "clean-v2", evidence: "scan" });
    const consumer = { sessionId: "sess-a", stepId: "make-result", runId: "run_a" };
    expect((await origin("cleaned.csv", consumer)).json()).toMatchObject({
      status: "historical", changedSinceUse: true, inputConfidence: "inferred",
      source: { stepId: "clean-v1", inputs: [{ path: "raw.xlsx" }] }, history: [{ stepId: "clean-v1" }],
    });
    const unrelated = (await origin("cleaned.csv", { ...consumer, runId: "wrong" })).json();
    expect(unrelated).toEqual({ status: "unknown", changedSinceUse: null, history: [] });

    appendStep(step({
      id: "different-write", timestamp: 1_900, toolName: "write",
      outputs: [ref("cleaned.csv", "different bytes", "modified")],
    }), "default");
    const inconsistent = (await origin("cleaned.csv", consumer)).json();
    expect(inconsistent.status).toBe("unknown");
    expect(inconsistent).not.toHaveProperty("source");
  });

  it("keeps old files readable and guards invalid or private source paths", async () => {
    write("old.csv", "old content");
    expect((await origin("old.csv")).json()).toEqual({ status: "unrecorded", changedSinceUse: null, history: [] });
    expect((await origin("old.csv", { sessionId: "sess-a" })).statusCode).toBe(400);
    expect((await origin(".kady/private.json")).statusCode).toBe(403);
    expect((await origin("../other/old.csv")).statusCode).toBe(403);
  });

  it("never resolves a source written in a different project", async () => {
    write("result.csv", "same bytes");
    ensureProjectExists("other");
    appendStep(step({ toolName: "write", outputs: [ref("result.csv", "same bytes")] }), "other");
    expect((await origin("result.csv")).json()).toEqual({ status: "unrecorded", changedSinceUse: null, history: [] });
  });
});

describe("GET /sandbox/provenance", () => {
  it("returns the producing step and a current verdict for a matching hash", async () => {
    const paths = ensureProjectExists("default");
    fs.writeFileSync(path.join(paths.sandbox, "fig.png"), "PNG");
    // Deliberately NOT sha256("PNG"): the route must hash the file itself and
    // report the mismatch, not echo back whatever the record claims.
    const sha = "d8bb0e0d1d1e2a1a5b1e7cb4a1f2d2f4e4c0e2b9c2c17d1c4f6f5ba1a1c7e4d1";
    appendStep(
      step({
        outputs: [
          {
            path: "fig.png",
            sha256: sha,
            size: 3,
            mtimeMs: 1,
            change: "created",
            confidence: "observed",
          },
        ],
      }),
      "default",
    );

    const res = await get("/sandbox/provenance?path=fig.png");
    expect(res.statusCode).toBe(200);
    expect(res.headers["cache-control"]).toBe("no-store");
    const body = res.json();
    expect(body.exists).toBe(true);
    expect(body.producedBy.map((s: ProvenanceStep) => s.id)).toEqual(["tc_1"]);
    // The stored hash is deliberately wrong for these bytes, so the route must
    // report drift rather than trusting the record.
    expect(body.staleness).toBe("stale");
  });

  it("includes notebook citations and flags ones that predate the latest output", async () => {
    const paths = ensureProjectExists("default");
    fs.writeFileSync(path.join(paths.sandbox, "fig.png"), "PNG");
    appendNotebookEntry(
      "sess-a",
      {
        id: "nb_1",
        type: "observation",
        title: "Six clusters",
        timestamp: 1,
        role: "agent",
        artifacts: ["fig.png"],
      },
      "default",
    );
    appendStep(
      step({
        id: "regen",
        timestamp: 9_000,
        outputs: [
          { path: "fig.png", size: 3, mtimeMs: 1, change: "modified", confidence: "observed" },
        ],
      }),
      "default",
    );

    const body = (await get("/sandbox/provenance?path=fig.png")).json();
    expect(body.citedBy).toHaveLength(1);
    expect(body.citedBy[0].precedesLatestOutput).toBe(true);
  });

  it("returns an empty record for a file with no recorded provenance", async () => {
    const paths = ensureProjectExists("default");
    fs.writeFileSync(path.join(paths.sandbox, "uploaded.csv"), "a,b\n");
    const body = (await get("/sandbox/provenance?path=uploaded.csv")).json();
    expect(body.producedBy).toEqual([]);
    expect(body.citedBy).toEqual([]);
    expect(body.staleness).toBe("unknown");
    expect(body.exists).toBe(true);
  });

  it("scopes lookups to the requesting project", async () => {
    ensureProjectExists("default");
    const other = ensureProjectExists("other");
    fs.writeFileSync(path.join(other.sandbox, "fig.png"), "PNG");
    appendStep(
      step({
        outputs: [
          { path: "fig.png", size: 3, mtimeMs: 1, change: "created", confidence: "observed" },
        ],
      }),
      "other",
    );

    const mine = (await get("/sandbox/provenance?path=fig.png", "other")).json();
    expect(mine.producedBy).toHaveLength(1);

    const theirs = (await get("/sandbox/provenance?path=fig.png", "default")).json();
    expect(theirs.producedBy).toEqual([]);
  });

  it("rejects a missing path parameter", async () => {
    ensureProjectExists("default");
    const res = await get("/sandbox/provenance");
    expect(res.statusCode).toBe(400);
  });

  it("refuses traversal outside the sandbox", async () => {
    ensureProjectExists("default");
    const res = await get("/sandbox/provenance?path=../../etc/passwd");
    expect(res.statusCode).toBe(403);
  });

  it("refuses a hidden internal path", async () => {
    ensureProjectExists("default");
    const res = await get("/sandbox/provenance?path=.kady/provenance/sess-a/steps.jsonl");
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
  });
});
