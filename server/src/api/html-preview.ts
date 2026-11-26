import { execFile } from "node:child_process";
import fs from "node:fs";
import { promisify } from "node:util";
import type { FastifyInstance } from "fastify";
import { isCorsOriginAllowed, isLoopbackHostname } from "../cors.ts";
import { safePath, SandboxError } from "../sandbox-fs.ts";
import { currentProjectId } from "../scope.ts";

import { resolvePreview } from "../agent/local-preview.ts";

const run = promisify(execFile);
const LOOPBACK_IPS = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);

async function launchBrowser(url: string): Promise<void> {
  if (process.platform === "win32") {
    // Pass the URL as data, not as part of a Windows shell command.
    await run("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", "Start-Process -FilePath $env:KADY_HTML_PREVIEW_URL"], {
      env: { ...process.env, KADY_HTML_PREVIEW_URL: url }, timeout: 10_000, windowsHide: true,
    });
    return;
  }
  await run(process.platform === "darwin" ? "open" : "xdg-open", [url], { timeout: 10_000 });
}

export function registerHtmlPreviewOpen(app: FastifyInstance, launch = launchBrowser): void {
  app.post<{ Params: { session: string; id: string } }>("/sessions/:session/local-previews/:id", async (req, reply) => {
    reply.header("Cache-Control", "no-store");
    const url = resolvePreview(req.params.id, req.headers.origin, currentProjectId(), req.params.session);
    return url ? { url } : reply.code(404).send({ detail: "Preview unavailable. Ask the tool to open it again." });
  });
  app.post<{ Body: { path?: unknown } }>("/sandbox/html-preview/open", async (req, reply) => {
    const origin = req.headers.origin;
    if (!origin || !isCorsOriginAllowed(origin) || !LOOPBACK_IPS.has(req.ip) ||
        !isLoopbackHostname(new URL(origin).hostname)) {
      return reply.code(403).send({ detail: "The system browser can only be opened from the local workspace." });
    }
    const path = req.body?.path;
    if (typeof path !== "string" || !/\.(html|htm)$/i.test(path)) {
      return reply.code(400).send({ detail: "Select an HTML file." });
    }
    try {
      const target = safePath(path);
      if (!(await fs.promises.stat(target)).isFile()) {
        return reply.code(404).send({ detail: "File not found." });
      }
      const url = new URL("/html-preview", new URL(origin).origin);
      url.searchParams.set("path", path);
      url.searchParams.set("project", currentProjectId());
      await launch(url.href);
      return { opened: true };
    } catch (error) {
      if (error instanceof SandboxError) return reply.code(error.statusCode).send({ detail: error.message });
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return reply.code(404).send({ detail: "The file or system browser could not be found." });
      }
      return reply.code(503).send({ detail: "Could not open the system browser." });
    }
  });
}
