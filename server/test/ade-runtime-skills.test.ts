import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { PROJECTS_ROOT } from "../src/config.ts";
import { seedProjectSkills } from "../src/agent/skills.ts";
import { ensureProjectExists, resolvePaths } from "../src/projects.ts";

describe("offline ADE runtime skills", () => {
  beforeEach(() => {
    fs.rmSync(PROJECTS_ROOT, { recursive: true, force: true });
    fs.mkdirSync(PROJECTS_ROOT, { recursive: true });
    ensureProjectExists("study");
  });

  afterEach(() => {
    delete process.env.ADE_SKILLS_DIR;
    fs.rmSync(PROJECTS_ROOT, { recursive: true, force: true });
  });

  it("seeds canonical ADE skills into a new project without network access", async () => {
    const source = path.join(PROJECTS_ROOT, "ade-runtime", "skills");
    fs.mkdirSync(path.join(source, "ade-semantic-modeling"), { recursive: true });
    fs.writeFileSync(path.join(source, "ade-semantic-modeling", "SKILL.md"), "---\nname: ade-semantic-modeling\n---\n");
    process.env.ADE_SKILLS_DIR = source;

    const paths = resolvePaths("study");
    const count = await seedProjectSkills(paths, false);

    expect(count).toBeGreaterThan(0);
    expect(fs.existsSync(path.join(paths.skillsDir, "ade-semantic-modeling", "SKILL.md"))).toBe(true);
  });
});
