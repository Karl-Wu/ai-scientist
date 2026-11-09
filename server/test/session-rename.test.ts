import fs from "node:fs";
import { afterAll, describe, expect, it } from "vitest";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { buildApp } from "../src/index.ts";
import { createProject, resolvePaths } from "../src/projects.ts";
import { disposeSession, getSession } from "../src/agent/session-registry.ts";

const app = await buildApp();
afterAll(() => app.close());
function savedChat() {
  const project = createProject({ name: "Rename fixture" });
  const paths = resolvePaths(project.id);
  fs.mkdirSync(paths.sessionsDir, { recursive: true });
  const manager = SessionManager.create(paths.sandbox, paths.sessionsDir);
  manager.appendMessage({ role: "user", content: "Research question", timestamp: Date.now() });
  return { project, paths, id: manager.getSessionId() };
}

describe("rename a saved chat", () => {
  it.each([false, true])("persists the name and leaves the transcript intact (live=%s)", async (live) => {
    const { project, paths, id } = savedChat();
    const session = live ? await getSession(project.id, paths, id) : null;
    const headers = { "X-Project-Id": project.id };
    const url = `/sessions/${id}`;
    const response = await app.inject({ method: "PATCH", url, headers, payload: { name: "  新的会话名称  " } });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ id, name: "新的会话名称" });
    if (live) expect(session?.sessionManager.getSessionName()).toBe("新的会话名称");
    await disposeSession(project.id, id);
    const list = (await app.inject({ method: "GET", url: "/sessions", headers })).json();
    expect(list).toContainEqual(expect.objectContaining({ id, name: "新的会话名称", messageCount: 1, firstMessage: "Research question" }));
    expect((await getSession(project.id, paths, id))?.sessionManager.getSessionName()).toBe("新的会话名称");
    await disposeSession(project.id, id);
  });

  it("rejects empty names and prevents renaming another project's chat", async () => {
    const { project, id } = savedChat();
    const other = createProject({ name: "Other rename project" });
    const url = `/sessions/${id}`;
    expect((await app.inject({ method: "PATCH", url, headers: { "X-Project-Id": project.id }, payload: { name: "  " } })).statusCode).toBe(400);
    expect((await app.inject({ method: "PATCH", url, headers: { "X-Project-Id": other.id }, payload: { name: "Not mine" } })).statusCode).toBe(404);
  });
});
