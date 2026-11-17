import fs from "node:fs";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import { buildApp } from "../src/index.ts";
import { createProject, resolvePaths } from "../src/projects.ts";
import { findSessionFile } from "../src/agent/session-export.ts";
import { toHistory } from "../src/agent/session-history.ts";
import { forkAnswer, setAnswerFeedback, taskResponses } from "../src/agent/task-responses.ts";
import { claimRun } from "../src/agent/run-pipeline.ts";
import { sessionCostSummary } from "../src/cost/ledger.ts";

const app = await buildApp();
afterAll(() => app.close());
function reply(text: string, extra: Partial<AssistantMessage> = {}): AssistantMessage {
  return { role: "assistant", content: [{ type: "text", text }], api: "openai-completions", provider: "ollama", model: "test",
    usage: { input: 10, output: 5, cacheRead: 0, cacheWrite: 0, totalTokens: 15, cost: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, total: 2 } },
    stopReason: "stop", timestamp: Date.now(), ...extra };
}
function fixture() {
  const project = createProject({ name: "Task branching" });
  const paths = resolvePaths(project.id);
  fs.mkdirSync(paths.sessionsDir, { recursive: true });
  const manager = SessionManager.create(paths.sandbox, paths.sessionsDir);
  manager.appendModelChange("ollama", "test");
  manager.appendThinkingLevelChange("high");
  manager.appendMessage({ role: "user", content: [{ type: "text", text: "Research question" }, { type: "image", mimeType: "image/png", data: "aW1hZ2U=" }], timestamp: Date.now() });
  manager.appendMessage(reply("Checking", { stopReason: "toolUse", content: [{ type: "toolCall", id: "call-1", name: "read", arguments: { path: "data.csv" } }] }));
  manager.appendMessage({ role: "toolResult", toolCallId: "call-1", toolName: "read", content: [{ type: "text", text: "Evidence" }], isError: false, timestamp: Date.now() });
  const answerId = manager.appendMessage(reply("First answer"));
  manager.appendSessionInfo("Original task");
  return { project, paths, manager, answerId, id: manager.getSessionId(), file: manager.getSessionFile()! };
}

describe("answer actions and task forks", () => {
  it("preserves compaction boundaries and ignores later source changes", () => {
    const f = fixture();
    const firstKept = f.manager.appendMessage({ role: "user", content: "After compaction", timestamp: Date.now() });
    f.manager.appendCompaction("Earlier findings", firstKept, 1000);
    const last = f.manager.appendMessage(reply("Answer after compaction"));
    const child = forkAnswer(f.paths, f.id, last);
    const restored = SessionManager.open(findSessionFile(f.paths, child.id)!, f.paths.sessionsDir, f.paths.sandbox);
    expect(restored.buildSessionContext().messages).toEqual(f.manager.buildSessionContext().messages);
    f.manager.appendMessage({ role: "user", content: "Future source question", timestamp: Date.now() });
    f.manager.appendMessage(reply("Future source answer"));
    expect(taskResponses(f.paths, child.id).responses.map((r) => r.content)).not.toContain("Future source answer");
  });

  it("rejects unfinished tool exchanges even when a later assistant claims completion", () => {
    const f = fixture();
    f.manager.appendMessage({ role: "user", content: "Next question", timestamp: Date.now() });
    f.manager.appendMessage(reply("Pending", { stopReason: "toolUse", content: [{ type: "toolCall", id: "pending", name: "read", arguments: {} }] }));
    const last = f.manager.appendMessage(reply("Incomplete answer"));
    expect(() => forkAnswer(f.paths, f.id, last)).toThrow("incomplete tool exchange");
  });

  it("branches exactly at an answer with SDK context intact, without mutating its source or duplicating ledger costs", () => {
    const f = fixture();
    f.manager.appendMessage({ role: "user", content: "Later question", timestamp: Date.now() });
    f.manager.appendMessage(reply("Later answer"));
    const before = fs.readFileSync(f.file, "utf8");
    const child = forkAnswer(f.paths, f.id, f.answerId);
    const childFile = findSessionFile(f.paths, child.id)!;
    const restored = SessionManager.open(childFile, f.paths.sessionsDir, f.paths.sandbox);
    expect(fs.readFileSync(f.file, "utf8")).toBe(before);
    expect(child.name).toBe("Original task (1)");
    expect(restored.getBranch().some((entry) => entry.id === f.answerId)).toBe(true);
    expect(restored.buildSessionContext().messages.map((m) => m.role)).toEqual(["user", "assistant", "toolResult", "assistant"]);
    expect(restored.buildSessionContext().model).toEqual({ provider: "ollama", modelId: "test" });
    expect(restored.buildSessionContext().thinkingLevel).toBe("high");
    expect(toHistory(childFile)[0].images?.[0].data).toBe("aW1hZ2U=");
    expect(toHistory(childFile).some((m) => m.content === "Later question")).toBe(false);
    expect(taskResponses(f.paths, child.id).source).toMatchObject({ id: f.id, entryId: f.answerId });
    expect(sessionCostSummary(child.id, f.project.id).totalUsd).toBe(0);
    restored.appendMessage({ role: "user", content: "Independent continuation", timestamp: Date.now() });
    expect(fs.readFileSync(f.file, "utf8")).toBe(before);
  });

  it("persists mutually exclusive feedback across restarts and inherited answers, including nested forks", () => {
    const f = fixture();
    setAnswerFeedback(f.paths, f.id, f.answerId, "up");
    const child = forkAnswer(f.paths, f.id, f.answerId);
    const grandchild = forkAnswer(f.paths, child.id, f.answerId);
    expect(taskResponses(f.paths, grandchild.id).responses[0].feedback).toBe("up");
    setAnswerFeedback(f.paths, child.id, f.answerId, "down");
    expect(taskResponses(f.paths, f.id).responses[0].feedback).toBe("down");
    expect(taskResponses(f.paths, f.id).responses[0].children).toHaveLength(2);
    setAnswerFeedback(f.paths, grandchild.id, f.answerId, null);
    expect(taskResponses(f.paths, f.id).responses[0].feedback).toBeNull();
    const own = SessionManager.open(findSessionFile(f.paths, child.id)!, f.paths.sessionsDir, f.paths.sandbox);
    own.appendMessage({ role: "user", content: "Next", timestamp: Date.now() });
    const newId = own.appendMessage(reply("Independent answer"));
    setAnswerFeedback(f.paths, child.id, newId, "up");
    expect(taskResponses(f.paths, f.id).responses).toHaveLength(1);
    expect(taskResponses(f.paths, child.id).responses.at(-1)?.feedback).toBe("up");
  });

  it("validates answer boundaries, rejects cross-project actions and busy sources, and lists a fork immediately", async () => {
    const f = fixture();
    const headers = { "X-Project-Id": f.project.id };
    const url = `/sessions/${f.id}/responses/${f.answerId}`;
    const other = createProject({ name: "Other project" });
    expect((await app.inject({ method: "POST", url: `${url}/fork`, headers: { "X-Project-Id": other.id } })).statusCode).toBe(404);
    expect((await app.inject({ method: "PUT", url: `${url}/feedback`, headers, payload: { feedback: "invalid" } })).statusCode).toBe(400);
    expect((await app.inject({ method: "POST", url: `/sessions/${f.id}/responses/missing/fork`, headers })).statusCode).toBe(400);
    const claim = claimRun(f.project.id, f.id)!;
    try { expect((await app.inject({ method: "POST", url: `${url}/fork`, headers })).statusCode).toBe(409); }
    finally { claim.release(); }
    const result = await app.inject({ method: "POST", url: `${url}/fork`, headers });
    expect(result.statusCode).toBe(200);
    const list = (await app.inject({ method: "GET", url: "/sessions", headers })).json();
    expect(list).toContainEqual(expect.objectContaining({ id: result.json().id, name: "Original task (1)" }));
    expect((await app.inject({ method: "GET", url: `/sessions/${f.id}/responses`, headers })).json().responses[0].children).toHaveLength(1);
    fs.writeFileSync(path.join(f.paths.sandbox, ".kady", "task-responses.json"), "broken");
    expect(() => setAnswerFeedback(f.paths, f.id, f.answerId, "up")).toThrow();
  });
});
