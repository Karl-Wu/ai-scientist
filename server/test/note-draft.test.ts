import fs from "node:fs";
import path from "node:path";
import { createAssistantMessageEventStream, type AssistantMessage, type ToolCall } from "@earendil-works/pi-ai";
import type { StreamFn } from "@earendil-works/pi-agent-core";
import { expect, it, vi } from "vitest";
import { createProject, resolvePaths } from "../src/projects.ts";
import { setSpecialistEnabled, writeProjectAgent } from "../src/agent/agent-files.ts";
import { generateNoteCandidates, generateNoteDraft, NOTE_DRAFT_SESSION_ID } from "../src/notes/draft.ts";
import { createManualNotePage, getNotePage, listNotePages, saveNoteBatch } from "../src/notes/store.ts";
import { appendTaskEvents } from "../src/agent/task-event-log.ts";
import type { TaskEventDraft } from "../src/agent/task-events.ts";
import { taskRecordTools } from "../src/notes/task-records.ts";
import { sessionCostSummary } from "../src/cost/ledger.ts";

const expert = "scientific-result-reviewer";

function reply(content: AssistantMessage["content"], stopReason: "stop" | "toolUse" | "error" = "stop") {
  const message: AssistantMessage = {
    role: "assistant", api: "openai-completions", provider: "openrouter", model: "test",
    content, timestamp: 0, stopReason,
    usage: { input: 100, output: 20, cacheRead: 0, cacheWrite: 0, totalTokens: 120,
      cost: { input: 0.001, output: 0.002, cacheRead: 0, cacheWrite: 0, total: 0.003 } },
  };
  const stream = createAssistantMessageEventStream();
  if (stopReason === "error") stream.push({ type: "error", reason: stopReason, error: message });
  else stream.push({ type: "done", reason: stopReason, message });
  stream.end(message);
  return stream;
}

const draftReply = (summary = "A grounded draft") => reply([{ type: "text", text: JSON.stringify({ title: "Review", summary }) }]);
const tool = (name: string, args: ToolCall["arguments"] = {}): ToolCall => ({ id: name, type: "toolCall", name, arguments: args });

it("runs the selected specialist with its model and executes source, table and enabled skill tools without a chat", async () => {
  const project = createProject({ name: "Note experts" });
  const paths = resolvePaths(project.id);
  const skill = path.join(paths.skillsDir, "custom-review");
  fs.mkdirSync(path.join(skill, "references"), { recursive: true });
  fs.writeFileSync(path.join(skill, "SKILL.md"), "---\nname: custom-review\ndescription: A review checklist\n---\nRead references/check.md.");
  fs.writeFileSync(path.join(skill, "references", "check.md"), "Check calibration before interpretation.");
  fs.writeFileSync(path.join(paths.sandbox, "mapping.csv"), 'source,target\n"alpha,beta",first\ngamma,\n');
  fs.writeFileSync(path.join(paths.sandbox, "unrelated.txt"), "Private neighboring file");
  writeProjectAgent(paths, "calibration-reviewer", {
    description: "Calibration", systemPrompt: "Focus on calibration fidelity.", inheritSkills: true, model: "ollama/expert-model",
  });
  let calls = 0;
  const stream = vi.fn<StreamFn>((model, context) => {
    const transcript = JSON.stringify(context.messages);
    expect(model.id).toBe("expert-model");
    expect(transcript).not.toContain("Private neighboring file");
    expect(transcript).not.toContain('"name":"bash"');
    if (++calls === 1) {
      expect(transcript).toContain("Focus on calibration fidelity.");
      return reply([tool("read_note_source"), tool("inspect_note_table"), tool("read_note_skill", { name: "custom-review", reference: "references/check.md" })], "toolUse");
    }
    expect(transcript).toContain("alpha,beta");
    expect(transcript).toContain("Check calibration before interpretation.");
    const table = context.messages.find((message) => message.role === "toolResult" && message.toolName === "inspect_note_table");
    expect(table?.content[0]).toMatchObject({ type: "text" });
    expect(JSON.parse((table?.content[0] as { text: string }).text)).toMatchObject({ rows: 2, columnCount: 2, columns: [{ name: "source", empty: 0 }, { name: "target", empty: 1 }] });
    return reply([tool("submit_note_draft", { title: "Review", summary: "A grounded draft" })], "toolUse");
  });
  const result = await generateNoteDraft(project.id, {
    expert: "calibration-reviewer", model: "ollama/chat-model", source: { kind: "file", path: "mapping.csv" },
  }, { stream });
  expect(stream).toHaveBeenCalledTimes(2);
  expect(result.draftCredit).toEqual({ expert: "calibration-reviewer" });
  expect(result.checks).toMatchObject([{ kind: "source" }, { kind: "table", detail: "2" }, { kind: "skill", detail: "custom-review" }]);
  expect(listNotePages(project.id).pages).toEqual([]);

  const page = createManualNotePage(project.id, { title: result.title, summary: result.summary, draftCredit: result.draftCredit });
  expect(getNotePage(project.id, page.id).revisions[0].draftCredit).toEqual(result.draftCredit);
  expect(listNotePages(project.id).pages).toMatchObject([{ id: page.id, draftExpert: "calibration-reviewer" }]);
  expect(setSpecialistEnabled(paths, "calibration-reviewer", false).ok).toBe(true);
  await expect(generateNoteDraft(project.id, { expert: "calibration-reviewer", summary: "Review again." }, { stream }))
    .rejects.toMatchObject({ statusCode: 409 });
});

it("reads only the selected task, redacts secrets and records both model requests", async () => {
  const project = createProject({ name: "Draft source" });
  const paths = resolvePaths(project.id);
  fs.mkdirSync(paths.sessionsDir, { recursive: true });
  const rows = [
    { type: "message", message: { role: "user", content: [{ type: "text", text: "Keep the inclusion criteria." }] } },
    { type: "message", message: { role: "assistant", content: [{ type: "thinking", thinking: "Internal reasoning" },
      { type: "text", text: "The task reported 12 rows. api_key=synthetic-secret" }] } },
    { type: "message", message: { role: "toolResult", toolName: "bash", isError: true, content: [{ type: "text", text: "raw tool output" }] } },
  ];
  fs.writeFileSync(path.join(paths.sessionsDir, "task-a.jsonl"), rows.map((row) => JSON.stringify(row)).join("\n"));
  let calls = 0;
  const stream = vi.fn<StreamFn>((_model, context) => {
    if (++calls === 1) return reply([tool("read_note_source")], "toolUse");
    const transcript = JSON.stringify(context.messages);
    expect(transcript).toContain("The task reported 12 rows");
    expect(transcript).toContain("Tool bash returned an error");
    expect(transcript).toContain("[redacted]");
    expect(transcript).not.toMatch(/Internal reasoning|synthetic-secret|raw tool output/);
    return draftReply("Unit unresolved.");
  });
  await expect(generateNoteDraft(project.id, { expert, summary: "Mark the unit as unresolved.", taskId: "task-a" }, { stream }))
    .resolves.toMatchObject({ title: "Review", summary: "Unit unresolved.", taskExcerptShortened: false });
  expect(listNotePages(project.id).pages).toEqual([]);
  expect(sessionCostSummary(NOTE_DRAFT_SESSION_ID, project.id).entries).toHaveLength(2);
});

it("rejects unavailable or unread sources and enforces the cap before another model request", async () => {
  const project = createProject({ name: "Invalid draft", spendLimitUsd: 0.002 });
  const paths = resolvePaths(project.id);
  fs.writeFileSync(path.join(paths.sandbox, "review.py"), "print(42)");
  const stream = vi.fn<StreamFn>(() => reply([tool("read_note_source")], "toolUse"));
  await expect(generateNoteDraft(project.id, { expert, taskId: "foreign-task" }, { stream })).rejects.toMatchObject({ statusCode: 404 });
  expect(stream).not.toHaveBeenCalled();
  await expect(generateNoteDraft(project.id, { expert, source: { kind: "file", path: "review.py" } }, { stream }))
    .rejects.toMatchObject({ statusCode: 402 });
  expect(sessionCostSummary(NOTE_DRAFT_SESSION_ID, project.id).entries).toHaveLength(1);
  expect(stream).toHaveBeenCalledOnce();

  const other = createProject({ name: "Source must be read" });
  fs.writeFileSync(path.join(resolvePaths(other.id).sandbox, "review.py"), "print(42)");
  await expect(generateNoteDraft(other.id, { expert, source: { kind: "file", path: "review.py" } }, { stream: () => reply([], "error") }))
    .rejects.toMatchObject({ statusCode: 503, message: expect.stringContaining("model provider") });
  await expect(generateNoteDraft(other.id, { expert, source: { kind: "file", path: "review.py" } }, { stream: () => draftReply() }))
    .rejects.toMatchObject({ statusCode: 502, message: expect.stringContaining("did not read") });
});

it("aborts the provider when drafting is cancelled and leaves the note unsaved", async () => {
  const project = createProject({ name: "Cancelled draft" });
  const abort = new AbortController();
  const stream: StreamFn = (_model, _context, options) => {
    const source = createAssistantMessageEventStream();
    options?.signal?.addEventListener("abort", () => {
      const error: AssistantMessage = {
        role: "assistant", api: "openai-completions", provider: "openrouter", model: "test",
        content: [], timestamp: 0, stopReason: "aborted",
        usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
      };
      source.push({ type: "error", reason: "aborted", error });
      source.end(error);
    }, { once: true });
    queueMicrotask(() => abort.abort());
    return source;
  };
  await expect(generateNoteDraft(project.id, { expert, summary: "Keep this text." }, { signal: abort.signal, stream }))
    .rejects.toMatchObject({ statusCode: 499 });
  expect(listNotePages(project.id).pages).toEqual([]);
});

it("returns a mixed set of editable candidates with stable request IDs and leaves them unsaved", async () => {
  const project = createProject({ name: "Multiple draft candidates" });
  const stream: StreamFn = () => reply([tool("submit_note_candidates", { candidates: [
    { type: "observation", title: "What was observed", summary: "Two samples were excluded.", fields: { finding: "Two exclusions" } },
    { type: "decision", title: "Chosen threshold", summary: "Record the selected threshold.", fields: { rationale: "Predefined protocol" } },
  ] })], "toolUse");
  const batch = await generateNoteCandidates(project.id, { expert, summary: "Two exclusions and a threshold decision." }, { stream });
  expect(batch.draftCredit).toEqual({ expert });
  expect(batch.candidates).toMatchObject([
    { type: "observation", requestId: expect.stringMatching(/^[a-f0-9]{32}$/), fields: { finding: "Two exclusions" } },
    { type: "decision", requestId: expect.stringMatching(/^[a-f0-9]{32}$/), fields: { rationale: "Predefined protocol" } },
  ]);
  expect(new Set(batch.candidates.map((page) => page.requestId)).size).toBe(2);
  expect(listNotePages(project.id).pages).toEqual([]);
  await expect(generateNoteCandidates(project.id, { expert, summary: "No useful material." }, {
    stream: () => reply([tool("submit_note_candidates", { candidates: [] })], "toolUse"),
  })).resolves.toMatchObject({ candidates: [] });
});

function recordsFixture() {
  const project = createProject({ name: "Early checks and later rounds" });
  const paths = resolvePaths(project.id);
  fs.mkdirSync(paths.sessionsDir, { recursive: true });
  const sessionId = "task-record-fixture";
  const file = path.join(paths.sessionsDir, sessionId + ".jsonl");
  const text = (value: string) => ({ type: "text", text: value });
  const message = (id: string, role: string, timestamp: number, content: unknown[], extra = {}) => ({
    id, type: "message", message: { role, timestamp, content, ...extra },
  });
  const rows = [
    message("first-question", "user", 1, [text("Check original cohort")]),
    message("before-compaction", "assistant", 2, [
      { type: "thinking", thinking: "Reasoning for first answer" },
      { type: "thinking", thinking: "opaque-reasoning-secret", redacted: true },
      { type: "toolCall", name: "check", id: "early-tool", arguments: { path: "unread.txt", api_key: "fixture-secret" } },
    ]),
    message("first-output", "toolResult", 3, [text("record ".repeat(1250) + "Confirmed early checksum Z9")],
      { toolName: "check", toolCallId: "early-tool" }),
    { type: "compaction", id: "compact", summary: "Context summary before reply" },
    message("first-answer", "assistant", 4, [text("A first decision was recorded."), { type: "thinking", thinking: "Review existing results." }]),
    message("second-question", "user", 5, [text("Later unrelated task input")]),
    message("second-tool", "assistant", 6, [{ type: "toolCall", name: "later_tool", id: "later-tool", arguments: {} }]),
    message("second-output", "toolResult", 7, [text("Unrelated later output")], { toolCallId: "later-tool" }),
    message("second-answer", "assistant", 8, [text("Later unrelated conclusion")]),
    ...Array.from({ length: 34 }, (_, index) => [
      message("later-q" + index, "user", 20 + index * 2, [text("Later revision " + index)]),
      message("later-a" + index, "assistant", 21 + index * 2, [text("Later status " + index)]),
    ]).flat(),
  ];
  fs.writeFileSync(file, rows.map((row) => JSON.stringify(row)).join("\n") + "\n");
  fs.writeFileSync(path.join(paths.sandbox, "unread.txt"), "Secret neighboring file bytes");
  return { project, paths, file, sessionId };
}

it("finds an early paged output, attaches different verified sources, and saves only the confirmed candidate", async () => {
  const { project, sessionId, file } = recordsFixture();
  let calls = 0;
  let outputId: string;
  let answerId: string;
  const stream: StreamFn = (_model, context) => {
    const output = (name: string) => JSON.parse((context.messages.filter((message) =>
      message.role === "toolResult" && message.toolName === name).at(-1)?.content[0] as { text: string }).text);
    switch (++calls) {
      case 1:
        // This entry is appended after the draft's source snapshot has been acquired.
        fs.appendFileSync(file, JSON.stringify({ type: "message", id: "post-start", message: { role: "user", timestamp: 100,
          content: [{ type: "text", text: "new after snapshot Z9" }] } }) + "\n");
        return reply([tool("list_task_records", { query: "Z9" })], "toolUse");
      case 2: {
        const index = output("list_task_records");
        expect(index.total).toBe(1);
        expect(index.records[0]).toMatchObject({ kind: "tool", round: 1 });
        outputId = index.records[0].id;
        return reply([tool("read_task_record", { records: [{ id: outputId }] })], "toolUse");
      }
      case 3: {
        const firstPart = output("read_task_record")[0];
        expect(firstPart.nextOffset).toBeGreaterThan(0);
        expect(firstPart.text).toContain("[redacted]");
        expect(JSON.stringify(context.messages)).not.toContain("fixture-secret");
        expect(firstPart.text).not.toContain("Confirmed early checksum");
        return reply([tool("read_task_record", { records: [{ id: outputId, offset: 8000 }] })], "toolUse");
      }
      case 4:
        expect(output("read_task_record")[0].text).toContain("Confirmed early checksum Z9");
        expect(JSON.stringify(context.messages)).not.toContain("Secret neighboring file bytes");
        return reply([tool("list_task_records", { kind: "answer", query: "first decision" })], "toolUse");
      case 5:
        answerId = output("list_task_records").records[0].id;
        return reply([tool("read_task_record", { records: [{ id: answerId }] })], "toolUse");
      default:
        return reply([tool("submit_note_candidates", { candidates: [
          { type: "observation", title: "Early checksum", summary: "The tool recorded Z9.", fields: {}, recordIds: [outputId] },
          { type: "decision", title: "First decision", summary: "The first answer recorded a decision.", fields: {}, recordIds: [answerId] },
        ] })], "toolUse");
    }
  };
  const batch = await generateNoteCandidates(project.id, { expert, taskId: sessionId }, { stream });
  expect(batch.taskRecords).toMatchObject({ coverage: "legacy", read: [{ id: outputId!, partial: true }, { id: answerId!, partial: false }] });
  expect(batch.taskRecords!.total).toBeGreaterThan(32);
  const [observation, decision] = batch.candidates;
  expect(observation.sources).toMatchObject([{ kind: "tool", toolCallId: "early-tool", recordFlags: ["redacted"],
    excerpt: expect.stringContaining("Confirmed early checksum Z9") }]);
  expect(decision.sources).toMatchObject([{ kind: "message", entryId: "first-answer" }]);
  expect(listNotePages(project.id).pages).toEqual([]);

  const input = { task: { id: sessionId, title: "Main task" }, draftCredit: batch.draftCredit };
  const tampered = { ...observation, sources: [{ ...observation.sources![0], toolCallId: "later-tool" }] };
  expect(saveNoteBatch(project.id, { ...input, pages: [tampered] }).results[0]).toMatchObject({ status: "failed", code: 409 });
  expect(saveNoteBatch(project.id, { ...input, task: undefined, source: { kind: "message", sessionId, entryId: "second-answer" },
    pages: [observation] }).results[0]).toMatchObject({ status: "failed", code: 409 });
  const edited = { ...observation, title: "Reviewed early checksum" };
  const saved = saveNoteBatch(project.id, { ...input, pages: [edited] });
  expect(saved.results[0]).toMatchObject({ status: "saved", page: { sources: [{ kind: "task" }, { kind: "tool", toolCallId: "early-tool" }] } });
  fs.unlinkSync(file); // A lost response can still be confirmed after the original task is gone.
  expect(saveNoteBatch(project.id, { ...input, pages: [edited] })).toEqual(saved);
  expect(listNotePages(project.id).pages).toMatchObject([{ title: edited.title }]);
});

it("scopes an answer to its own records across compaction and marks event-only truncated outputs", async () => {
  const { project, paths, sessionId } = recordsFixture();
  const scope = { projectId: project.id, sessionId };
  const events: TaskEventDraft[] = [
    { type: "run_started", payload: { origin: "user", kind: "turn" }, eventId: "s", runId: "r", source: "pi", observedAt: 1 },
    { type: "tool_ended", payload: { toolCallId: "child-tool", parentToolCallId: "early-tool", toolName: "child_check",
      outcome: "failed", result: { kind: "inline", value: "Child output was shortened", truncated: true } },
      eventId: "t", runId: "r", source: "pi", observedAt: 3 },
    { type: "run_ended", payload: { outcome: "completed" }, eventId: "e", runId: "r", source: "pi", observedAt: 4 },
  ];
  await appendTaskEvents(paths, scope, events, true);
  const opened = await taskRecordTools(project.id, sessionId, "first-answer", new AbortController().signal);
  const [list, read] = opened.tools;
  const index = JSON.parse((await list.execute("list", {})).content[0].text);
  expect(index.coverage).toBe("recorded");
  expect(index.records.map((item: { label: string }) => item.label).join(" ")).not.toMatch(/Later|later_tool|opaque-reasoning-secret/);
  expect(index.records).toEqual(expect.arrayContaining([
    expect.objectContaining({ kind: "question", label: "Check original cohort" }),
    expect.objectContaining({ kind: "answer", label: "A first decision was recorded." }),
    expect.objectContaining({ kind: "tool", label: "check · completed" }),
    expect.objectContaining({ kind: "tool", label: "child_check · failed", flags: ["unavailable", "truncated"] }),
  ]));
  const child = index.records.find((item: { label: string }) => item.label.startsWith("child_check"));
  const reasoning = index.records.find((item: { kind: string }) => item.kind === "reasoning");
  expect(() => opened.cite([child.id])).toThrow("Cite evidence records you read");
  const result = JSON.parse((await read.execute("read", { records: [{ id: child.id }, { id: reasoning.id }] })).content[0].text);
  expect(result[0]).toMatchObject({ id: child.id, text: expect.stringContaining("Child output was shortened"), flags: ["unavailable", "truncated"] });
  expect(result[1].text).toContain("Reasoning for first answer");
  expect(result[1].text).not.toContain("opaque-reasoning-secret");
  expect(opened.cite([child.id])).toMatchObject([{ kind: "task", label: "child_check · failed" }]);
  expect(() => opened.cite([reasoning.id])).toThrow("Use reasoning only to guide");
});
