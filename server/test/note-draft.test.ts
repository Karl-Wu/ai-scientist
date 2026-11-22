import fs from "node:fs";
import path from "node:path";
import type { AssistantMessage, Context } from "@earendil-works/pi-ai";
import { expect, it, vi } from "vitest";
import { createProject, resolvePaths } from "../src/projects.ts";
import { writeProjectAgent } from "../src/agent/agent-files.ts";
import { disableSkill } from "../src/agent/skills.ts";
import { generateNoteDraft, NOTE_DRAFT_SESSION_ID } from "../src/notes/draft.ts";
import { listNoteExperts } from "../src/notes/experts.ts";
import { createManualNotePage, getNotePage, listNotePages } from "../src/notes/store.ts";
import { sessionCostSummary } from "../src/cost/ledger.ts";

const fakeMessage = (text: string): AssistantMessage => ({
  role: "assistant", api: "openai-completions", provider: "openrouter", model: "test",
  content: [{ type: "text", text }], timestamp: 0, stopReason: "stop",
  usage: { input: 100, output: 20, cacheRead: 0, cacheWrite: 0, totalTokens: 120,
    cost: { input: 0.001, output: 0.002, cacheRead: 0, cacheWrite: 0, total: 0.003 } },
});

it("uses the selected expert model, bound skill, instructions and prior draft as separate inputs", async () => {
  const project = createProject({ name: "Note experts" });
  const paths = resolvePaths(project.id);
  expect(listNoteExperts(project.id)).toEqual(expect.arrayContaining([
    { name: "scientific-result-reviewer", skill: "scientific-result-note", available: true },
    { name: "data-processing-reviewer", skill: "data-processing-note", available: true },
  ]));
  const skill = path.join(paths.skillsDir, "custom-review");
  fs.mkdirSync(path.join(skill, "references"), { recursive: true });
  const reviewSkill = "---\nname: custom-review\ndescription: A review checklist\n---\nUse the [checklist](references/check.md).";
  fs.writeFileSync(path.join(skill, "SKILL.md"), reviewSkill);
  const reference = path.join(skill, "references", "check.md");
  fs.writeFileSync(reference, "Check calibration before interpretation.");
  writeProjectAgent(paths, "calibration-reviewer", {
    description: "Calibration", systemPrompt: "Focus on calibration fidelity.", noteSkill: "custom-review", model: "ollama/expert-model",
  });
  const complete = vi.fn(async (_model: unknown, _context: Context) => fakeMessage(JSON.stringify({ title: "Review", summary: "Generated review" })));
  const initial = await generateNoteDraft(project.id, { instructions: "Write two paragraphs.", expert: "calibration-reviewer", model: "ollama/chat-model" }, complete);
  expect(complete).toHaveBeenCalledOnce();
  expect(complete.mock.lastCall![0]).toMatchObject({ id: "expert-model" });
  const firstContext = complete.mock.lastCall![1];
  expect(firstContext.systemPrompt).toContain("Focus on calibration fidelity.");
  expect(firstContext.systemPrompt).toContain("Check calibration before interpretation.");
  expect(firstContext.tools).toBeUndefined();
  expect(JSON.parse(firstContext.messages[0].content as string)).toMatchObject({ instructions: "Write two paragraphs.", note: "" });
  expect(initial.draftCredit).toMatchObject({ expert: "calibration-reviewer", skill: { name: "custom-review", scope: "project", sha256: expect.stringMatching(/^[a-f0-9]{64}$/) } });
  expect(listNotePages(project.id).pages).toEqual([]);

  fs.writeFileSync(reference, "Compare the reference scale against the measurements.");
  const refined = await generateNoteDraft(project.id, {
    expert: "calibration-reviewer", instructions: "Use one paragraph.", previousDraft: initial,
  }, complete);
  expect(complete.mock.lastCall![1].systemPrompt).toContain("Compare the reference scale");
  expect(JSON.parse(complete.mock.lastCall![1].messages[0].content as string)).toMatchObject({
    instructions: "Use one paragraph.", note: "", previousDraft: { title: initial.title, summary: initial.summary },
  });
  expect(refined.draftCredit?.skill.sha256).not.toBe(initial.draftCredit?.skill.sha256);
  const page = createManualNotePage(project.id, { title: refined.title, summary: refined.summary, draftCredit: refined.draftCredit });
  expect(getNotePage(project.id, page.id).revisions[0].draftCredit).toEqual(refined.draftCredit);
  expect(listNotePages(project.id).pages).toMatchObject([{ id: page.id, organizer: "Created manually", draftExpert: "calibration-reviewer", sourceCount: 0 }]);

  expect(disableSkill(paths, "custom-review").ok).toBe(true);
  expect(listNoteExperts(project.id)).toContainEqual({ name: "calibration-reviewer", skill: "custom-review", available: false });
  await expect(generateNoteDraft(project.id, { expert: "calibration-reviewer", instructions: "Summarize the review." }, complete))
    .rejects.toMatchObject({ statusCode: 409 });
  expect(complete).toHaveBeenCalledTimes(2);
});

it("drafts from a selected task and user text using only the bounded, redacted material", async () => {
  const project = createProject({ name: "Draft source" });
  const paths = resolvePaths(project.id);
  fs.mkdirSync(paths.sessionsDir, { recursive: true });
  const rows = [
    { type: "message", message: { role: "user", content: [{ type: "text", text: "Keep the inclusion criteria." }] } },
    { type: "message", message: { role: "assistant", content: [{ type: "thinking", thinking: "Internal reasoning" },
      { type: "text", text: "The task reported 12 rows. api_key=synthetic-secret" },
      { type: "toolCall", name: "bash", arguments: { command: "raw command arguments" } }] } },
    { type: "message", message: { role: "toolResult", toolName: "bash", isError: true,
      content: [{ type: "text", text: "raw tool output" }] } },
  ];
  fs.writeFileSync(path.join(paths.sessionsDir, "task-a.jsonl"), rows.map((row) => JSON.stringify(row)).join("\n"));
  const complete = vi.fn(async (_model: unknown, context: Context) => {
    const input = JSON.parse(context.messages[0].content as string);
    expect(input.note).toBe("Mark the unit as unresolved.");
    expect(input.taskExcerpt).toContain("Keep the inclusion criteria");
    expect(input.taskExcerpt).toContain("The task reported 12 rows");
    expect(input.taskExcerpt).toContain("Tool bash returned an error");
    expect(input.taskExcerpt).toContain("[redacted]");
    expect(input.taskExcerpt).not.toMatch(/Internal reasoning|synthetic-secret|raw command|raw tool output/);
    return fakeMessage(JSON.stringify({ title: "Inclusion criteria", summary: "Unit unresolved." }));
  });
  await expect(generateNoteDraft(project.id, { summary: "Mark the unit as unresolved.", taskId: "task-a" }, complete))
    .resolves.toEqual({ title: "Inclusion criteria", summary: "Unit unresolved.", taskExcerptShortened: false });
  expect(complete).toHaveBeenCalledOnce();
  expect(listNotePages(project.id).pages).toEqual([]);
  expect(sessionCostSummary(NOTE_DRAFT_SESSION_ID, project.id).entries).toHaveLength(1);
});

it("rejects unavailable sources before calling a model and accounts for an invalid model response", async () => {
  const project = createProject({ name: "Invalid draft", spendLimitUsd: 0.002 });
  const complete = vi.fn(async () => fakeMessage("not a valid draft"));
  await expect(generateNoteDraft(project.id, { taskId: "foreign-task" }, complete)).rejects.toMatchObject({ statusCode: 404 });
  expect(complete).not.toHaveBeenCalled();
  await expect(generateNoteDraft(project.id, { title: "Test draft" }, complete)).rejects.toMatchObject({ statusCode: 502 });
  expect(sessionCostSummary(NOTE_DRAFT_SESSION_ID, project.id).entries).toHaveLength(1);
  await expect(generateNoteDraft(project.id, { title: "Second draft" }, complete)).rejects.toMatchObject({ statusCode: 402 });
  expect(complete).toHaveBeenCalledOnce();
});

it("drafts from the selected answer, result, or file without including neighboring material", async () => {
  const project = createProject({ name: "Source-specific notes" });
  const paths = resolvePaths(project.id);
  fs.mkdirSync(paths.sessionsDir, { recursive: true });
  const message = (id: string, role: string, text: string) => ({ type: "message", id,
    message: { role, stopReason: "stop", content: [{ type: "text", text }] } });
  const result = (id: string, title: string) => ({ type: "message", message: { role: "toolResult", toolName: "scientific_result",
    toolCallId: id, content: [{ type: "text", text: "Raw tool output" }], details: { scientificResult: {
      schemaVersion: 1, kind: "table", title, columns: [{ key: "metric", label: "Metric" }], rows: [[42]],
    } } } });
  const rows = [message("q1", "user", "Earlier question"), result("card-1", "Unrelated result"),
    message("a1", "assistant", "Earlier answer"), message("q2", "user", "Second question"),
    message("a2-start", "assistant", "Opening paragraph "), result("card-2", "Selected result"),
    message("a2", "assistant", "Selected finding"), message("q3", "user", "Later question"), message("a3", "assistant", "Later answer")];
  fs.writeFileSync(path.join(paths.sessionsDir, "task-a.jsonl"), rows.map((row) => JSON.stringify(row)).join("\n"));
  fs.writeFileSync(path.join(paths.sandbox, "current.csv"), "header\nSelected file content\n" + "x".repeat(25_000) + "File tail");
  fs.writeFileSync(path.join(paths.sandbox, "figure.png"), Buffer.from([0, 1, 0, 2]));
  const complete = vi.fn(async () => fakeMessage(JSON.stringify({ title: "Source note", summary: "Proposed summary" })));
  const capture = vi.fn(async (_model: unknown, context: Context) => {
    const data = JSON.parse(context.messages[0].content as string);
    expect(data.taskExcerpt).toBe("");
    expect(JSON.stringify(data)).not.toMatch(/Earlier answer|Later answer|Unrelated result|Raw tool output|File tail/);
    return complete();
  });
  const inputs = [
    [{ kind: "message", sessionId: "task-a", entryId: "a2" }, "Opening paragraph Selected finding"],
    [{ kind: "result", sessionId: "task-a", toolCallId: "card-2" }, "Selected result"],
    [{ kind: "file", path: "current.csv" }, "Selected file content"],
  ] as const;
  for (const [source, content] of inputs) {
    const draft = await generateNoteDraft(project.id, { source }, capture);
    expect(draft.sourceExcerptShortened).toBe(source.kind === "file");
    const context = capture.mock.lastCall![1];
    expect(JSON.parse(context.messages[0].content as string).source.excerpt).toContain(content);
  }
  const figure = { kind: "file", path: "figure.png" };
  await expect(generateNoteDraft(project.id, { title: "Figure", source: figure }, capture)).rejects.toMatchObject({ statusCode: 415 });
  expect(capture).toHaveBeenCalledTimes(3);
  await generateNoteDraft(project.id, { title: "Figure", summary: "Description by the author", source: figure }, capture);
  expect(JSON.parse(capture.mock.lastCall![1].messages[0].content as string)).toMatchObject({
    note: "Description by the author", source: { kind: "file", excerpt: "" },
  });
});
