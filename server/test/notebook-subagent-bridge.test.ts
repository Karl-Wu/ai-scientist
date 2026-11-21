import { describe, it, expect, beforeEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { seedBuiltinAgentNotebookTools } from "../src/agent/notebook-bridge.ts";
import { resolvePaths } from "../src/projects.ts";
import { subagentsPackageDir } from "../src/agent/agent-files.ts";
import { PROJECTS_ROOT } from "../src/config.ts";

beforeEach(() => {
  fs.rmSync(PROJECTS_ROOT, { recursive: true, force: true });
  fs.mkdirSync(PROJECTS_ROOT, { recursive: true });
});

describe("seedBuiltinAgentNotebookTools", () => {
  function readSettings(projectId: string): Record<string, unknown> {
    const paths = resolvePaths(projectId);
    const file = path.join(paths.sandbox, ".pi", "settings.json");
    return JSON.parse(fs.readFileSync(file, "utf-8")) as Record<string, unknown>;
  }

  /** The `tools:` line the installed pi-subagents declares for a builtin. */
  function readBuiltinTools(name: string): string[] {
    const file = path.join(subagentsPackageDir(), "agents", `${name}.md`);
    const tools = /^tools:\s*(.+?)\s*$/m.exec(fs.readFileSync(file, "utf-8"));
    return (tools?.[1] ?? "").split(",").map((tool) => tool.trim()).filter(Boolean);
  }

  it("appends read-only notebook search to every builtin agent that pins a tools allowlist", () => {
    const paths = resolvePaths("default");
    fs.mkdirSync(paths.sandbox, { recursive: true });

    expect(seedBuiltinAgentNotebookTools(paths)).toBe(true);

    const settings = readSettings("default");
    const overrides = (settings.subagents as Record<string, unknown>)
      .agentOverrides as Record<string, { tools?: string[] }>;
    // researcher ships with a tools allowlist in pi-subagents — the exact list
    // tracks the installed package, and notebook search must be appended after it.
    const researcher = overrides.researcher;
    expect(researcher?.tools).toBeDefined();
    expect(researcher.tools).not.toContain("notebook");
    expect(researcher.tools).toContain("web_search");
    expect(researcher.tools?.at(-1)).toBe("notebook_search");
    for (const override of Object.values(overrides)) {
      expect(override.tools).not.toContain("notebook");
      expect(override.tools).toContain("notebook_search");
    }
  });

  it("is idempotent and preserves other override fields (e.g. disabled)", () => {
    const paths = resolvePaths("default");
    const dir = path.join(paths.sandbox, ".pi");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, "settings.json"),
      JSON.stringify({
        packages: ["/x/kady-notebook"],
        subagents: { agentOverrides: { researcher: { disabled: true } } },
      }),
      "utf-8",
    );

    expect(seedBuiltinAgentNotebookTools(paths)).toBe(true);
    expect(seedBuiltinAgentNotebookTools(paths)).toBe(false); // second run: no-op

    const settings = readSettings("default");
    const overrides = (settings.subagents as Record<string, unknown>)
      .agentOverrides as Record<string, { tools?: string[]; disabled?: boolean }>;
    expect(overrides.researcher.disabled).toBe(true);
    expect(overrides.researcher.tools).toContain("notebook_search");
    expect(settings.packages).toEqual(["/x/kady-notebook"]);
  });

  it("leaves a user-pinned tools override untouched", () => {
    const paths = resolvePaths("default");
    const dir = path.join(paths.sandbox, ".pi");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, "settings.json"),
      JSON.stringify({
        subagents: { agentOverrides: { researcher: { tools: ["read"] } } },
      }),
      "utf-8",
    );

    seedBuiltinAgentNotebookTools(paths);

    const settings = readSettings("default");
    const overrides = (settings.subagents as Record<string, unknown>)
      .agentOverrides as Record<string, { tools?: string[] }>;
    expect(overrides.researcher.tools).toEqual(["read"]);
  });

  it("drops tools an upstream release removed from a builtin's allowlist", () => {
    // pi-subagents 0.47.1 took bash/edit/write off `reviewer` to give read-only
    // review lanes a hard launch-time boundary. Our seeded override copies the
    // declared list, so without reconciliation an upgraded project would hand
    // all three straight back.
    const paths = resolvePaths("default");
    const dir = path.join(paths.sandbox, ".pi");
    fs.mkdirSync(dir, { recursive: true });
    const declared = readBuiltinTools("reviewer");
    fs.writeFileSync(
      path.join(dir, "settings.json"),
      JSON.stringify({
        subagents: {
          agentOverrides: {
            reviewer: { tools: [...declared, "bash", "edit", "write", "notebook"] },
          },
        },
      }),
      "utf-8",
    );

    seedBuiltinAgentNotebookTools(paths);

    const settings = readSettings("default");
    const overrides = (settings.subagents as Record<string, unknown>)
      .agentOverrides as Record<string, { tools?: string[] }>;
    expect(overrides.reviewer.tools).toEqual([...declared, "notebook_search"]);
    for (const removed of ["bash", "edit", "write"]) {
      expect(overrides.reviewer.tools).not.toContain(removed);
    }
  });
});
