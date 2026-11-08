import fs from "node:fs";
import { afterAll, describe, expect, it } from "vitest";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { buildApp } from "../src/index.ts";
import { createProject, resolvePaths } from "../src/projects.ts";
const app = await buildApp();
afterAll(() => app.close());
describe("saved session model selection", () => {
  it("reads the durable choice without replacing an unavailable provider with the runtime default", async () => {
    const project = createProject({ name: "Saved selection" });
    const paths = resolvePaths(project.id);
    fs.mkdirSync(paths.sessionsDir, { recursive: true });
    const session = SessionManager.create(paths.sandbox, paths.sessionsDir);
    session.appendModelChange("unconfigured-provider", "chosen/model");
    session.appendMessage({ role: "user", content: "A saved conversation", timestamp: Date.now() });
    const response = await app.inject({ method: "GET", url: `/sessions/${session.getSessionId()}/selection`, headers: { "X-Project-Id": project.id } });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ model: "unconfigured-provider/chosen/model" });
    const other = createProject({ name: "Other project selection" });
    expect((await app.inject({ method: "GET", url: `/sessions/${session.getSessionId()}/selection`, headers: { "X-Project-Id": other.id } })).statusCode).toBe(404);
  });
});
