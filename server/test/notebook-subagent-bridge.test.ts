import fs from "node:fs";
import path from "node:path";
import { beforeEach, expect, it } from "vitest";
import { retireNotebookTools } from "../src/agent/notebook-bridge.ts";
import { seedBuiltinAgentModalTools } from "../src/agent/modal-bridge.ts";
import { MODAL_TOOL_NAMES } from "../src/agent/modal-tool.ts";
import { PROJECTS_ROOT } from "../src/config.ts";
import { resolvePaths } from "../src/projects.ts";
import { subagentsPackageDir } from "../src/agent/agent-files.ts";

const paths = resolvePaths("default");
const settingsPath = path.join(paths.sandbox, ".pi", "settings.json");

beforeEach(() => {
  fs.rmSync(PROJECTS_ROOT, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
});

it("removes retired notebook settings while preserving all other packages and specialist choices", () => {
  const reviewers = path.join(subagentsPackageDir(), "agents", "reviewer.md");
  const tools = /^tools:\s*(.+?)\s*$/m.exec(fs.readFileSync(reviewers, "utf8"))![1].split(",").map((tool) => tool.trim());
  fs.writeFileSync(settingsPath, JSON.stringify({
    packages: ["/old/kady-notebook", { source: "C:\\old\\kady-notebook\\" }, { source: "/other/extension" }],
    subagents: {
      agentOverrides: {
        reviewer: { tools: [...tools, "bash", "edit", "write", "notebook", "notebook_search"], disabled: true },
        custom: { tools: ["read", "notebook_search", "my_tool"] },
      },
    },
  }));
  expect(retireNotebookTools(paths)).toBe(true);
  expect(retireNotebookTools(paths)).toBe(false);
  seedBuiltinAgentModalTools(paths);

  const settings = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
  expect(settings.packages).toEqual([{ source: "/other/extension" }]);
  expect(settings.subagents.agentOverrides).toMatchObject({
    reviewer: { tools: [...tools, ...MODAL_TOOL_NAMES], disabled: true },
    custom: { tools: ["read", "my_tool"] },
  });
});

it("leaves missing or malformed settings intact", () => {
  expect(retireNotebookTools(paths)).toBe(false);
  const malformed = "{invalid";
  fs.writeFileSync(settingsPath, malformed);
  expect(retireNotebookTools(paths)).toBe(false);
  expect(fs.readFileSync(settingsPath, "utf8")).toBe(malformed);
});
