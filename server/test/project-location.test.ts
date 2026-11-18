import fs from "node:fs";
import Fastify from "fastify";
import { afterAll, describe, expect, it, vi } from "vitest";
const launch = vi.hoisted(() => vi.fn((_command: string, _args: string[], _options: unknown, callback: (error: Error | null) => void) => callback(null)));
vi.mock("node:child_process", async (original) => ({ ...await original<typeof import("node:child_process")>(), execFile: launch }));
import { registerProjectRoutes } from "../src/api/projects.ts";
import { createProject, resolvePaths, updateProject } from "../src/projects.ts";
const app = Fastify();
await registerProjectRoutes(app);
const project = createProject({ name: "中文项目" });
afterAll(async () => { await app.close(); fs.rmSync(resolvePaths(project.id).root, { recursive: true, force: true }); });
describe("project locations", () => {
  it("returns the actual location after renaming a Chinese project", async () => {
    updateProject(project.id, { name: "重命名项目" });
    const response = await app.inject(`/projects/${project.id}/location`);
    const paths = resolvePaths(project.id);
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ root: paths.root, sandbox: paths.sandbox, uploads: paths.uploadDir });
  });
  it("opens only the resolved project folder, ignoring supplied paths", async () => {
    launch.mockClear();
    const response = await app.inject({ method: "POST", url: `/projects/${project.id}/open-folder`, payload: { path: "/arbitrary" } });
    expect(response.statusCode).toBe(200);
    expect(launch.mock.calls[0][1]).toEqual([resolvePaths(project.id).root]);
  });
  it("does not open the host desktop for remote clients or missing projects", async () => {
    launch.mockClear();
    expect((await app.inject({ method: "POST", url: `/projects/${project.id}/open-folder`, remoteAddress: "192.168.1.50" })).statusCode).toBe(403);
    expect((await app.inject({ method: "POST", url: "/projects/not-a-project/open-folder" })).statusCode).toBe(404);
    expect(launch).not.toHaveBeenCalled();
  });
});
