import fs from "node:fs";
import path from "node:path";
import type { ProjectPaths } from "../projects.ts";
import { isRetiredNotebookTool } from "../../../web/src/lib/legacy-notebook.ts";

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isNotebookPackage(entry: unknown): boolean {
  const source = isRecord(entry) ? entry.source : entry;
  return typeof source === "string" && /[/\\]kady-notebook[/\\]*$/.test(source);
}

/** Remove the old bundled package and its retired tools from existing projects. */
export function retireNotebookTools(paths: ProjectPaths): boolean {
  const settingsPath = path.join(paths.sandbox, ".pi", "settings.json");
  let settings: unknown;
  try {
    settings = JSON.parse(fs.readFileSync(settingsPath, "utf-8"));
  } catch {
    return false;
  }
  if (!isRecord(settings)) return false;

  let changed = false;
  if (Array.isArray(settings.packages)) {
    const packages = settings.packages.filter((entry) => !isNotebookPackage(entry));
    if (packages.length !== settings.packages.length) {
      settings.packages = packages;
      changed = true;
    }
  }

  const overrides = isRecord(settings.subagents) ? settings.subagents.agentOverrides : undefined;
  if (isRecord(overrides)) {
    for (const override of Object.values(overrides)) {
      if (!isRecord(override) || !Array.isArray(override.tools)) continue;
      const tools = override.tools.filter((name) => !isRetiredNotebookTool(name));
      if (tools.length !== override.tools.length) {
        override.tools = tools;
        changed = true;
      }
    }
  }
  if (changed) fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + "\n", "utf-8");
  return changed;
}
