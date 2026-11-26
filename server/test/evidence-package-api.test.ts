import fs from "node:fs";
import path from "node:path";
import AdmZip from "adm-zip";
import { beforeEach, afterAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/index.ts";
import { PROJECTS_ROOT } from "../src/config.ts";
import { createProject, resolvePaths } from "../src/projects.ts";
import { appendNotebookEntry } from "./helpers/notebook-fixtures.ts";
import { captureNotebookArtifacts } from "../src/agent/notebook-artifacts.ts";
import { bytesHash } from "../src/evidence/storage.ts";
import { prepareEvidencePackage } from "../src/evidence/packages.ts";
const app = await buildApp();
const base = "/projects/study/notebook/evidence-packages";
const headers = { "x-project-id": "study", origin: "http://localhost:3000" };
beforeEach(async () => {
  fs.rmSync(PROJECTS_ROOT, { recursive: true, force: true }); fs.mkdirSync(PROJECTS_ROOT, { recursive: true }); createProject({ name: "Study", projectId: "study" });
  fs.writeFileSync(path.join(resolvePaths("study").sandbox, "result.txt"), "recorded result");
  appendNotebookEntry("s", { id: "h", type: "hypothesis", role: "agent", timestamp: 1, title: "Question", artifacts: ["result.txt"], artifactSnapshots: await captureNotebookArtifacts("study", ["result.txt"]) }, "study");
});
afterAll(async () => { await app.close(); fs.rmSync(PROJECTS_ROOT, { recursive: true, force: true }); });
const packageRequest = { title: "Review", roots: [{ sessionId: "s", entryId: "h" }], includeArtifacts: true, includeCurrentUnverified: false, includeCommandArguments: false };

describe("evidence-package API", () => {
  it("keeps archived ZIPs downloadable after retiring package writes", async () => {
    const p = await prepareEvidencePackage("study", packageRequest);
    expect(p.manifest.reproduction.status).toBe("not-run");
    expect((await app.inject({ method: "POST", url: `${base}/prepare`, headers, payload: packageRequest })).statusCode).toBe(404);
    expect((await app.inject({ method: "POST", url: `${base}/prune-snapshots`, headers, payload: { confirmed: true } })).statusCode).toBe(404);
    expect((await app.inject({ method: "DELETE", url: `${base}/${p.id}`, headers })).statusCode).toBe(404);
    const paths = resolvePaths("study");
    fs.unlinkSync(path.join(paths.notebookDir, "s.jsonl"));
    fs.writeFileSync(path.join(paths.sandbox, "result.txt"), "later result");
    const denied = await app.inject({ method: "POST", url: `${base}/${p.id}/download`, headers, payload: { digest: p.digest } }); expect(denied.statusCode).toBe(400);
    const download = await app.inject({ method: "POST", url: `${base}/${p.id}/download`, headers, payload: { digest: p.digest, acknowledgeSensitive: true, acknowledgeLimitations: true } });
    expect(download.statusCode).toBe(200); expect(download.headers["content-type"]).toContain("application/zip");
    expect(download.headers["x-content-sha256"]).toBe(p.zipSha256); expect(bytesHash(download.rawPayload)).toBe(p.zipSha256);
    expect(String(download.headers["access-control-expose-headers"])).toContain("X-Content-SHA256");
    expect(new AdmZip(download.rawPayload).readAsText("README.md")).toContain("not a reproduced analysis");
    const list = await app.inject({ method: "GET", url: base, headers }); expect(list.json().packages).toHaveLength(1);
    expect(fs.readFileSync(path.join(paths.sandbox, "result.txt"), "utf8")).toBe("later result");
  });
  it("does not serve another project's packages or accept invalid ids", async () => {
    const p = await prepareEvidencePackage("study", packageRequest); createProject({ name: "Other", projectId: "other" });
    const mismatch = await app.inject({ method: "GET", url: `${base}/${p.id}`, headers: { "x-project-id": "other" } }); expect(mismatch.statusCode).toBe(404);
    const absent = await app.inject({ method: "POST", url: "/projects/missing/notebook/evidence-packages/prepare", headers: { "x-project-id": "missing" }, payload: {} }); expect(absent.statusCode).toBe(404);
    const invalid = await app.inject({ method: "GET", url: `${base}/not-a-package`, headers }); expect(invalid.statusCode).toBe(400);
    const wrongDigest = await app.inject({ method: "POST", url: `${base}/${p.id}/download`, headers, payload: { digest: "wrong", acknowledgeSensitive: true, acknowledgeLimitations: true } }); expect(wrongDigest.statusCode).toBe(409);
  });
});
