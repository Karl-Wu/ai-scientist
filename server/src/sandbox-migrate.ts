/**
 * Upgrade untouched sandbox scaffolding without syncing environments. The
 * platform launcher calls this before preparing packaged Python runtimes.
 */
import "./env.ts";
import { DEFAULT_PROJECT_ID } from "./config.ts";
import { ensureProjectExists, listProjects, resolvePaths } from "./projects.ts";
import { seedSandboxFiles } from "./sandbox-seed.ts";
import { seedAdeBootstrapPrompt } from "./agent/prompts.ts";

for (const meta of listProjects()) {
  if (meta.archived) continue;
  seedSandboxFiles(resolvePaths(meta.id));
  seedAdeBootstrapPrompt(resolvePaths(meta.id));
  process.stdout.write(`sandbox scaffolding checked: ${meta.id}\n`);
}

ensureProjectExists(DEFAULT_PROJECT_ID);
seedSandboxFiles(resolvePaths(DEFAULT_PROJECT_ID));
seedAdeBootstrapPrompt(resolvePaths(DEFAULT_PROJECT_ID));
