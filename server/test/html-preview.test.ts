import fs from "node:fs";
import path from "node:path";
import Fastify from "fastify";
import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { registerHtmlPreviewOpen } from "../src/api/html-preview.ts";
import { ensureProjectExists, resolvePaths } from "../src/projects.ts";
import { withActiveProject } from "../src/scope.ts";

const project = "html-preview-test";
const origin = "http://127.0.0.1:3000";
const report = "source & target.HTML";
const launch = vi.fn(async (_url: string) => {});
const app = Fastify();
app.addHook("onRequest", (_request, _reply, done) => withActiveProject(project, done));
registerHtmlPreviewOpen(app, launch);

beforeAll(() => {
  vi.stubEnv("KADY_FRONTEND_PORT", "3000");
  ensureProjectExists(project);
  fs.writeFileSync(path.join(resolvePaths(project).sandbox, report), "<!doctype html><p>Report</p>");
});
beforeEach(() => launch.mockClear());
afterAll(async () => {
  vi.unstubAllEnvs();
  await app.close();
});

it("builds the external browser URL from the local UI origin and the scoped project", async () => {
  const result = await app.inject({
    method: "POST", url: "/sandbox/html-preview/open", headers: { origin },
    payload: { path: report, url: "https://example.org/" },
  });
  expect(result.statusCode).toBe(200);
  expect(launch).toHaveBeenCalledExactlyOnceWith(
    `${origin}/html-preview?path=source+%26+target.HTML&project=${project}`,
  );
});

it.each([
  { requestOrigin: "null", ip: "127.0.0.1", file: report, status: 403 },
  { requestOrigin: "http://localhost:3001", ip: "127.0.0.1", file: report, status: 403 },
  { requestOrigin: origin, ip: "192.0.2.1", file: report, status: 403 },
  { requestOrigin: origin, ip: "127.0.0.1", file: "report.txt", status: 400 },
  { requestOrigin: origin, ip: "127.0.0.1", file: "../report.html", status: 403 },
  { requestOrigin: origin, ip: "127.0.0.1", file: "missing.html", status: 404 },
])("does not launch for $requestOrigin, $ip or $file", async ({ requestOrigin, ip, file, status }) => {
  const result = await app.inject({
    method: "POST", url: "/sandbox/html-preview/open", headers: { origin: requestOrigin },
    remoteAddress: ip, payload: { path: file },
  });
  expect(result.statusCode).toBe(status);
  expect(launch).not.toHaveBeenCalled();
});
