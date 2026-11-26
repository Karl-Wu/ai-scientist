import { constants } from "node:fs";
import { open, realpath } from "node:fs/promises";
import path from "node:path";
import type { AgentTool, AgentToolResult } from "@earendil-works/pi-agent-core";
import { Type } from "typebox";
import { globalSkillRoot, listProjectSkills, projectSkillRoot } from "../agent/skills.ts";
import { redactText } from "../agent/task-event-recorder.ts";
import type { ProjectPaths } from "../projects.ts";
import { guessMime, isWithin, SandboxError } from "../sandbox-fs.ts";
import { parseDelimitedText } from "../../../web/src/lib/delimited-text.ts";
import type { NoteDraft } from "../../../web/src/lib/note-pages.ts";

const SOURCE_BYTES = 512 * 1024;
const READ_CHARS = 6_000;
const CODE_FILES = new Set([".c", ".cpp", ".h", ".go", ".ipynb", ".java", ".jsx", ".ps1", ".py", ".r", ".rs", ".sh", ".sql", ".ts", ".tsx"]);
const TEXT_FILES = new Set([".json", ".jsonl", ".ndjson", ".xml", ".yaml", ".yml", ...CODE_FILES]);

export type DraftCheck = NonNullable<NoteDraft["checks"]>[number];
export interface DraftMaterial {
  label: string;
  text: string;
  shortened: boolean;
  delimiter?: "," | "\t";
}

async function readText(file: string, limit: number, root?: string) {
  const real = await realpath(file);
  if (root && !isWithin(await realpath(root), real)) throw new Error("File is outside the allowed directory");
  const handle = await open(real, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
  try {
    if (!(await handle.stat()).isFile()) throw new Error("Source is not a regular file");
    const buffer = Buffer.alloc(limit + 1);
    let length = 0;
    while (length < buffer.length) {
      const { bytesRead } = await handle.read(buffer, length, buffer.length - length, length);
      if (bytesRead === 0) break;
      length += bytesRead;
    }
    const shortened = length > limit;
    const bytes = buffer.subarray(0, Math.min(length, limit));
    if (bytes.includes(0)) return undefined;
    try {
      const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes, { stream: shortened });
      return { text, shortened };
    } catch {
      return undefined;
    }
  } finally {
    await handle.close();
  }
}

export async function fileMaterial(file: string, label: string, sandbox: string): Promise<DraftMaterial | undefined> {
  const extension = path.extname(label).toLowerCase();
  if (!guessMime(label).startsWith("text/") && !TEXT_FILES.has(extension)) return undefined;
  try {
    const content = await readText(file, SOURCE_BYTES, sandbox);
    if (!content?.text.trim()) return undefined;
    const delimiter = extension === ".csv" ? "," : extension === ".tsv" ? "\t" : undefined;
    return { ...content, label, delimiter };
  } catch {
    throw new SandboxError(404, "The selected source is no longer available");
  }
}

function toolResult(text: string, check: DraftCheck): AgentToolResult<DraftCheck> {
  return { content: [{ type: "text", text }], details: check };
}

export function sourceTools(material: DraftMaterial) {
  const ranges: { start: number; end: number }[] = [];
  let inspectedWholeTable = false;
  const tools: AgentTool<any>[] = [];
  const usesExcerpt = () => {
    if (material.shortened) return true;
    if (inspectedWholeTable) return false;
    let through = 0;
    for (const range of ranges.sort((a, b) => a.start - b.start)) {
      if (range.start > through) break;
      through = Math.max(through, range.end);
    }
    return through < text.length;
  };
  const text = redactText(material.text);
  const parameters = Type.Object({
    offset: Type.Optional(Type.Integer({ minimum: 0 })),
    count: Type.Optional(Type.Integer({ minimum: 1, maximum: READ_CHARS })),
  });
  const read: AgentTool<typeof parameters, DraftCheck> = {
    name: "read_note_source",
    label: "Read note source",
    description: "Read text from the selected source only. Start at offset 0, and use nextOffset to continue. Offsets count UTF-16 code units.",
    parameters,
    async execute(_id, { offset = 0, count = READ_CHARS }) {
      if (offset >= text.length) throw new Error("Offset is beyond the available source");
      const end = Math.min(offset + count, text.length);
      const endLine = text.slice(0, end).split("\n").length;
      const startLine = text.slice(0, offset).split("\n").length;
      ranges.push({ start: offset, end });
      return toolResult(JSON.stringify({
        source: redactText(material.label), startLine, endLine, excerpt: text.slice(offset, end),
        shortened: material.shortened, nextOffset: end < text.length ? end : null,
      }), { kind: "source", detail: String(startLine) + "–" + endLine });
    },
  };
  tools.push(read);
  if (!material.delimiter || material.shortened) return { tools, usesExcerpt };
  const delimiter = material.delimiter;
  const table: AgentTool<ReturnType<typeof Type.Object>, DraftCheck> = {
    name: "inspect_note_table",
    label: "Check note table",
    description: "Check the selected CSV or TSV for headers, row count, missing values and rows of inconsistent width. Treats the first row as headers.",
    parameters: Type.Object({}),
    async execute() {
      let rows: string[][];
      try { rows = parseDelimitedText(material.text, delimiter, { strict: true, maxCells: 100_000, skipEmptyLines: true }); }
      catch { throw new Error("The table is malformed or exceeds the table check limit. Read the source text for details."); }
      const [header = [], ...data] = rows;
      const empty = header.map(() => 0);
      let inconsistentRows = 0;
      for (const row of data) {
        if (row.length !== header.length) inconsistentRows++;
        for (let i = 0; i < empty.length; i++) if (!row[i]?.trim()) empty[i]++;
      }
      const columns = header.slice(0, 100).map((name, index) => ({ name: redactText(name).slice(0, 120), empty: empty[index] }));
      inspectedWholeTable = true;
      return toolResult(JSON.stringify({
        rows: data.length, columnCount: header.length, inconsistentRows, columns,
        columnsShortened: columns.length < header.length,
      }), { kind: "table", detail: String(data.length) });
    },
  };
  tools.push(table);
  return { tools, usesExcerpt };
}

export function draftSkills(paths: ProjectPaths) {
  const available = new Map<string, { file: string; root: string; description: string } | null>();
  for (const root of [globalSkillRoot(), projectSkillRoot(paths)]) {
    for (const skill of listProjectSkills(root)) {
      const visible = !skill.disableModelInvocation && isWithin(root.skillsDir, path.resolve(skill.filePath));
      available.set(skill.name, visible ? { file: skill.filePath, root: root.skillsDir, description: skill.description } : null);
    }
  }

  const parameters = Type.Object({
    name: Type.String({ minLength: 1, maxLength: 64 }),
    reference: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
  });
  const tool: AgentTool<typeof parameters, DraftCheck> = {
    name: "read_note_skill",
    label: "Read expert skill",
    description: "Read an enabled skill by name. Optionally load a linked Markdown or text reference relative to that skill. Skill scripts and shell requirements cannot run here.",
    parameters,
    async execute(_id, { name, reference }) {
      const skill = available.get(name);
      if (!skill) throw new Error("Skill unavailable");
      const folder = path.dirname(skill.file);
      if (reference && (path.isAbsolute(reference) || !/^[a-z0-9_/-]+[a-z0-9_./-]*\.(?:md|txt)$/i.test(reference) ||
          reference.split("/").some((part) => part.startsWith(".") || !part))) throw new Error("Reference unavailable");
      try {
        const root = reference ? await realpath(folder) : skill.root;
        if (reference && !isWithin(await realpath(skill.root), root)) throw new Error("Invalid skill directory");
        const result = await readText(reference ? path.resolve(folder, reference) : skill.file, 24_000, root);
        if (!result) throw new Error("Skill is not readable text");
        return toolResult(JSON.stringify({ ...result, text: redactText(result.text) }), { kind: "skill", detail: name });
      } catch {
        throw new Error("Skill file or reference unavailable");
      }
    },
  };

  const listing = [...available].flatMap(([name, skill]) => skill ? [{ name, description: redactText(skill.description).slice(0, 160) }] : []);
  return { listing, tool };
}
