import fs from "node:fs";
import { createAssistantMessageEventStream, type AssistantMessage } from "@earendil-works/pi-ai";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { afterAll, expect, it, vi } from "vitest";
import { runBroker } from "../src/agent/run-broker.ts";
import * as appSettings from "../src/app-settings.ts";
import { attachSessionObserver } from "../src/agent/session-observer.ts";
import { createSession, disposeSession, getModelRuntime, setSessionObserver, type SessionObserverFactory } from "../src/agent/session-registry.ts";
import { PARENT_WAKE_TEXT } from "../src/agent/subagent-wake.ts";
import { buildApp } from "../src/index.ts";
import { createProject, resolvePaths } from "../src/projects.ts";

const app = await buildApp();
afterAll(() => app.close());

it("reads a cold chat from disk and opens the assistant only when continuing it", async () => {
  const project = createProject({ name: "Cold chat history" });
  const paths = resolvePaths(project.id);
  const manager = SessionManager.create(paths.sandbox, paths.sessionsDir);
  manager.appendMessage({ role: "user", content: "Original saved prompt", timestamp: Date.now() });
  const id = manager.getSessionId();
  const headers = { "X-Project-Id": project.id };
  const history = () => app.inject({ method: "GET", url: `/sessions/${id}/history`, headers });
  const receivedPrompts: string[] = [];
  const observe = vi.fn<SessionObserverFactory>((ctx) => {
    ctx.session.agent.streamFunction = (model, context) => {
      receivedPrompts.push(JSON.stringify(context.messages));
      const message: AssistantMessage = {
        role: "assistant", api: model.api, provider: model.provider, model: model.id,
        content: [{ type: "text", text: "Continued" }], stopReason: "stop", timestamp: Date.now(),
        usage: { input: 20, output: 5, cacheRead: 0, cacheWrite: 0, totalTokens: 25,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
      };
      const stream = createAssistantMessageEventStream();
      stream.push({ type: "done", reason: "stop", message });
      return stream;
    };
    return attachSessionObserver({ ...ctx, log: app.log });
  });
  setSessionObserver(observe);
  try {
    const restored = await history();
    expect(restored.statusCode).toBe(200);
    expect(restored.json()).toMatchObject({
      messages: [{ role: "user", content: "Original saved prompt" }], contextUsage: null,
    });
    expect(observe).not.toHaveBeenCalled();

    const continued = await app.inject({
      method: "POST", url: `/sessions/${id}/run`, headers,
      payload: { message: "Follow-up prompt", model: "ollama/history-test" },
    });
    expect(continued.statusCode).toBe(200);
    expect(continued.body).toContain('"type":"done"');
    expect(observe).toHaveBeenCalledOnce();
    expect(receivedPrompts).toHaveLength(1);
    expect(receivedPrompts[0]).toContain("Original saved prompt");
    expect(receivedPrompts[0]).toContain("Follow-up prompt");
    const updated = (await history()).json();
    expect(updated.messages).toContainEqual(expect.objectContaining({ role: "user", content: "Follow-up prompt" }));
    expect(updated.contextUsage).toEqual(expect.objectContaining({ contextWindow: expect.any(Number) }));
  } finally {
    await disposeSession(project.id, id);
    runBroker.clear();
    setSessionObserver((ctx) => attachSessionObserver({ ...ctx, log: app.log }));
  }
}, 30_000);

it("clears the sidebar running state after stop while the run is still finalizing", async () => {
  const project = createProject({ name: "Stopped chat history" });
  const session = await createSession(project.id, resolvePaths(project.id));
  const id = session.sessionId;
  const prompt = "Check the sample data";
  session.sessionManager.appendMessage({ role: "user", content: prompt, timestamp: Date.now() });
  const headers = { "X-Project-Id": project.id };
  const list = async () => (await app.inject({ method: "GET", url: "/sessions", headers })).json();
  const run = runBroker.start(project.id, id, {
    runId: "stopping-run", prompt, images: [], baseline: { messages: [], contextUsage: null },
  });
  try {
    expect(await list()).toEqual([expect.objectContaining({ id, isRunning: true })]);
    const response = await app.inject({ method: "POST", url: `/sessions/${id}/abort`, headers });
    expect(response.statusCode).toBe(200);
    expect(run.isAbortRequested).toBe(true);
    expect(run.isComplete).toBe(false);
    expect(await list()).toEqual([expect.objectContaining({ id, isRunning: false })]);
  } finally {
    run.complete();
    await disposeSession(project.id, id);
    runBroker.clear();
  }
}, 30_000);

it("lists the saved prompt during a slow first answer and preserves it after an error", async () => {
  const project = createProject({ name: "First prompt history" });
  const session = await createSession(project.id, resolvePaths(project.id));
  const id = session.sessionId;
  expect(session.getActiveToolNames()).toContain("scientific_result");
  expect(session.getActiveToolNames()).not.toContain("notebook");
  const headers = { "X-Project-Id": project.id };
  const list = async () => (await app.inject({ method: "GET", url: "/sessions", headers })).json();
  const timeline = async () => (await app.inject({ method: "GET", url: `/sessions/${id}/timeline`, headers })).json();
  const model = session.model!;
  const runtime = getModelRuntime();
  await runtime.setRuntimeApiKey(model.provider, "test-only");
  const stream = createAssistantMessageEventStream();
  const provider = vi.fn(() => stream);
  session.agent.streamFunction = provider;
  const partial = {
    role: "assistant" as const, api: model.api, provider: model.provider, model: model.id,
    content: [], stopReason: "stop" as const, timestamp: Date.now(),
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
  };
  const summary = "I will inspect the two inputs before comparing them.";
  const reasoning = { ...partial, content: [{ type: "thinking" as const, thinking: summary }] };
  const readDefaults = appSettings.readAppDefaults;
  const defaults = vi.spyOn(appSettings, "readAppDefaults").mockImplementation((dir) => ({
    ...readDefaults(dir), locale: "zh-CN",
  }));

  let run: PromiseLike<unknown> | undefined;
  try {
    expect(await list()).toEqual([]);
    run = app.inject({ method: "POST", url: `/sessions/${id}/run`, headers, payload: { message: "Analyze my data" } }).then((response) => {
      expect(response.statusCode).toBe(200);
      expect(response.body).toContain('"type":"done"');
    });
    await vi.waitFor(() => expect(provider).toHaveBeenCalledOnce());
    expect(session.agent.state.systemPrompt).toContain("<kady_reasoning_display>");
    expect(session.agent.state.systemPrompt).toContain("send one or two user-visible sentences before the first tool call");
    expect(session.agent.state.systemPrompt).toContain("main language of the latest human-written request");
    expect(session.agent.state.systemPrompt).toContain("If the request's language is unclear, use Simplified Chinese");
    expect(await list()).toEqual([expect.objectContaining({
      id, firstMessage: "Analyze my data", visibleInHistory: true, isRunning: true,
    })]);
    const replay = (await app.inject({ method: "GET", url: `/sessions/${id}/run/state`, headers })).json();
    expect(replay).toMatchObject({ status: "running", run: { prompt: "Analyze my data" } });
    expect(replay.run.frames).toContainEqual(expect.objectContaining({ type: "message_end", role: "user" }));
    expect(replay.run.frames.some((frame: { type: string }) => frame.type === "text_delta")).toBe(false);
    await vi.waitFor(async () => {
      const history = await timeline();
      expect(history.events).toContainEqual(expect.objectContaining({ type: "message_chunk", payload: {
        role: "user", channel: "input", content: { kind: "inline", value: "Analyze my data" },
      } }));
      expect(history.events.some((event: { type: string }) => event.type === "run_ended")).toBe(false);
    });
    stream.push({ type: "start", partial });
    stream.push({ type: "thinking_end", partial: reasoning, contentIndex: 0, content: summary });
    await vi.waitFor(async () => {
      const replay = (await app.inject({ method: "GET", url: `/sessions/${id}/run/state`, headers })).json();
      expect(replay.run.frames.filter((frame: { type: string }) => frame.type === "thinking_delta"))
        .toEqual([expect.objectContaining({ delta: summary, reasoningStart: true })]);
    });
  } finally {
    stream.push({ type: "error", reason: "error", error: {
      ...reasoning, stopReason: "error", errorMessage: "Test failure",
    } });
    try {
      await run;
    } finally {
      defaults.mockRestore();
      await disposeSession(project.id, id);
      runBroker.clear();
      await runtime.removeRuntimeApiKey(model.provider);
    }
  }

  expect(await list()).toEqual([expect.objectContaining({ id, visibleInHistory: true, isRunning: false })]);
  expect((await timeline()).events.at(-1)).toMatchObject({ type: "run_ended", payload: { outcome: "failed" } });
  const history = (await app.inject({ method: "GET", url: `/sessions/${id}/history`, headers })).json();
  expect(history.messages[0]).toMatchObject({ role: "user", content: "Analyze my data", entryId: expect.any(String) });
  expect(history.messages[1].frames).toContainEqual({
    type: "thinking_delta", delta: summary, reasoningStart: true,
  });
  await disposeSession(project.id, id);
}, 30_000);

it.each([
  { name: "a tool-only reply", useTool: true, nativeText: "", fallback: true },
  { name: "native commentary", useTool: true, nativeText: "我会先核对文件列表。", fallback: false },
  { name: "a direct answer", useTool: false, nativeText: "这是直接回答。", fallback: false },
])("provides one opening before tools for $name", async ({ useTool, nativeText, fallback }) => {
  const project = createProject({ name: "Chat opening" });
  const session = await createSession(project.id, resolvePaths(project.id));
  const id = session.sessionId;
  const headers = { "X-Project-Id": project.id };
  const request = "请核对输入文件，再汇报核对结果。";
  const opening = nativeText || "我会先列出输入文件，再核对有哪些文件需要检查。";
  const emptyCost = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 };
  const usage = { input: 10, output: 5, cacheRead: 0, cacheWrite: 0, totalTokens: 15, cost: emptyCost };
  let releaseOpening: (() => void) | undefined;
  let providerCalls = 0;
  session.agent.streamFunction = (model) => {
    const first = ++providerCalls === 1;
    const content: AssistantMessage["content"] = [];
    const text = first ? nativeText : "核对完成。";
    if (text) content.push({ type: "text", text });
    if (first && useTool) content.push({ type: "toolCall", id: "call-list", name: "ls", arguments: { path: "." } });
    const message: AssistantMessage = {
      role: "assistant", api: model.api, provider: model.provider, model: model.id, content, usage,
      stopReason: first && useTool ? "toolUse" : "stop", timestamp: Date.now(),
    };
    const stream = createAssistantMessageEventStream();
    stream.push({ type: "done", reason: message.stopReason, message });
    return stream;
  };
  const completion = vi.spyOn(getModelRuntime(), "completeSimple").mockImplementation(async (model) => {
    await new Promise<void>((resolve) => { releaseOpening = resolve; });
    return { role: "assistant", api: model.api, provider: model.provider, model: model.id,
      content: [{ type: "text", text: opening }], usage, stopReason: "stop", timestamp: Date.now() };
  });
  const run = app.inject({ method: "POST", url: `/sessions/${id}/run`, headers,
    payload: { message: request, model: "ollama/history-test" } }).then((response) => response);
  try {
    if (fallback) {
      await vi.waitFor(() => expect(releaseOpening).toBeDefined());
      const state = (await app.inject({ method: "GET", url: `/sessions/${id}/run/state`, headers })).json();
      expect(state.run.frames.some((frame: { type: string }) => frame.type === "tool_start")).toBe(false);
      expect(completion.mock.calls[0][1].messages[0].content).toContain(request);
      releaseOpening?.();
    }
    const response = await run;
    expect(response.statusCode).toBe(200);
    const liveFrames = response.body.split("\n").filter((line) => line.startsWith("data: ")).map((line) => JSON.parse(line.slice(6)));
    const history = (await app.inject({ method: "GET", url: `/sessions/${id}/history`, headers })).json();
    for (const frames of [liveFrames, history.messages[1].frames]) {
      const updates = frames.filter((frame: { type: string; delta?: string }) => frame.type === "text_delta" && frame.delta === opening);
      expect(updates).toHaveLength(1);
      if (useTool) {
        const start = frames.findIndex((frame: { type: string }) => frame.type === "tool_start");
        expect(start).toBeGreaterThan(frames.indexOf(updates[0]));
        expect(frames).toContainEqual(expect.objectContaining({ type: "tool_end", toolCallId: "call-list", isError: false }));
      }
    }
    expect(completion).toHaveBeenCalledTimes(fallback ? 1 : 0);
    expect(session.getSessionStats().tokens.total).toBe(useTool ? 30 + (fallback ? 15 : 0) : 15);
  } finally {
    releaseOpening?.();
    await run;
    completion.mockRestore();
    await disposeSession(project.id, id);
    runBroker.clear();
  }
}, 30_000);

it("includes a stored user-only task and keeps a sole synthetic wake prompt hidden", async () => {
  const project = createProject({ name: "User-only task history" });
  const paths = resolvePaths(project.id);
  fs.mkdirSync(paths.sessionsDir, { recursive: true });
  const user = SessionManager.create(paths.sandbox, paths.sessionsDir);
  user.appendMessage({ role: "user", content: "Unanswered prompt", timestamp: Date.now() });
  const system = SessionManager.create(paths.sandbox, paths.sessionsDir);
  system.appendMessage({ role: "user", content: PARENT_WAKE_TEXT, timestamp: Date.now() });
  const response = await app.inject({ method: "GET", url: "/sessions", headers: { "X-Project-Id": project.id } });
  expect(response.statusCode).toBe(200);
  expect(response.json()).toEqual(expect.arrayContaining([
    expect.objectContaining({ id: user.getSessionId(), messageCount: 1, visibleInHistory: true, isRunning: false }),
    expect.objectContaining({ id: system.getSessionId(), messageCount: 1, visibleInHistory: false }),
  ]));
});
