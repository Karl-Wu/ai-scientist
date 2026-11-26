import { AsyncLocalStorage } from "node:async_hooks";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Type } from "typebox";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { PORT } from "../config.ts";
import { isCorsOriginAllowed } from "../cors.ts";

const context = new AsyncLocalStorage<string | undefined>();
export function withPreviewOrigin<T>(origin: string | undefined, fn: () => T): T {
  let trusted: string | undefined;
  if (origin && isCorsOriginAllowed(origin) && URL.canParse(origin) && new URL(origin).origin === origin) {
    trusted = origin;
  }
  return context.run(trusted, fn);
}

interface Adapter { id: string; project: string; description: string; executable: string; args: string[] }
function adapters(project: string): Adapter[] {
  const file = process.env.KADY_PREVIEW_ADAPTERS ?? path.join(os.homedir(), ".config", "kady", "preview-adapters.json");
  if (!path.isAbsolute(file) || !fs.existsSync(file)) return [];
  try {
    const entries: Adapter[] = JSON.parse(fs.readFileSync(file, "utf8"));
    return entries.filter(a => a.project === project && /^[a-z][a-z0-9_-]*$/.test(a.id) &&
      typeof a.description === "string" && path.isAbsolute(a.executable) && Array.isArray(a.args) && a.args.every(s => typeof s === "string"));
  } catch { throw new Error("Invalid local preview adapter configuration."); }
}

const pages = new Map<string, { origin: string; project: string; session: string; url: string; expires: number }>();
export function resolvePreview(id: string, origin: string | undefined, project: string, session: string) {
  const entry = pages.get(id);
  if (entry && entry.expires <= Date.now()) pages.delete(id);
  else if (entry && entry.origin === origin && entry.project === project && entry.session === session) return entry.url;
}

export function allowedPreviewUrl(value: unknown, origin: string): value is string {
  if (typeof value !== "string" || value.length > 8192 || /[\s\\\x00-\x1f]/.test(value)) return false;
  const match = /^http:\/\/(?:localhost|127\.0\.0\.1):(\d{1,5})(?:[/?#]|$)/.exec(value);
  if (!match) return false;
  const port = Number(match[1]);
  const parent = new URL(origin);
  return port > 0 && port < 65536 && port !== PORT && port !== Number(parent.port || (parent.protocol === "https:" ? 443 : 80)) &&
    !isCorsOriginAllowed(new URL(value).origin);
}

const adapterFailed = "The local preview adapter failed.";

function adapterError(output: string): string {
  try {
    const message = JSON.parse(output)?.error?.user_message;
    if (typeof message === "string" && message.trim() && message.length <= 240 &&
        !/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]|:\/\/|[#<>]/u.test(message)) return message.trim();
  } catch { /* Raw adapter output is private. */ }
  return adapterFailed;
}

const parameters = Type.Object({ adapter: Type.String(), resource: Type.String({ pattern: "^[A-Za-z0-9_.-]{1,128}$" }) });
export function localPreviewTools(project: string, sessionId: () => string, workspace: string): ToolDefinition<typeof parameters>[] {
  const installed = adapters(project);
  if (!installed.length) return [];
  return [{
    name: "open_local_preview", label: "Open local preview", parameters,
    description: "Open a trusted local application in the HTML Preview panel. Supply its resource ID. The result renders an Open preview button; do not write links or credentials in chat. Available adapters: " +
      installed.map(a => a.id + " (" + a.description + ")").join(", "),
    async execute(_id, { adapter, resource }, signal) {
      const origin = context.getStore();
      const session = sessionId();
      const config = adapters(project).find(a => a.id === adapter);
      if (!origin || !session || !config || !/^[A-Za-z0-9_.-]{1,128}$/.test(resource)) throw new Error("Local preview is unavailable for this request.");
      const stdout = await new Promise<string>((resolve, reject) => {
        const child = execFile(config.executable, config.args, { cwd: path.dirname(config.executable),
          env: { PATH: process.env.PATH, HOME: os.homedir(), SystemRoot: process.env.SystemRoot },
          timeout: 30000, maxBuffer: 32768, windowsHide: true, signal },
          (err, output) => err ? reject(new Error(typeof err.code === "number" && !err.killed ? adapterError(output) : adapterFailed)) : resolve(output));
        child.stdin?.on("error", () => {}).end(JSON.stringify({ platform_origin: origin, project_id: project, workspace, resource }));
      });
      let action;
      try { action = JSON.parse(stdout).open_preview; } catch { /* never echo adapter output */ }
      if (action?.kind !== "local_url" || !allowedPreviewUrl(action.url, origin) || typeof action.title !== "string" ||
          !action.title.trim() || action.title.length > 120 || /[\r\n]|:\/\//.test(action.title)) throw new Error("Invalid local preview action.");
      for (const [id, page] of pages) if (page.expires <= Date.now()) pages.delete(id);
      if (pages.size >= 1024) pages.delete(pages.keys().next().value!);
      const id = randomUUID();
      pages.set(id, { origin, project, session, url: action.url, expires: Date.now() + 8 * 3600000 });
      return { content: [{ type: "text", text: JSON.stringify({ previewId: id, title: action.title }) }], details: {} };
    },
  }];
}
