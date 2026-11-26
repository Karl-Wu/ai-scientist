import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { allowedPreviewUrl, localPreviewTools, resolvePreview, withPreviewOrigin } from "../src/agent/local-preview.ts";

const origin = "http://127.0.0.1:3000";
const root = fs.mkdtempSync(path.join(os.tmpdir(), "preview-adapter-test-"));
afterEach(() => { vi.unstubAllEnvs(); fs.rmSync(root, { recursive: true, force: true }); });

it("accepts only explicit local HTTP services outside the platform", () => {
  for (const url of ["http://localhost:9911/p?q=1#secret", "http://127.0.0.1:43000"])
    expect(allowedPreviewUrl(url, origin)).toBe(true);
  for (const url of ["https://localhost:9911", "http://localhost", "http://127.1:9911", "http://localhost.evil:8001",
    "http://user@localhost:9400", "http://localhost:3000", "http://localhost:8000", "http://localhost:70000",
    "http://localhost:0", "http://localhost:9400@remote", "http://localhost:9400\\remote", "http://example.com:9911"])
    expect(allowedPreviewUrl(url, origin)).toBe(false);
});

it("binds the private address to the browser origin, project and session before returning a recordable result", async () => {
  fs.mkdirSync(root, { recursive: true });
  const script = path.join(root, "adapter.cjs");
  fs.writeFileSync(script, `let input = "";
    process.stdin.on("data", d => input += d);
    process.stdin.on("end", () => {
      if (JSON.parse(input).platform_origin !== ${JSON.stringify(origin)}) process.exit(2);
      console.log(JSON.stringify({open_preview:{kind:"local_url",title:"Editor",url:"http://localhost:9881/page?q=x#test-credential"}}));
    });`);
  const config = path.join(root, "config.json");
  fs.writeFileSync(config, JSON.stringify([{ project:"a", id:"sample", executable:process.execPath, args:[script], description:"Test" }]));
  vi.stubEnv("KADY_PREVIEW_ADAPTERS", config);
  expect(localPreviewTools("b", () => "s", root)).toHaveLength(0);
  const tool = localPreviewTools("a", () => "s", root)[0];
  const execute = () => tool.execute("call", {adapter:"sample",resource:"example"}, undefined, undefined, {} as never);
  await expect(withPreviewOrigin("http://unknown.invalid", execute)).rejects.toThrow();
  const result = await withPreviewOrigin(origin, execute);
  expect(JSON.stringify(result)).not.toMatch(/test-credential|localhost:9881/);
  const text = result.content[0];
  if (text.type !== "text") throw Error("Missing action");
  const { previewId } = JSON.parse(text.text);
  expect(resolvePreview(previewId, origin, "a", "s")).toBe("http://localhost:9881/page?q=x#test-credential");
  expect(resolvePreview(previewId, "http://localhost:3000", "a", "s")).toBeUndefined();
  expect(resolvePreview(previewId, origin, "b", "s")).toBeUndefined();
  expect(resolvePreview(previewId, origin, "a", "other")).toBeUndefined();
});

it("declares the configured adapter to the lead model in new and restored chats", async () => {
  const { createSession, getSession, disposeProjectSessions } = await import("../src/agent/session-registry.ts");
  const { ensureProjectExists } = await import("../src/projects.ts");
  const project = "preview-tool-loadout";
  const paths = ensureProjectExists(project);
  fs.mkdirSync(root, { recursive: true });
  const config = path.join(root, "adapters.json");
  fs.writeFileSync(config, JSON.stringify([{
    project, id: "sample-review", executable: process.execPath, args: [], description: "Open a review.",
  }]));
  vi.stubEnv("KADY_PREVIEW_ADAPTERS", config);
  try {
    const session = await createSession(project, paths);
    const declaration = { name: "open_local_preview", description: expect.stringContaining("sample-review") };
    expect(session.agent.state.tools).toContainEqual(expect.objectContaining(declaration));
    // Older chats persisted an explicit loadout before the adapter was installed.
    session.sessionManager.appendMessage({
      role: "system", content: "", timestamp: Date.now(),
      toolsAdded: [{ name: "read", description: "Read files", parameters: { type: "object", properties: {} } }],
    });
    session.sessionManager.appendMessage({ role: "user", content: "Preview loadout test", timestamp: Date.now() });
    const id = session.sessionId;
    await disposeProjectSessions(project);
    const restored = await getSession(project, paths, id);
    expect(restored?.agent.state.tools.map(t => t.name)).toContain("read");
    expect(restored?.agent.state.tools.map(t => t.name)).not.toContain("bash");
    expect(restored?.agent.state.tools).toContainEqual(expect.objectContaining(declaration));
  } finally {
    await disposeProjectSessions(project);
  }
}, 30_000);
