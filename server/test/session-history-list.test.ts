import fs from "node:fs";
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { afterAll, expect, it, vi } from "vitest";
import { runBroker } from "../src/agent/run-broker.ts";
import { createSession, disposeSession, getModelRuntime } from "../src/agent/session-registry.ts";
import { PARENT_WAKE_TEXT } from "../src/agent/subagent-wake.ts";
import { buildApp } from "../src/index.ts";
import { createProject, resolvePaths } from "../src/projects.ts";

const app = await buildApp();
afterAll(() => app.close());

it("lists the saved prompt during a slow first answer and preserves it after an error", async () => {
  const project = createProject({ name: "First prompt history" });
  const session = await createSession(project.id, resolvePaths(project.id));
  const id = session.sessionId;
  const headers = { "X-Project-Id": project.id };
  const list = async () => (await app.inject({ method: "GET", url: "/sessions", headers })).json();
  const model = session.model!;
  const runtime = getModelRuntime();
  await runtime.setRuntimeApiKey(model.provider, "test-only");
  const stream = createAssistantMessageEventStream();
  const provider = vi.fn(() => stream);
  session.agent.streamFunction = provider;

  let run: PromiseLike<unknown> | undefined;
  try {
    expect(await list()).toEqual([]);
    run = app.inject({ method: "POST", url: `/sessions/${id}/run`, headers, payload: { message: "Analyze my data" } }).then((response) => {
      expect(response.statusCode).toBe(200);
      expect(response.body).toContain('"type":"done"');
    });
    await vi.waitFor(() => expect(provider).toHaveBeenCalledOnce());
    expect(await list()).toEqual([expect.objectContaining({
      id, firstMessage: "Analyze my data", visibleInHistory: true, isRunning: true,
    })]);
    const replay = (await app.inject({ method: "GET", url: `/sessions/${id}/run/state`, headers })).json();
    expect(replay).toMatchObject({ status: "running", run: { prompt: "Analyze my data" } });
    expect(replay.run.frames).toContainEqual(expect.objectContaining({ type: "message_end", role: "user" }));
    expect(replay.run.frames.some((frame: { type: string }) => frame.type === "text_delta")).toBe(false);
  } finally {
    stream.push({ type: "error", reason: "error", error: {
      role: "assistant", api: model.api, provider: model.provider, model: model.id,
      content: [], stopReason: "error", errorMessage: "Test failure", timestamp: Date.now(),
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    } });
    try {
      await run;
    } finally {
      await disposeSession(project.id, id);
      runBroker.clear();
      await runtime.removeRuntimeApiKey(model.provider);
    }
  }

  expect(await list()).toEqual([expect.objectContaining({ id, visibleInHistory: true, isRunning: false })]);
  const history = (await app.inject({ method: "GET", url: `/sessions/${id}/history`, headers })).json();
  expect(history.messages[0]).toMatchObject({ role: "user", content: "Analyze my data" });
  await disposeSession(project.id, id);
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
