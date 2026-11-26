import fs from "node:fs";
import path from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import { beforeEach, afterEach, describe, expect, it } from "vitest";
import { PROJECTS_ROOT } from "../src/config.ts";
import { createProject, resolvePaths } from "../src/projects.ts";
import { withActiveProject } from "../src/scope.ts";
import { appendNotebookEntry } from "./helpers/notebook-fixtures.ts";
import { previewAnalysisPlan, freezeAnalysisPlan } from "../src/agent/notebook-plans.ts";
import { NotebookRobustnessService } from "../src/agent/notebook-robustness.ts";
import { registerNotebookRobustnessRoutes } from "../src/api/notebook-robustness.ts";
import { DurableModalJobManager } from "../src/modal/manager.ts";
import { RobustnessFakeModal } from "./helpers/robustness-modal.ts";
let app: FastifyInstance;
let manager: DurableModalJobManager;
let service: NotebookRobustnessService;
let fake: RobustnessFakeModal;
let project: string; let planId: string; let head: string;
const source = { sessionId: "s1", entryId: "h1" };
const base = "/sessions/s1/notebook/h1/robustness";
const draft = { title: "Sensitivity", script: "script.py", inputs: ["data.csv"], metric: "difference", unit: "score", nullValue: 0, instance: "cpu-2", timeoutSec: 60, packages: [], specifications: [
  { key: "base", label: "Baseline", rationale: "Original model", seed: 1, parametersJson: "{}" },
  { key: "alt", label: "Alternative", rationale: "Control confounding", seed: 1, parametersJson: "{}" },
] };
function inject(url: string, body?: object, header = project) {
  return withActiveProject(project, () => app.inject({ method: body === undefined ? "GET" : "POST", url, headers: { "x-project-id": header }, ...(body === undefined ? {} : { payload: body }) }));
}
const legacyPreview = () => service.preview(project, source, { draft, planId, expectedPlanHead: head });
beforeEach(async () => {
  fs.rmSync(PROJECTS_ROOT, { recursive: true, force: true }); fs.mkdirSync(PROJECTS_ROOT, { recursive: true });
  project = createProject({ name: "API", projectId: "api-study" }).id;
  appendNotebookEntry("s1", { id: "h1", type: "hypothesis", title: "Question", role: "agent", timestamp: 1 }, project);
  fs.writeFileSync(path.join(resolvePaths(project).sandbox, "script.py"), "# Test only\n"); fs.writeFileSync(path.join(resolvePaths(project).sandbox, "data.csv"), "data");
  const plan = { hypothesis: "Question", primaryOutcome: "Effect", exclusions: "None", model: "Linear", multiplicity: "One", qc: "Complete", stopping: "Fixed", exposureNotes: "Unknown", datasets: ["data.csv"], intent: "exploratory", priorExposure: "unknown" };
  const preview = await previewAnalysisPlan(project, source, { plan, expectedHead: null });
  const history = await freezeAnalysisPlan(project, source, { previewId: preview.id, acknowledgeLocalFreeze: true });
  planId = history.events[0].id; head = history.head!;
  fake = new RobustnessFakeModal(); manager = new DurableModalJobManager(fake.factory); service = new NotebookRobustnessService(manager, () => true);
  app = Fastify();
  app.addHook("onRequest", (_req, _reply, done) => { withActiveProject(project, () => done()); });
  await registerNotebookRobustnessRoutes(app, service);
});
afterEach(async () => { await manager.cancelProject(project); service.dispose(); await app.close(); fs.rmSync(PROJECTS_ROOT, { recursive: true, force: true }); });

describe("robustness API", () => {
  it("retires preview and approval while preserving old batch inspection and cancellation", async () => {
    const input = { draft, planId, expectedPlanHead: head };
    expect((await inject(`${base}/preview`, input)).statusCode).toBe(404);
    const p = await legacyPreview();
    const consent = { digest: p.digest, reviewedScript: true, approveRemote: true, acknowledgeEstimates: true, maxEstimatedUsd: p.totalReservationUsd };
    expect((await inject(`${base}/${p.id}/approve`, consent)).statusCode).toBe(404);
    expect(fake.created).toBe(0);
    const approved = await service.approve(project, source, p.id, consent);
    expect(approved.attempts).toHaveLength(2);
    await Promise.all(p.jobs.map((j) => manager.wait(project, j.jobId, 4000)));
    const list = await inject(base); expect(list.json().workflows).toHaveLength(1);
    expect(list.headers["cache-control"]).toBe("no-store");
    expect(list.json().workflows[0].attempts.every((a: any) => a.resultStatus === "available")).toBe(true);
    const full = await inject(`${base}/${p.id}`); expect(full.json().preview.draft.specifications).toHaveLength(2);
    const cancelled = await inject(`${base}/${p.id}/cancel`, {});
    expect(cancelled.statusCode).toBe(200);
    expect(cancelled.json().cancelled).toBe(true);
  });
  it("does not fall back to another project or accept a workflow through a different source", async () => {
    expect((await inject(base, undefined, "no-such-project")).statusCode).toBe(404);
    const p = await legacyPreview();
    expect((await inject(`/sessions/s1/notebook/other/robustness/${p.id}`)).statusCode).toBe(404);
    expect((await inject(`${base}/../../etc`)).statusCode).not.toBe(200);
    expect(fake.created).toBe(0);
  });
});
