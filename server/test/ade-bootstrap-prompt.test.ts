import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { PROJECTS_ROOT } from "../src/config.ts";
import { seedPromptTemplates } from "../src/agent/prompts.ts";
import { ensureProjectExists, resolvePaths } from "../src/projects.ts";

describe("ADE bootstrap prompt seeding", () => {
  beforeEach(() => {
    fs.rmSync(PROJECTS_ROOT, { recursive: true, force: true });
    fs.mkdirSync(PROJECTS_ROOT, { recursive: true });
    process.env.ADE_HOME = "/opt/ade";
    process.env.ADE_BIN = "/opt/ade/bin/ade";
    process.env.ADE_VERSION = "0.1.0";
    ensureProjectExists("study");
  });

  afterEach(() => {
    delete process.env.ADE_HOME;
    delete process.env.ADE_BIN;
    delete process.env.ADE_VERSION;
    fs.rmSync(PROJECTS_ROOT, { recursive: true, force: true });
  });

  it("creates a project-specific template from the configured ADE runtime", () => {
    const paths = resolvePaths("study");
    seedPromptTemplates(paths);
    const file = path.join(paths.sandbox, ".pi/prompts/ade-bootstrap.md");
    const content = fs.readFileSync(file, "utf-8");

    expect(content).toContain("ADE=/opt/ade/bin/ade");
    expect(content).toContain(`SANDBOX=${paths.sandbox}`);
    expect(content).toContain("ADE_ROOT=$SANDBOX/ade");
    expect(content).toContain("ade-bootstrap-v2");
  });

  it("upgrades a generated v1 template but does not resurrect a user deletion", () => {
    const paths = resolvePaths("study");
    const file = path.join(paths.sandbox, ".pi/prompts/ade-bootstrap.md");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, "---\ndescription: old\n---\n\n<!-- ai-scientist: ade-bootstrap-v1 -->\n", "utf-8");

    expect(seedPromptTemplates(paths)).toBeGreaterThan(0);
    expect(fs.readFileSync(file, "utf-8")).toContain("ade-bootstrap-v2");

    fs.rmSync(file, { force: true });
    seedPromptTemplates(paths);
    expect(fs.existsSync(file)).toBe(false);
  });
});
