import { spawn } from "node:child_process";
import { once } from "node:events";
import * as fs from "node:fs/promises";
import { SessionManager, type AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import { afterAll, expect, it, vi } from "vitest";
import { createRunFrameMapper } from "../src/agent/events.ts";
import { appendTaskEvents, readTaskTimeline, taskEventLogPath } from "../src/agent/task-event-log.ts";
import { TaskEventRecorder } from "../src/agent/task-event-recorder.ts";
import { PARENT_WAKE_TEXT } from "../src/agent/subagent-wake.ts";
import { buildApp } from "../src/index.ts";
import { createProject, resolvePaths } from "../src/projects.ts";

const app = await buildApp();
afterAll(() => app.close());

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof fs>();
  return { ...actual, open: vi.fn(actual.open) };
});

it("records interleaving, tool identity, and separate run and task sequences", async () => {
  const project = createProject({ name: "Interleaved timeline fixture" });
  const paths = resolvePaths(project.id);
  const scope = { projectId: project.id, sessionId: "timeline" };
  let clock = 100;
  let wall = 10_000;
  const recorder = new TaskEventRecorder({
    paths, scope, runId: "run-1", log: console,
    wallClock: () => wall--, monotonicClock: () => clock,
  });
  const mapFrames = createRunFrameMapper(paths.sandbox);
  const emit = (input: unknown) => {
    const event = input as AgentSessionEvent;
    const frames = mapFrames(event);
    recorder.observe(event, frames);
    return frames[0];
  };
  const start = (toolCallId: string, parentToolCallId?: string) => emit({
    type: "tool_execution_start", toolName: "read", toolCallId, parentToolCallId,
    args: { path: "input.tsv", api_key: "fixture-credential" },
  });
  const end = (toolCallId: string, isError: boolean) => emit({
    type: "tool_execution_end", toolName: "read", toolCallId, isError,
    result: { content: [{ type: "text", text: "tool result" }, { type: "image", data: "fixture-image", mimeType: "image/png" }] },
  });
  const message = { role: "assistant", timestamp: 9_000, stopReason: "stop", content: [] };
  const delta = (type: string, delta: string, contentIndex: number) => emit({
    type: "message_update", message, assistantMessageEvent: { type, delta, contentIndex },
  });

  recorder.start({ origin: "user", kind: "turn", basePiEntryId: "existing-message" });
  emit({ type: "turn_start" });
  emit({ type: "message_start", message: { role: "user", timestamp: 8900, content: PARENT_WAKE_TEXT } });
  emit({ type: "message_end", message: { role: "user", timestamp: 8900, content: PARENT_WAKE_TEXT } });
  emit({ type: "message_start", message });
  delta("text_delta", "Before ", 0);
  delta("text_delta", "tools", 0);
  delta("thinking_delta", "Visible analysis", 1);
  const finishThinking = (contentIndex: number, content: string, redacted = false) => emit({
    type: "message_update", message, assistantMessageEvent: { type: "thinking_end", content, contentIndex, redacted },
  });
  expect(finishThinking(1, "Visible analysis")).toBeUndefined();
  expect(delta("thinking_delta", "\n\n", 2)).toBeUndefined();
  expect(finishThinking(2, "Summary delivered at block end")).toMatchObject({ type: "thinking_delta", reasoningStart: true, contentIndex: 2 });
  expect(finishThinking(3, "redacted fixture", true)).toBeUndefined();
  const finalBlocks = [0, 1, 2, 3, 4].map((index) => ({
    type: "thinking",
    thinking: ["", "Visible analysis", "Summary delivered at block end", "redacted fixture", "Summary delivered at message end"][index],
  }));
  expect(emit({ type: "message_end", message: { ...message, content: finalBlocks } })).toMatchObject({
    type: "thinking_delta", delta: "Summary delivered at message end", reasoningStart: true,
  });
  const liveA = start("A");
  clock = 105;
  start("B", "A");
  recorder.observeServer({ type: "permission_request", requestId: "perm-1", toolCallId: "B" });
  recorder.observeServer({ type: "permission_resolved", requestId: "perm-1", outcome: "allowed" });
  clock = 119;
  const liveB = end("B", true);
  clock = 134;
  end("A", false);
  emit({ type: "turn_end", message });
  emit({ type: "auto_retry_start", attempt: 1, maxAttempts: 2 });
  emit({ type: "turn_start" });
  const followup = { role: "user", content: [{ type: "text", text: "Check the second column" }], timestamp: 9600 };
  emit({ type: "message_start", message: followup });
  emit({ type: "message_end", message: followup });
  emit({ type: "message_start", message });
  delta("text_delta", "After tools", 0);
  emit({ type: "message_end", message });
  await recorder.finish("completed");

  const read = (after: number, limit: number, through?: number) =>
    readTaskTimeline(paths, scope, { after, limit, through }, () => false);
  const page = await read(0, 4);
  expect(page).toMatchObject({ coverage: "recorded", nextAfter: 4 });
  const tail = await read(page.nextAfter!, 100, page.through);
  const events = [...page.events, ...tail.events];
  expect(events.map((event) => event.taskSeq)).toEqual(events.map((_, index) => index + 1));
  expect(new Set(events.map((event) => event.eventId)).size).toBe(events.length);
  expect(await read(0, 4, page.through)).toEqual(page);
  const chunks = events.filter((event) => event.type === "message_chunk");
  expect(chunks.map((event) => event.payload)).toMatchObject([
    { channel: "text", content: { value: "Before tools" } },
    { channel: "thinking", content: { value: "Visible analysis" } },
    { channel: "thinking", content: { value: "Summary delivered at block end" } },
    { channel: "thinking", content: { value: "Summary delivered at message end" } },
    { channel: "input", content: { value: "Check the second column" } },
    { channel: "text", content: { value: "After tools" } },
  ]);
  const tools = events.filter((event) => event.type.startsWith("tool_"));
  expect(tools).toMatchObject([
    { type: "tool_started", payload: { toolCallId: "A", args: { redacted: true } } },
    { type: "tool_started", payload: { toolCallId: "B", parentToolCallId: "A" } },
    { type: "tool_ended", payload: { toolCallId: "B", durationMs: 14, outcome: "failed" } },
    { type: "tool_ended", payload: { toolCallId: "A", durationMs: 34, outcome: "completed" } },
  ]);
  expect(liveA).toMatchObject({ type: "tool_start", startedAt: tools[0].observedAt });
  expect(liveB).toMatchObject({ type: "tool_end", durationMs: 14 });
  expect(events.filter((event) => event.type === "system_notice").map((event) => event.payload)).toMatchObject([
    { code: "permission_request", requestId: "perm-1", toolCallId: "B" },
    { code: "permission_resolved", requestId: "perm-1", outcome: "allowed" },
    { code: "retry", attempt: 1 },
  ]);
  const raw = await fs.readFile(taskEventLogPath(paths, scope.sessionId), "utf8");
  for (const hidden of ["fixture-credential", "fixture-image", "redacted fixture", PARENT_WAKE_TEXT]) expect(raw).not.toContain(hidden);

  const second = new TaskEventRecorder({ paths, scope, runId: "run-2", log: console });
  second.start({ origin: "user", kind: "turn" });
  await second.finish("cancelled");
  expect((await read(page.through, 100)).events).toMatchObject([
    { taskSeq: page.through + 1, runId: "run-2", type: "run_started" },
    { taskSeq: page.through + 2, runId: "run-2", type: "run_ended", payload: { outcome: "cancelled" } },
  ]);
  expect((await read(4, 100, page.through)).events).toEqual(tail.events);
});

it("recovers the committed prefix from a killed writer and hides it from other projects", async () => {
  const project = createProject({ name: "Restart timeline fixture" });
  const paths = resolvePaths(project.id);
  await fs.mkdir(paths.sessionsDir, { recursive: true });
  const legacy = SessionManager.create(paths.sandbox, paths.sessionsDir);
  legacy.appendMessage({ role: "user", content: "Saved legacy prompt", timestamp: Date.now() });
  const session = SessionManager.create(paths.sandbox, paths.sessionsDir);
  const sessionId = session.getSessionId();
  const scope = { sessionId, projectId: project.id };
  const headers = { "X-Project-Id": project.id };
  const url = `/sessions/${sessionId}/timeline`;
  const read = async () => {
    const response = await app.inject({ method: "GET", url, headers });
    expect(response.statusCode).toBe(200);
    return response.json();
  };
  const prior = await app.inject({ method: "GET", url: `/sessions/${legacy.getSessionId()}/timeline`, headers });
  expect(prior.json()).toMatchObject({ coverage: "legacy", events: [] });
  expect((await app.inject({ method: "GET", url, headers })).statusCode).toBe(404);
  const script = `
    import { appendFile } from "node:fs/promises";
    import { appendTaskEvents, taskEventLogPath } from ${JSON.stringify(new URL("../src/agent/task-event-log.ts", import.meta.url).href)};
    const paths = ${JSON.stringify(paths)};
    const scope = ${JSON.stringify(scope)};
    const base = { source: "pi", runId: "killed-run", observedAt: 42 };
    await appendTaskEvents(paths, scope, [
      { ...base, eventId: "start", type: "run_started", payload: { origin: "user", kind: "turn" } },
      { ...base, eventId: "call", type: "tool_started", payload: { toolCallId: "in-progress", toolName: "read", args: { kind: "omitted", reason: "unavailable" } } },
    ], true);
    await appendFile(taskEventLogPath(paths, scope.sessionId), '{ "eventId": "uncommitted"');
    process.stdout.write("ready\\n");
    setInterval(() => {}, 1000);
  `;
  const child = spawn(process.execPath, ["--import", "tsx", "--input-type=module", "-e", script], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  const exit = once(child, "exit");
  try {
    const result = await Promise.race([
      once(child.stdout, "data").then(([data]) => String(data).trim()),
      exit.then(() => { throw new Error("Timeline writer exited before committing"); }),
    ]);
    expect(result).toBe("ready");
  } finally {
    child.kill("SIGKILL");
    await exit;
  }

  // Pi writes the tool declaration before executing it. A killed owner can
  // leave that declaration in history with no corresponding tool result.
  session.appendMessage({ role: "user", content: "Inspect input", timestamp: 39 });
  session.appendMessage({
    role: "assistant", api: "openai-responses", provider: "openai", model: "fixture",
    timestamp: 40, stopReason: "toolUse",
    content: [
      { type: "text", text: "I'll inspect the file." },
      { type: "thinking", thinking: "opaque placeholder", redacted: true },
      { type: "thinking", thinking: "Check the sample first." },
      { type: "toolCall", id: "in-progress", name: "read", arguments: { path: "input.tsv" } },
    ],
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
  });
  const history = await app.inject({ method: "GET", url: `/sessions/${sessionId}/history`, headers });
  expect(history.statusCode).toBe(200);
  expect(history.json().messages.at(-1)?.frames).toMatchObject([
    { type: "text_delta", delta: "I'll inspect the file." },
    { type: "thinking_delta", delta: "Check the sample first." },
    { type: "tool_start", toolCallId: "in-progress", startedAt: 42 },
  ]);

  const recovered = await read();
  expect(recovered).toMatchObject({ coverage: "incomplete", committedThrough: 4, events: [
    { eventId: "start", taskSeq: 1, type: "run_started" },
    { eventId: "call", taskSeq: 2, type: "tool_started" },
    { taskSeq: 3, type: "record_gap", payload: { reason: "uncommitted_tail" } },
    { taskSeq: 4, source: "recovery", type: "run_ended", payload: { outcome: "interrupted" } },
  ] });
  expect(await read()).toEqual(recovered);
  expect((await app.inject({ method: "GET", url: url + "?limit=201", headers })).statusCode).toBe(400);
  const other = createProject({ name: "Other timeline project" });
  expect((await app.inject({ method: "GET", url, headers: { "X-Project-Id": other.id } })).statusCode).toBe(404);
  session.appendMessage({ role: "user", content: "Persisted after recovery", timestamp: Date.now() });
  expect((await app.inject({ method: "DELETE", url: `/sessions/${sessionId}`, headers })).statusCode).toBe(200);
  expect((await app.inject({ method: "GET", url, headers })).statusCode).toBe(404);
}, 15_000);

it("replays the observed order and timings while preserving Pi tool results", async () => {
  const project = createProject({ name: "Parallel tool replay" });
  const paths = resolvePaths(project.id);
  const session = SessionManager.create(paths.sandbox, paths.sessionsDir);
  const sessionId = session.getSessionId();
  const scope = { projectId: project.id, sessionId };
  session.appendMessage({ role: "user", content: "Inspect both files", timestamp: 100 });
  const reply = {
    role: "assistant", api: "openai-responses", provider: "openai", model: "fixture",
    timestamp: 101, stopReason: "toolUse",
    content: [
      { type: "text", text: "Read both files." },
      { type: "toolCall", id: "a", name: "read", arguments: { path: "a.txt" } },
      { type: "toolCall", id: "b", name: "read", arguments: { path: "b.txt" } },
    ],
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
  } satisfies Parameters<typeof session.appendMessage>[0];
  session.appendMessage(reply);
  session.appendCustomMessageEntry("subagent_watchdog_warning", "Notice during tool execution", true);
  session.appendMessage({
    role: "toolResult", toolCallId: "a", toolName: "read", timestamp: 120, isError: false,
    content: [{ type: "text", text: "Full A" }],
  });
  const read = async () => {
    const response = await app.inject({
      method: "GET", url: `/sessions/${sessionId}/history`, headers: { "X-Project-Id": project.id },
    });
    expect(response.statusCode).toBe(200);
    const messages = response.json().messages;
    expect(messages.map((message: { role: string }) => message.role)).toEqual(["user", "assistant", "system"]);
    return messages[1].frames;
  };
  const oldFrames = await read();
  expect(oldFrames.filter((frame: { type: string }) => frame.type === "tool_start")).toEqual([
    expect.not.objectContaining({ startedAt: expect.anything() }),
    expect.not.objectContaining({ startedAt: expect.anything() }),
  ]);
  const base = { runId: "parallel", observedAt: 110, source: "pi" } as const;
  const tool = { toolName: "read" };
  const text = (value: string) => ({ kind: "inline" as const, value });
  await appendTaskEvents(paths, scope, [
    { ...base, eventId: "run-start", type: "run_started", payload: { origin: "user", kind: "turn" } },
    { ...base, eventId: "b-start", type: "tool_started", payload: { ...tool, toolCallId: "b", args: text("B") } },
    { ...base, eventId: "a-start", observedAt: 112, type: "tool_started", payload: { ...tool, toolCallId: "a", args: text("A") } },
    { ...base, eventId: "a-end", observedAt: 120, type: "tool_ended", payload: { ...tool, toolCallId: "a", outcome: "completed", result: text("Capped A"), durationMs: 8 } },
    { ...base, eventId: "b-end", observedAt: 124, type: "tool_ended", payload: { ...tool, toolCallId: "b", outcome: "failed", result: text("Recorded B"), durationMs: 14 } },
    { ...base, eventId: "run-end", observedAt: 124, type: "run_ended", payload: { outcome: "completed" } },
  ], true);
  const frames = await read();
  expect(frames.filter((frame: { type: string }) => frame.type === "tool_start")).toMatchObject([
    { toolCallId: "b", startedAt: 110 }, { toolCallId: "a", startedAt: 112 },
  ]);
  expect(frames).toEqual(expect.arrayContaining([
    expect.objectContaining({ type: "tool_end", toolCallId: "a", durationMs: 8, result: "Full A" }),
    expect.objectContaining({ type: "tool_end", toolCallId: "b", durationMs: 14, result: "Recorded B", isError: true }),
  ]));
});

it.each(["completed", "interrupted"] as const)(
  "restores the summary boundary and exact execution timing only for a %s run",
  async (outcome) => {
    const project = createProject({ name: "Summary replay" });
    const paths = resolvePaths(project.id);
    const session = SessionManager.create(paths.sandbox, paths.sessionsDir);
    const sessionId = session.getSessionId();
    const scope = { projectId: project.id, sessionId };
    const recorder = new TaskEventRecorder({ paths, scope, runId: "summary-run", log: console });
    const mapFrames = createRunFrameMapper(paths.sandbox, 1_000);
    const emit = (input: unknown, at: number) => {
      const event = input as AgentSessionEvent;
      const frames = mapFrames(event, at);
      recorder.observe(event, frames, at);
      return frames;
    };
    recorder.start({ origin: "user", kind: "turn" }, 1_000);
    const progress = { type: "text" as const, text: "Checking input", textSignature: '{"v":1,"id":"p","phase":"commentary"}' };
    const answer = { type: "text" as const, text: "Both checks passed.", textSignature: '{"v":1,"id":"s","phase":"final_answer"}' };
    const reply = {
      role: "assistant", api: "openai-responses", provider: "openai", model: "fixture",
      timestamp: 1_040, stopReason: "stop", content: [progress, answer],
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    } satisfies Parameters<typeof session.appendMessage>[0];
    session.appendMessage({ role: "user", content: "Check the input", timestamp: 1_001 });
    emit({ type: "message_start", message: reply }, 1_040);
    const update = (type: string, index: number, fields: object, partial: unknown, at: number) =>
      emit({ type: "message_update", message: reply, assistantMessageEvent: { type, contentIndex: index, partial, ...fields } }, at);
    expect(update("text_delta", 0, { delta: progress.text }, reply, 1_050))
      .toMatchObject([{ type: "text_delta", blockId: "text-1" }]);
    expect(update("text_delta", 1, { delta: answer.text }, { ...reply, content: [progress] }, 4_600))
      .toMatchObject([{ type: "text_delta", blockId: "text-2" }]);
    expect(update("text_end", 1, { content: answer.text }, reply, 4_800))
      .toMatchObject([{ type: "summary_candidate", blockId: "text-2", confirmed: true, executionMs: 3_600 }]);
    emit({ type: "message_end", message: reply }, 4_800);
    session.appendMessage(reply);
    await recorder.finish(outcome);
    const response = await app.inject({
      method: "GET", url: `/sessions/${sessionId}/history`, headers: { "X-Project-Id": project.id },
    });
    expect(response.statusCode).toBe(200);
    const frames = response.json().messages[1].frames;
    const summary = frames.find((frame: { type: string }) => frame.type === "summary_candidate");
    if (outcome === "completed") {
      expect(summary).toMatchObject({ blockId: "text-2", confirmed: true, executionMs: 3_600 });
    } else {
      expect(summary).toBeUndefined();
    }
  },
);

it("preserves a non-empty log if its commit marker goes missing", async () => {
  const project = createProject({ name: "Missing event checkpoint" });
  const paths = resolvePaths(project.id);
  const scope = { projectId: project.id, sessionId: "missing-checkpoint" };
  const file = taskEventLogPath(paths, scope.sessionId);
  const started = {
    runId: "a", observedAt: 1, source: "server", eventId: "start",
    type: "run_started", payload: { origin: "user", kind: "turn" },
  } as const;
  await appendTaskEvents(paths, scope, [started], true);
  const original = await fs.readFile(file);
  await fs.unlink(file + ".commit");
  expect(await readTaskTimeline(paths, scope, { after: 0, limit: 10 }, () => false))
    .toMatchObject({ coverage: "incomplete", committedThrough: 0, events: [] });
  await expect(appendTaskEvents(paths, scope, [{ ...started, runId: "b" }], true))
    .rejects.toThrow("checkpoint is missing");
  expect(await fs.readFile(file)).toEqual(original);
});

it("keeps the confirmed prefix on a write failure and exposes the gap after storage recovers", async () => {
  const project = createProject({ name: "Write failure fixture" });
  const paths = resolvePaths(project.id);
  const scope = { projectId: project.id, sessionId: "temporary-failure" };
  const log = { warn: vi.fn() };
  const recorder = new TaskEventRecorder({ paths, scope, runId: "failed-write", log });
  const read = () => readTaskTimeline(paths, scope, { after: 0, limit: 20 }, () => true);
  recorder.start({ origin: "user", kind: "turn" });
  await vi.waitFor(async () => expect((await read()).committedThrough).toBe(1));
  const confirmed = (await read()).events[0];
  const actual = await vi.importActual<typeof fs>("node:fs/promises");
  const failNextWrite = vi.mocked(fs.open).mockImplementationOnce(async (file) => {
    if (file !== taskEventLogPath(paths, scope.sessionId)) throw new Error("Unexpected write");
    throw new Error("Injected disk failure");
  });
  try {
    recorder.observeServer({ type: "permission_request", requestId: "not-committed" });
    await vi.waitFor(() => expect(log.warn).toHaveBeenCalledOnce());
    expect(await read()).toMatchObject({ coverage: "incomplete", committedThrough: 1, events: [confirmed] });
  } finally {
    failNextWrite.mockImplementation(actual.open);
    await recorder.finish("cancelled");
  }
  expect(await read()).toMatchObject({ coverage: "incomplete", committedThrough: 3, events: [
    confirmed,
    { type: "record_gap", payload: { reason: "write_failed", droppedCount: 1 } },
    { type: "run_ended", payload: { outcome: "cancelled" } },
  ] });
});
