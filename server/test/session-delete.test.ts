import fs from "node:fs";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { buildApp } from "../src/index.ts";
import { createProject, resolvePaths } from "../src/projects.ts";
import { findSessionFile } from "../src/agent/session-export.ts";
import { claimRun } from "../src/agent/run-pipeline.ts";

const app = await buildApp();
afterAll(() => app.close());
function savedChat() {
  const project = createProject({ name: "Delete history fixture" });
  const paths = resolvePaths(project.id);
  fs.mkdirSync(paths.sessionsDir, { recursive: true });
  const session = SessionManager.create(paths.sandbox, paths.sessionsDir);
  session.appendMessage({ role: "user", content: "Disposable test transcript", timestamp: Date.now() });
  return { project, paths, id: session.getSessionId() };
}

describe("delete saved chats", () => {
  it("removes persisted history from discovery and replay while retaining other project records", async () => {
    const { project, paths, id } = savedChat();
    const headers = { "X-Project-Id": project.id };
    const file = findSessionFile(paths, id)!;
    const transcript = fs.readFileSync(file, "utf8");
    const artifact = path.join(paths.sandbox, "result.txt");
    fs.writeFileSync(artifact, "Research output");
    const response = await app.inject({ method: "DELETE", url: `/sessions/${id}`, headers });
    expect(response.statusCode).toBe(200);
    expect(findSessionFile(paths, id)).toBeNull();
    const list = await app.inject({ method: "GET", url: "/sessions", headers });
    expect(list.json().some((s: { id: string }) => s.id === id)).toBe(false);
    expect((await app.inject({ method: "GET", url: `/sessions/${id}/history`, headers })).statusCode).toBe(404);
    expect(fs.readFileSync(artifact, "utf8")).toBe("Research output");
    const trash = path.join(path.dirname(paths.sessionsDir), "sessions-trash");
    expect(fs.readFileSync(path.join(trash, fs.readdirSync(trash)[0]), "utf8")).toBe(transcript);
  });

  it("refuses deletion during a claimed run without touching the transcript", async () => {
    const { project, paths, id } = savedChat();
    const claim = claimRun(project.id, id)!;
    try {
      const response = await app.inject({ method: "DELETE", url: `/sessions/${id}`, headers: { "X-Project-Id": project.id } });
      expect(response.statusCode).toBe(409);
      expect(findSessionFile(paths, id)).not.toBeNull();
    } finally { claim.release(); }
  });

  it("cannot delete a different project's conversation", async () => {
    const { project, paths, id } = savedChat();
    const other = createProject({ name: "Other project" });
    const response = await app.inject({ method: "DELETE", url: `/sessions/${id}`, headers: { "X-Project-Id": other.id } });
    expect(response.statusCode).toBe(404);
    expect(findSessionFile(paths, id)).not.toBeNull();
    expect(project.id).not.toBe(other.id);
  });

  it("does not resolve a partial id to another session's filename", async () => {
    const { project, paths, id } = savedChat();
    const response = await app.inject({ method: "DELETE", url: `/sessions/${id.slice(-12)}`, headers: { "X-Project-Id": project.id } });
    expect(response.statusCode).toBe(404);
    expect(findSessionFile(paths, id)).not.toBeNull();
  });
});
