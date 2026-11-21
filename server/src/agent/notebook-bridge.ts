/** Share read-only notebook search with child Pi sessions. */
import fs from "node:fs";
import path from "node:path";
import type { ProjectPaths } from "../projects.ts";
import { subagentsPackageDir } from "./agent-files.ts";
import { reconcileBuiltinTools, uniqueTools } from "./builtin-tool-overrides.ts";
import { MODAL_TOOL_NAMES } from "./modal-tool.ts";
import { PDF_ANNOTATION_TOOL_NAMES } from "./pdf-annotation-tool.ts";

/** Absolute dir of the vendored kady-notebook package. */
export function kadyNotebookPackageDir(): string {
  // server/src/agent/notebook-bridge.ts → server/pi-packages/kady-notebook
  return path.resolve(import.meta.dirname, "..", "..", "pi-packages", "kady-notebook");
}

/** True when `entry` points at our kady-notebook package dir. */
function isNotebookSource(entry: unknown): entry is string {
  return (
    typeof entry === "string" &&
    /[/\\]kady-notebook$/.test(entry.replace(/[/\\]+$/, ""))
  );
}

/**
 * Reference kady-notebook from the project settings file. Returns true when the
 * file was written. A settings file we cannot parse is left untouched.
 */
export function seedNotebookPackage(paths: ProjectPaths): boolean {
  const dir = path.join(paths.sandbox, ".pi");
  const settingsPath = path.join(dir, "settings.json");
  let settings: Record<string, unknown> = {};
  try {
    settings = JSON.parse(fs.readFileSync(settingsPath, "utf-8")) as Record<string, unknown>;
  } catch (exc) {
    if ((exc as NodeJS.ErrnoException).code !== "ENOENT") return false;
  }
  const pkgDir = kadyNotebookPackageDir();
  const packages = Array.isArray(settings.packages) ? [...(settings.packages as unknown[])] : [];
  const kept = packages.filter((p) => !isNotebookSource(p) || p === pkgDir);
  if (kept.includes(pkgDir) && kept.length === packages.length) return false;
  if (!kept.includes(pkgDir)) kept.push(pkgDir);
  settings.packages = kept;
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + "\n", "utf-8");
  return true;
}

/** Dir of pi-subagents' builtin agent definitions (agents/*.md), if installed. */
function builtinAgentsDir(): string | null {
  try {
    return path.join(subagentsPackageDir(), "agents");
  } catch {
    return null;
  }
}

/** Groups the later bridges add, so a list they already extended is recognized. */
const MODAL_AND_PDF_SHAPES: readonly (readonly string[])[] = [
  MODAL_TOOL_NAMES,
  PDF_ANNOTATION_TOOL_NAMES,
  [...MODAL_TOOL_NAMES, ...PDF_ANNOTATION_TOOL_NAMES],
];

/** Minimal frontmatter read: `name:` and comma-separated `tools:` lines. */
function parseAgentFrontmatter(file: string): { name?: string; tools?: string[] } {
  let raw: string;
  try {
    raw = fs.readFileSync(file, "utf-8");
  } catch {
    return {};
  }
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(raw);
  if (!match) return {};
  const out: { name?: string; tools?: string[] } = {};
  for (const line of match[1].split(/\r?\n/)) {
    const name = /^name:\s*(.+?)\s*$/.exec(line);
    if (name) out.name = name[1];
    const tools = /^tools:\s*(.+?)\s*$/.exec(line);
    if (tools) {
      out.tools = tools[1]
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean);
    }
  }
  return out;
}

/** Update generated specialist allowlists to use search and retire notebook writes. */
export function seedBuiltinAgentNotebookTools(paths: ProjectPaths): boolean {
  const agentsDir = builtinAgentsDir();
  if (!agentsDir) return false;
  let files: string[];
  try {
    files = fs.readdirSync(agentsDir).filter((f) => f.endsWith(".md"));
  } catch {
    return false;
  }
  const dir = path.join(paths.sandbox, ".pi");
  const settingsPath = path.join(dir, "settings.json");
  let settings: Record<string, unknown> = {};
  try {
    settings = JSON.parse(fs.readFileSync(settingsPath, "utf-8")) as Record<string, unknown>;
  } catch (exc) {
    if ((exc as NodeJS.ErrnoException).code !== "ENOENT") return false;
  }
  const subagents =
    settings.subagents && typeof settings.subagents === "object" && !Array.isArray(settings.subagents)
      ? (settings.subagents as Record<string, unknown>)
      : {};
  const overrides =
    subagents.agentOverrides &&
    typeof subagents.agentOverrides === "object" &&
    !Array.isArray(subagents.agentOverrides)
      ? (subagents.agentOverrides as Record<string, unknown>)
      : {};

  let changed = false;
  for (const file of files) {
    const { name, tools } = parseAgentFrontmatter(path.join(agentsDir, file));
    if (!name || !tools?.length) continue;
    const existing = overrides[name];
    if (existing !== undefined && (typeof existing !== "object" || existing === null || Array.isArray(existing))) {
      continue; // malformed user entry — leave it alone
    }
    const override = (existing ?? {}) as Record<string, unknown>;
    if ("tools" in override) {
      // Not simply "user pinned, skip": an override we seeded before an
      // upstream release narrowed this builtin still carries the tools that
      // release removed, so a Kady-shaped list is reconciled rather than left.
      if (!Array.isArray(override.tools) || override.tools.some((t) => typeof t !== "string")) {
        continue;
      }
      const existingTools = override.tools as string[];
      const bases = [
        uniqueTools([...tools, "notebook"]),
        uniqueTools([...tools, "notebook_search"]),
        uniqueTools([...tools, "notebook", "notebook_search"]),
      ];
      const next = reconcileBuiltinTools({
        existing: existingTools,
        declared: tools,
        add: ["notebook_search"],
        remove: ["notebook"],
        shapes: bases.flatMap((base) => [base, ...MODAL_AND_PDF_SHAPES.map((extra) => uniqueTools([...base, ...extra]))]),
      });
      if (!next) continue;
      overrides[name] = { ...override, tools: next };
      changed = true;
      continue;
    }
    overrides[name] = { ...override, tools: uniqueTools([...tools.filter((tool) => tool !== "notebook"), "notebook_search"]) };
    changed = true;
  }
  if (!changed) return false;
  subagents.agentOverrides = overrides;
  settings.subagents = subagents;
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + "\n", "utf-8");
  return true;
}
