import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import Fastify from "fastify";
import { expect, it, vi } from "vitest";
import { appendTaskEvents } from "../src/agent/task-event-log.ts";
import type { TaskEventDraft } from "../src/agent/task-events.ts";
import { registerNotesRoutes } from "../src/api/notes.ts";
import { openCurationModel } from "../src/notes/curation-model.ts";
import { buildTaskRecords } from "../src/notes/task-records.ts";
import { ensureProjectExists } from "../src/projects.ts";
import { withActiveProject } from "../src/scope.ts";
import type { NoteCurationStatus, NoteType } from "../../web/src/lib/note-pages.ts";

vi.mock("../src/notes/curation-model.ts", () => ({ openCurationModel: vi.fn() }));

const task = "complete-curation";
const expert = "research-note-curator";

async function notesApp(projectId: string, taskId: string) {
  const app = Fastify();
  app.addHook("onRequest", (_request, _reply, done) => withActiveProject(projectId, () => done()));
  await registerNotesRoutes(app);
  const url = "/notes/curation/" + taskId;
  const status = async () => (await app.inject(url)).json<NoteCurationStatus | null>();
  const start = async () => {
    const response = await app.inject({ method: "POST", url, payload: { expert, model: "ollama/local-fixture" } });
    expect(response.statusCode).toBe(202);
    return response.json<NoteCurationStatus>();
  };
  const change = async (id: string, action: "resume" | "cancel") => {
    const response = await app.inject({ method: "PATCH", url, payload: { id, action } });
    expect(response.statusCode).toBe(200);
  };
  const until = async (state: NoteCurationStatus["state"]) => vi.waitFor(async () => {
    const job = await status();
    expect(job?.state).toBe(state);
    return job!;
  }, { timeout: 30_000, interval: 25 });
  return { app, status, start, change, until };
}

interface ModelRecord {
  id: string;
  label: string;
  kind: string;
  text: string;
}
function draft(note: ModelRecord, type: NoteType, title: string, summary = title) {
  return { type, title, summary, fields: {}, recordIds: [note.id] };
}

it("resumes reading and merging, keeps hidden material and saves confirmed pages with evidence", async () => {
  const project = ensureProjectExists("complete-curation-test");
  fs.mkdirSync(project.sessionsDir, { recursive: true });
  fs.writeFileSync(path.join(project.sandbox, "private.txt"), "Unreferenced private file.");
  const long = "段😀".repeat(2_800);
  const rows = [
    { type: "message", id: "prompt", message: { role: "user", timestamp: 1, content: [{ type: "text", text: "Review the output." }] } },
    { type: "message", id: "answer", message: { role: "assistant", timestamp: 2, errorMessage: "Provider stopped mid-request", content: [
      { type: "thinking", thinking: "Saved private reasoning" }, { type: "thinking", thinking: "Opaque text", redacted: true },
      { type: "toolCall", id: "check-1", name: "bash", arguments: { credential: "fixture-secret", cmd: "echo fixture" } },
    ] } },
    { type: "message", message: { role: "toolResult", timestamp: 3, toolCallId: "check-1", toolName: "bash",
      content: [{ type: "text", text: long }] } },
    { type: "compaction", timestamp: new Date(4).toISOString(), summary: "Hidden compaction summary." },
    { type: "custom_message", timestamp: new Date(5).toISOString(), customType: "audit", display: false, content: "Hidden audit." },
    { type: "context_edit", timestamp: new Date(6).toISOString(), targetId: "answer", replacement: null },
    { type: "message", id: "done", message: { role: "assistant", timestamp: 7, content: [{ type: "text", text: "Decided to rerun." }] } },
  ];
  const session = path.join(project.sessionsDir, task + ".jsonl");
  fs.writeFileSync(session, rows.map((row) => JSON.stringify(row)).join("\n") + "\nthis row is malformed\n");
  const event = { runId: "example", observedAt: 8, source: "server" as const };
  const events: TaskEventDraft[] = [
    { ...event, eventId: randomUUID(), type: "run_ended", payload: { outcome: "failed" } },
    { ...event, eventId: randomUUID(), type: "record_gap", payload: { reason: "capture_failed" } },
  ];
  await appendTaskEvents(project, { projectId: project.id, sessionId: task }, events);
  let failRead = true;
  let failMerge = true;
  const successful = new Map<string, ModelRecord>();
  const request = vi.fn(async (_system: string, input: unknown) => {
    const { records, drafts } = input as { records?: ModelRecord[]; drafts?: { id: number }[] };
    if (drafts) {
      if (failMerge) {
        failMerge = false;
        throw new Error("Independent merge failure");
      }
      return { groups: [{ ids: drafts.map(({ id }) => id), title: "Consolidated audit", summary: "Merged related audit findings." }] };
    }
    if (!records) throw new Error("Missing test records");
    if (failRead && successful.size) {
      failRead = false;
      throw new Error("Independent read failure");
    }
    for (const record of records) {
      expect(successful.has(record.id)).toBe(false);
      successful.set(record.id, record);
    }
    return { candidates: records.flatMap((record) => {
      if (record.label === "audit") return [draft(record, "observation", "Audit", "Recorded outcome"), draft(record, "observation", "Audit", "Recorded outcome")];
      if (record.label === "Context compaction") return [draft(record, "observation", "Compaction", "Recorded an audit summary")];
      if (record.kind === "answer") return [draft(record, "decision", "Rerun decision")];
      return [];
    }) };
  });
  vi.mocked(openCurationModel).mockResolvedValue({ request, batchBytes: 12_000 });

  const { app, status, start, change, until } = await notesApp(project.id, task);
  try {
    expect(await status()).toBeNull();
    const started = await start();
    const failed = await until("failed");
    expect(failed).toMatchObject({ id: started.id, phase: "reading", progress: { readBatches: 1 } });
    expect(failed.coverage).toMatchObject({ damagedRows: 1, eventGaps: 1, unavailable: 2, redacted: 1, incomplete: true });

    // New transcript entries cannot alter the already indexed snapshot.
    fs.appendFileSync(session, JSON.stringify({ ...rows[0], id: "after", message: { ...rows[0].message, content: [{ type: "text", text: "Later input." }] } }) + "\n");
    await change(started.id, "resume");
    const mergeFailure = await until("failed");
    expect(mergeFailure.phase).toBe("merging");
    await change(started.id, "resume");
    const result = await until("completed");
    const records = [...successful.values()];
    const transmitted = records.map(({ text }) => text).join("");
    expect(transmitted).not.toMatch(/fixture-secret|Unreferenced private file|Opaque text|Later input/);
    expect(transmitted).toContain("Saved private reasoning");
    expect(transmitted).toContain("Hidden compaction summary.");
    expect(transmitted).toContain("Hidden audit.");
    expect(transmitted).toContain("Provider stopped mid-request");
    expect(transmitted).toContain(long);
    expect(records.some((record) => record.label === "Context edit")).toBe(true);
    expect(records.some((record) => record.label === "Run · failed")).toBe(true);
    expect(result.progress?.readRecords).toBe(result.progress?.totalRecords);
    expect(result.batch?.candidates.map(({ title }) => title)).toEqual(["Consolidated audit", "Rerun decision"]);
    expect(result.batch?.candidates[0].sources).toHaveLength(2);
    expect((await status())?.batch).toEqual(result.batch);

    const { draftCredit, candidates } = result.batch!;
    const saved = await app.inject({ method: "POST", url: "/notes/batch", payload: {
      task: { id: task, title: "Complete curation test" }, draftCredit, pages: [{ ...candidates[0], title: "Reviewed audit" }],
    } });
    expect(saved.json().results).toMatchObject([{ status: "saved", page: { type: "observation", revisions: [{ title: "Reviewed audit" }] } }]);
    expect((await status())?.savedPages).toMatchObject([{ revisions: [{ title: "Reviewed audit" }] }]);
    expect((await app.inject("/notes")).json().pages).toHaveLength(1);
  } finally {
    await app.close();
  }
});

const longTaskRoot = process.env.KADY_CURATION_ACCEPTANCE_PROJECT;
it.skipIf(!longTaskRoot)("uses the previous long task's saved transcript and event log with a local test model", async () => {
  const taskId = "01a202e8-0a48-75e1-8921-01e6a3f3cea3";
  const paths = ensureProjectExists("transform-cb686f");
  const sourceSessions = path.join(longTaskRoot!, "sandbox", ".pi", "sessions");
  const filename = fs.readdirSync(sourceSessions).find((file) => file.endsWith(taskId + ".jsonl"))!;
  fs.mkdirSync(paths.sessionsDir, { recursive: true });
  fs.copyFileSync(path.join(sourceSessions, filename), path.join(paths.sessionsDir, filename));
  const run = path.join(paths.runsDir, taskId);
  fs.mkdirSync(run, { recursive: true });
  for (const name of ["events.v1.jsonl", "events.v1.jsonl.commit"]) {
    fs.copyFileSync(path.join(longTaskRoot!, "sandbox", ".kady", "runs", taskId, name), path.join(run, name));
  }
  const inventory = await buildTaskRecords(paths.id, taskId, new AbortController().signal, { complete: true });
  const seen = new Map<string, string>();
  const saw = (label: string) => inventory.records.filter((record) => record.source.label === label).length;
  expect(saw("Context compaction")).toBe(6);
  expect(saw("Assistant error")).toBeGreaterThanOrEqual(19);
  expect(saw("Context edit")).toBe(14);
  expect(saw("Run · completed") + saw("Run · failed") + saw("Run · cancelled")).toBe(27);
  let fail = true;
  const request = vi.fn(async (_system: string, input: unknown) => {
    const { records, drafts } = input as { records?: ModelRecord[]; drafts?: { id: number }[] };
    if (drafts) return { groups: drafts.map(({ id }) => ({ ids: [id] })) };
    if (fail && seen.size) {
      fail = false;
      throw new Error("Simulated interruption");
    }
    const candidates = [];
    for (const record of records!) {
      expect(seen.has(record.id)).toBe(false);
      seen.set(record.id, record.text);
      if (record.label === "Context compaction") candidates.push(draft(record, "observation", "存在已保存的任务压缩摘要"));
      if (record.label === "Assistant error") candidates.push(draft(record, "note", "任务记录了模型服务错误"));
      if (record.kind === "result") candidates.push(draft(record, "observation", "任务返回了科学结果卡片"));
    }
    return { candidates };
  });
  vi.mocked(openCurationModel).mockResolvedValue({ request, batchBytes: 160_000 });
  const { app, start, change, until } = await notesApp(paths.id, taskId);
  try {
    const started = await start();
    expect((await until("failed")).progress?.readBatches).toBe(1);
    await change(started.id, "resume");
    const completed = await until("completed");
    expect(completed.coverage?.events).toBe(inventory.eventCount);
    expect(completed.progress?.readRecords).toBe(inventory.records.length);
    expect(completed.progress?.totalBatches).toBe(completed.progress?.readBatches);
    const originals = new Map<number, string>();
    for (const [id, body] of seen) {
      const number = Number(id.split(":")[0].slice(1));
      originals.set(number, (originals.get(number) ?? "") + body);
    }
    for (const [index, record] of inventory.records.entries()) {
      if (originals.get(index + 1) !== record.body) throw new Error("Record differs from local snapshot at index " + index);
    }
    expect(completed.batch?.candidates).toHaveLength(3);
    const saved = await app.inject({ method: "POST", url: "/notes/batch", payload: {
      task: { id: taskId, title: "长任务验收" }, draftCredit: completed.batch?.draftCredit, pages: completed.batch?.candidates.slice(0, 2),
    } });
    expect(saved.json().results.map(({ status }: { status: string }) => status)).toEqual(["saved", "saved"]);
    console.info("Complete curation acceptance", completed.progress, completed.coverage, {
      hiddenCompactions: saw("Context compaction"), hiddenErrors: saw("Assistant error"), contextEdits: saw("Context edit"),
      candidates: completed.batch?.candidates.length, saved: 2,
    });
  } finally {
    await app.close();
  }
}, 60_000);
