import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { AGENT_NAME_RE, isExternalCliAgent, listAgents, seedAgentFiles, settingsPinnedModels } from "../agent/agent-files.ts";
import { globalSkillRoot, listProjectSkills, projectSkillRoot, SKILL_NAME_RE, type SkillRoot } from "../agent/skills.ts";
import { resolvePaths } from "../projects.ts";
import { isWithin, SandboxError } from "../sandbox-fs.ts";
import type { NoteDraftCredit, NoteExpertOption } from "../../../web/src/lib/note-pages.ts";

const EXPERT_CONFIGURATION_ERROR = "The selected note expert or its skill is unavailable";
const MAX_SKILL_BYTES = 32 * 1024;
const MAX_REFERENCES = 6;

function noteExperts(projectId: string) {
  const paths = resolvePaths(projectId);
  seedAgentFiles(paths);
  const skills = new Map<string, { root: SkillRoot; file: string }>();
  for (const root of [globalSkillRoot(), projectSkillRoot(paths)]) {
    for (const skill of listProjectSkills(root)) skills.set(skill.name, { root, file: skill.filePath });
  }
  const experts = listAgents(paths).filter((agent) => agent.enabled && agent.noteSkill && !isExternalCliAgent(agent));
  return { paths, skills, experts };
}

export function listNoteExperts(projectId: string): NoteExpertOption[] {
  const { experts, skills } = noteExperts(projectId);
  return experts.map((agent) => ({ name: agent.name, skill: agent.noteSkill!, available: skills.has(agent.noteSkill!) }));
}

function readSkillText(root: string, file: string, limit: number): string {
  const unavailable = new SandboxError(409, EXPERT_CONFIGURATION_ERROR);
  try {
    const real = fs.realpathSync(file);
    if (!isWithin(root, real) || !(fs.statSync(real).isFile())) throw unavailable;
    const flags = fs.constants.O_RDONLY | (fs.constants.O_NONBLOCK ?? 0) | (fs.constants.O_NOFOLLOW ?? 0);
    const fd = fs.openSync(real, flags);
    try {
      const stat = fs.fstatSync(fd);
      if (!stat.isFile() || stat.size > limit) throw unavailable;
      const bytes = Buffer.alloc(limit + 1);
      let length = 0;
      while (length < bytes.length) {
        const count = fs.readSync(fd, bytes, length, bytes.length - length, length);
        if (count === 0) break;
        length += count;
      }
      if (length > limit || bytes.subarray(0, length).includes(0)) throw unavailable;
      return new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, length));
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    throw unavailable;
  }
}

export function resolveNoteExpert(projectId: string, name: string) {
  const { paths, skills, experts } = noteExperts(projectId);
  const expert = experts.find((agent) => agent.name === name);
  const skillName = expert?.noteSkill;
  const skill = skillName && skills.get(skillName);
  if (!expert || !skillName || !skill || !AGENT_NAME_RE.test(name) || !SKILL_NAME_RE.test(skillName)) {
    throw new SandboxError(409, EXPERT_CONFIGURATION_ERROR);
  }
  let root: string;
  let file: string;
  try {
    root = fs.realpathSync(skill.root.skillsDir);
    file = fs.realpathSync(skill.file);
  } catch {
    throw new SandboxError(409, EXPERT_CONFIGURATION_ERROR);
  }
  const markdown = readSkillText(root, file, MAX_SKILL_BYTES);
  const method = markdown.replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, "").trim();
  if (!method || expert.systemPrompt.length > 16_000) throw new SandboxError(409, EXPERT_CONFIGURATION_ERROR);
  const directory = path.dirname(file);
  const linked = method.matchAll(/\]\(<?((?:\.\/)?references\/[\w./-]+?\.(?:md|txt))>?(?:\s+["'][^"']*["'])?\)/gi);
  const refs = [...new Set(Array.from(linked, (match) => match[1].replace(/^\.\//, "")))];
  if (refs.length > MAX_REFERENCES) throw new SandboxError(409, EXPERT_CONFIGURATION_ERROR);
  let remaining = MAX_SKILL_BYTES - Buffer.byteLength(markdown);
  const references = refs.map((name) => {
    const file = path.resolve(directory, name);
    if (name.split("/").includes("..")) throw new SandboxError(409, EXPERT_CONFIGURATION_ERROR);
    const content = readSkillText(directory, file, remaining);
    remaining -= Buffer.byteLength(content);
    return { name, content };
  });
  const sha256 = createHash("sha256").update(JSON.stringify({ markdown, references })).digest("hex");
  const credit: NoteDraftCredit = { expert: name, skill: { name: skillName, scope: skill.root.kind, sha256 } };
  const models = settingsPinnedModels(paths);
  return { credit, prompt: expert.systemPrompt, method, references, model: models.byAgent.get(name) ?? expert.model ?? models.defaultModel };
}
