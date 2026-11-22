import fs from "node:fs";
import path from "node:path";
import Fastify from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { registerNotesRoutes } from "../src/api/notes.ts";
import { createNotePage } from "../src/notes/store.ts";
import { makeNoteReadTool } from "../src/notes/read-tool.ts";
import { replacePdfAnnotations } from "../src/pdf-annotations-store.ts";
import { ensureProjectExists } from "../src/projects.ts";
import { withActiveProject } from "../src/scope.ts";
import type { NotePage } from "../../web/src/lib/note-pages.ts";

const project = ensureProjectExists("default");
const task = "notes-source";
const pageDir = path.join(project.kadyDir, "note-pages");

function writeTask(id: string, sessionsDir = project.sessionsDir) {
  fs.mkdirSync(sessionsDir, { recursive: true });
  const rows = [
    { type: "message", id: "evidence", message: { role: "user", content: [{ type: "text", text: "The scope changed." }] } },
    { type: "message", id: "result", message: { role: "toolResult", toolName: "scientific_result", toolCallId: "result-card", content: [] } },
  ];
  fs.writeFileSync(path.join(sessionsDir, id + ".jsonl"), rows.map((row) => JSON.stringify(row)).join("\n"));
}

afterEach(() => fs.rmSync(pageDir, { force: true, recursive: true }));

async function notesApp(projectId = "default") {
  const app = Fastify();
  app.addHook("onRequest", (_request, _reply, done) => withActiveProject(projectId, () => done()));
  await registerNotesRoutes(app);
  return app;
}

describe("project note pages", () => {
  it("exposes the listed revision and lets the agent read that exact version in the current project", async () => {
    writeTask(task);
    const original = createNotePage("default", {
      type: "observation", organizer: "Research", title: "Scope change",
      summary: "Original assessment", fields: { scope: "Before exclusions" },
      sources: [{ kind: "message", sessionId: task, entryId: "evidence", label: "Scope discussion", excerpt: "Source excerpt" }],
    });
    const app = await notesApp();
    try {
      const [{ id, version }] = (await app.inject({ url: "/notes" })).json().pages;
      expect(version).toBe(1);
      expect((await app.inject({ method: "PATCH", url: "/notes/" + id, payload: {
        action: "edit", expectedVersion: version, title: "Scope change", summary: "New assessment", fields: { scope: "After exclusions" },
      } })).statusCode).toBe(200);

      const tool = makeNoteReadTool("default");
      const output = await tool.execute("call-1", { id, version });
      expect(output.content[0]).toMatchObject({ type: "text" });
      expect(JSON.parse((output.content[0] as { text: string }).text)).toEqual({
        id: original.id, type: "observation", version: 1, latestVersion: 2, status: "pending",
        title: "Scope change", summary: "Original assessment", fields: { scope: "Before exclusions" },
        sources: [{ kind: "message", sessionId: task, entryId: "evidence", label: "Scope discussion" }],
      });
      expect((await tool.execute("call-2", { id, version: 9 })).details).toMatchObject({ found: false });
      ensureProjectExists("notes-read-foreign");
      const foreignTool = makeNoteReadTool("notes-read-foreign");
      expect((await foreignTool.execute("call-3", { id, version })).details).toMatchObject({ found: false });
      expect((await tool.execute("call-4", { id: "../outside", version })).details).toMatchObject({ found: false });
    } finally { await app.close(); }
  });

  it("saves a manual page without a source and reuses the original page on retry", async () => {
    const app = await notesApp();
    try {
      expect((await app.inject({ method: "POST", url: "/notes", payload: { title: "  " } })).statusCode).toBe(400);
      const payload = { title: "  Project reminder  ", requestId: "00aabbccddeeff000102030405060708" };
      const create = () => app.inject({ method: "POST", url: "/notes", payload });
      const response = await create();
      expect(response.statusCode).toBe(201);
      const page = response.json<NotePage>();
      expect(page).toMatchObject({
        schemaVersion: 3, type: "note", organizer: "Created manually", sources: [],
        revisions: [{ version: 1, status: "saved", title: "Project reminder", summary: "" }],
      });
      const revised = await app.inject({
        method: "PATCH", url: "/notes/" + page.id,
        payload: { action: "edit", expectedVersion: 1, title: "Updated reminder", summary: "Markdown **works**.", fields: {} },
      });
      expect(revised.json<NotePage>().revisions.at(-1)).toMatchObject({ version: 2, status: "saved" });
      expect((await create()).json<NotePage>()).toMatchObject({ id: page.id, revisions: revised.json<NotePage>().revisions });
      expect((await app.inject({ url: "/notes" })).json().pages).toHaveLength(1);
    } finally { await app.close(); }
  });

  it("stores a task citation and preserves it when revising the summary", async () => {
    writeTask(task);
    const other = ensureProjectExists("notes-manual-foreign");
    writeTask("foreign-manual-task", other.sessionsDir);
    const app = await notesApp();
    try {
      const create = (id: string) => app.inject({
        method: "POST", url: "/notes", payload: { title: "Task reminder", summary: "Current assessment",
          task: { id, title: "Scope review" }, requestId: "1".repeat(32) },
      });
      const response = await create(task);
      expect(response.statusCode).toBe(201);
      const page = response.json<NotePage>();
      expect(page.sources).toEqual([{ id: "s1", kind: "task", sessionId: task, label: "Scope review", excerpt: "" }]);
      expect(page.revisions[0]).toMatchObject({ summary: "Current assessment" });
      expect(page.revisions[0]).not.toHaveProperty("timeline");
      expect((await create(task)).json()).toEqual(page);
      expect((await app.inject({ method: "POST", url: "/notes", payload: {
        title: "Unrelated task", task: { id: "foreign-manual-task", title: "Other project" },
      } })).statusCode).toBe(400);
      const revision = await app.inject({ method: "PATCH", url: "/notes/" + page.id, payload: {
        action: "edit", expectedVersion: 1, title: "Task reminder", summary: "Refined assessment", fields: {},
      } });
      expect(revision.statusCode).toBe(200);
      const revised = revision.json<NotePage>();
      expect(revised.revisions[0]).toEqual(page.revisions[0]);
      expect(revised.revisions[1]).toMatchObject({ summary: "Refined assessment" });
      expect(revised.sources).toEqual(page.sources);
      expect((await app.inject({ url: "/notes?q=refined%20assessment" })).json().pages).toMatchObject([{ id: page.id }]);
      expect((await app.inject({ url: "/notes/" + page.id })).json()).toEqual(revised);
    } finally { await app.close(); }
  });

  it("reads existing note pages as the new schema and keeps their bodies, citations and revisions", async () => {
    const id = "01234567-0123-0123-0123-0123456789ab";
    const source = { kind: "task", sessionId: task, label: "Original task", excerpt: "" };
    const legacy = { id, type: "general", typeVersion: 1, organizer: "Created manually", sources: [source], revisions: [
      { title: "Version one", body: "Previous overview", version: 1, savedAt: 100, fields: {}, status: "saved" },
      { title: "Version two", body: "Latest overview", version: 2, savedAt: 200, fields: {}, status: "saved" },
    ] };
    fs.mkdirSync(pageDir, { recursive: true });
    const file = path.join(pageDir, id + ".json");
    fs.writeFileSync(file, JSON.stringify(legacy));
    const app = await notesApp();
    try {
      const url = "/notes/" + id;
      const loaded = (await app.inject({ url })).json<NotePage>();
      expect(loaded).toMatchObject({ schemaVersion: 3, type: "note", sources: [{ ...source, id: "s1" }] });
      expect(loaded.revisions.map((revision) => revision.summary)).toEqual(["Previous overview", "Latest overview"]);
      expect(JSON.parse(fs.readFileSync(file, "utf8"))).toEqual(legacy);
      expect((await app.inject({ url: "/notes?q=latest%20overview" })).json().pages).toMatchObject([{ id, type: "note" }]);
      const revised = await app.inject({ method: "PATCH", url, payload: {
        action: "edit", expectedVersion: 2, title: "Version three", summary: "Updated overview", fields: {},
      } });
      expect(revised.statusCode).toBe(200);
      const persisted = JSON.parse(fs.readFileSync(file, "utf8"));
      expect(persisted).toEqual(revised.json());
      expect(persisted.revisions.slice(0, 2)).toEqual(loaded.revisions);
    } finally { await app.close(); }
  });

  it("saves exact answer, result, and file references as manual notes and rejects unavailable sources", async () => {
    fs.mkdirSync(project.sessionsDir, { recursive: true });
    const result = { schemaVersion: 1, kind: "table", title: "Specific results", columns: [{ key: "id", label: "ID" }], rows: [[1]] };
    const message = (id: string, role: string, text: string) => ({ type: "message", id,
      message: { role, stopReason: "stop", content: [{ type: "text", text }] } });
    const rows = [message("prompt-one", "user", "First prompt"), message("answer-one", "assistant", "First finding"),
      message("prompt-two", "user", "Follow-up prompt"),
      { type: "message", message: { role: "toolResult", toolName: "scientific_result", toolCallId: "result-two", content: [], details: { scientificResult: result } } },
      message("answer-two", "assistant", "Second finding")];
    fs.writeFileSync(path.join(project.sessionsDir, task + ".jsonl"), rows.map((row) => JSON.stringify(row)).join("\n"));
    fs.writeFileSync(path.join(project.sandbox, "note-source.csv"), "id\n1\n");
    const app = await notesApp();
    try {
      const create = (source: unknown, requestId?: string) => app.inject({ method: "POST", url: "/notes",
        payload: { title: "Review note", summary: "Manual interpretation", source, requestId } });
      const answer = { kind: "message", sessionId: task, entryId: "answer-two" };
      const card = { kind: "result", sessionId: task, toolCallId: "result-two" };
      const file = { kind: "file", path: "note-source.csv" };
      const sources = [[answer, "Second finding"], [card, result.title], [file, file.path]] as const;
      for (const [source, label] of sources) {
        const response = await create(source);
        expect(response.statusCode).toBe(201);
        const saved = response.json<NotePage>();
        expect(saved).toMatchObject({ type: "note", sources: [{ ...source, id: "s1", label, excerpt: "" }],
          revisions: [{ status: "saved", summary: "Manual interpretation" }] });
        expect((await app.inject({ url: "/notes/" + saved.id })).json()).toEqual(saved);
      }
      const requestId = "1".repeat(32);
      const saved = (await create(answer, requestId)).json();
      expect((await create(answer, requestId)).json()).toEqual(saved);
      expect((await create({ ...answer, entryId: "answer-one" }, requestId)).statusCode).toBe(409);
      expect((await create({ ...answer, entryId: "prompt-two" })).statusCode).toBe(404);
      expect((await create({ ...answer, sessionId: "elsewhere" })).statusCode).toBe(404);
      expect((await create({ ...card, toolCallId: "missing-result" })).statusCode).toBe(404);
      expect((await create({ kind: "file", path: "missing.csv" })).statusCode).toBe(404);
      expect((await create({ kind: "file", path: "../outside.csv" })).statusCode).toBe(403);
      expect((await create({ kind: "file", path: ".kady/hidden.txt" })).statusCode).toBe(403);
    } finally { await app.close(); }
  });

  it("omits the legacy timeline from note responses and preserves recorded events on disk after editing", async () => {
    const id = "01234567-0123-0123-0123-0123456789ab";
    const timeline = [{ id: "0".repeat(32), summary: "Historical event", sourceIds: [], recordedAt: 100 }];
    const original = { title: "Earlier page", summary: "Previous summary", timeline, version: 1, savedAt: 100, fields: {}, status: "saved" };
    const legacy = { id, schemaVersion: 2, type: "note", typeVersion: 1, organizer: "Created manually", sources: [], revisions: [original] };
    fs.mkdirSync(pageDir, { recursive: true });
    const file = path.join(pageDir, id + ".json");
    fs.writeFileSync(file, JSON.stringify(legacy));
    const app = await notesApp();
    try {
      const url = "/notes/" + id;
      const page = (await app.inject({ url })).json<NotePage>();
      expect(page.schemaVersion).toBe(3);
      expect(page.revisions[0]).not.toHaveProperty("timeline");
      const revised = await app.inject({ method: "PATCH", url, payload: {
        action: "edit", expectedVersion: 1, title: "Earlier page", summary: "Updated summary", fields: {},
      } });
      expect(revised.statusCode).toBe(200);
      const persisted = JSON.parse(fs.readFileSync(file, "utf8"));
      expect(persisted.revisions[0]).toEqual(original);
      expect(persisted.revisions[1]).not.toHaveProperty("timeline");
      expect(revised.json<NotePage>().revisions[0]).not.toHaveProperty("timeline");
    } finally { await app.close(); }
  });

  it("persists typed pages, searches full content, and keeps prior revisions across a fresh app", async () => {
    writeTask(task);
    writeTask("notes-other-source");
    const research = createNotePage("default", {
      type: "observation", organizer: "Research organizer", title: "Observed scope change",
      body: "a".repeat(400) + " hidden searchable phrase", fields: { scope: "After exclusions" },
      sources: [
        { kind: "message", sessionId: task, entryId: "evidence", label: "First task", excerpt: "The scope changed." },
        { kind: "result", sessionId: "notes-other-source", toolCallId: "result-card", label: "Second task", excerpt: "Saved card" },
      ],
    });
    const mapping = createNotePage("default", {
      type: "mappingRule", organizer: "Data organizer", title: "Diagnosis mapping", body: "", fields: { sourceField: "code" },
      sources: [{ kind: "file", path: "mapping.csv", label: "Source table", excerpt: "code,target" }],
    });

    const first = await notesApp();
    try {
      const listed = await first.inject({ url: "/notes" });
      expect(listed.json().pages).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: research.id, tasks: [task, "notes-other-source"], sourceCount: 2,
          source: { kind: "message", sessionId: task, entryId: "evidence", label: "First task" } }),
        expect.objectContaining({ id: mapping.id, type: "mappingRule", sourceCount: 1,
          source: { kind: "file", path: "mapping.csv", label: "Source table" } }),
      ]));
      const search = await first.inject({ url: "/notes?q=hidden%20searchable" });
      expect(search.json().pages.map((page: { id: string }) => page.id)).toEqual([research.id]);
      const update = { action: "edit", expectedVersion: 1, title: "Revised finding", body: "", fields: { scope: "Confirmed" } };
      const url = "/notes/" + research.id;
      const writes = await Promise.all([
        first.inject({ method: "PATCH", url, payload: update }),
        first.inject({ method: "PATCH", url, payload: update }),
      ]);
      expect(writes.map((result) => result.statusCode).sort()).toEqual([200, 409]);
      const review = await first.inject({ method: "PATCH", url, payload: { action: "review", expectedVersion: 2 } });
      expect(review.json<NotePage>().revisions.at(-1)).toMatchObject({ version: 3, status: "reviewed" });
    } finally { await first.close(); }

    const reopened = await notesApp();
    try {
      const loaded = await reopened.inject({ url: "/notes/" + research.id });
      const page = loaded.json<NotePage>();
      expect(page.revisions.map((revision) => revision.title)).toEqual(["Observed scope change", "Revised finding", "Revised finding"]);
      expect(page.sources).toEqual(research.sources);
      const invalid = await reopened.inject({ method: "PATCH", url: "/notes/" + research.id, payload: {
        action: "edit", expectedVersion: 3, title: "Wrong type", body: "", fields: { sourceField: "code" },
      } });
      expect(invalid.statusCode).toBe(400);
    } finally { await reopened.close(); }
  });

  it("lists and searches readable pages when another page cannot be decoded", async () => {
    const app = await notesApp();
    try {
      const created = await app.inject({ method: "POST", url: "/notes", payload: { title: "Readable finding", summary: "Original assessment" } });
      expect(created.statusCode).toBe(201);
      const page = created.json<NotePage>();
      const truncatedId = "01aa4567-0123-0123-0123-0123456789ab";
      const invalidId = "01bb4567-0123-0123-0123-0123456789ab";
      const truncatedPath = path.join(pageDir, truncatedId + ".json");
      const truncated = '{"schemaVersion":3,';
      fs.writeFileSync(truncatedPath, truncated);
      fs.writeFileSync(path.join(pageDir, invalidId + ".json"), JSON.stringify({
        ...page, id: invalidId, revisions: [{ ...page.revisions[0], fields: null }],
      }));

      for (const url of ["/notes", "/notes?q=assessment"]) {
        const result = await app.inject({ url });
        expect(result.statusCode).toBe(200);
        expect(result.json()).toMatchObject({ unavailableCount: 2, pages: [{ id: page.id, title: "Readable finding" }] });
      }
      expect((await app.inject("/notes?q=unrelated")).json()).toEqual({ pages: [], unavailableCount: 2 });
      expect((await app.inject("/notes/" + page.id)).json()).toEqual(page);
      expect((await app.inject("/notes/" + truncatedId)).statusCode).toBe(422);
      expect((await app.inject("/notes/" + invalidId)).statusCode).toBe(422);
      expect(fs.readFileSync(truncatedPath, "utf8")).toBe(truncated);
    } finally { await app.close(); }
  });

  it("rejects foreign scope, unknown anchors, and paths that are not visible", async () => {
    writeTask(task);
    const note = { type: "hypothesis", organizer: "Test", title: "Scope", body: "", fields: {} };
    const badMessage = { kind: "message", sessionId: task, entryId: "missing", label: "Message", excerpt: "" };
    expect(() => createNotePage("default", { ...note, sources: [badMessage] })).toThrow("Source message is unavailable");
    expect(() => createNotePage("default", { ...note, sources: [{ kind: "file", path: ".kady/file", label: "Hidden", excerpt: "" }] }))
      .toThrow("visible project files");
    const other = ensureProjectExists("notes-foreign");
    writeTask("foreign-task", other.sessionsDir);
    expect(() => createNotePage("default", { ...note, sources: [{ kind: "task", sessionId: "foreign-task", label: "Other", excerpt: "" }] }))
      .toThrow("unavailable in this project");
    const page = createNotePage("default", { ...note, sources: [{ ...badMessage, entryId: "evidence" }] });
    const foreign = await notesApp("notes-foreign");
    try {
      expect((await foreign.inject({ url: "/notes/" + page.id })).statusCode).toBe(404);
      expect((await foreign.inject({ url: "/notes", headers: { "x-project-id": "missing" } })).statusCode).toBe(404);
    } finally { await foreign.close(); }
  });

  it("stores the annotated PDF page, quotes the saved annotation, and preserves the source after deletion", async () => {
    const pdf = "annotated-paper.pdf";
    const annotationId = "highlight-3";
    fs.writeFileSync(path.join(project.sandbox, pdf), "%PDF-1.7\n");
    await replacePdfAnnotations(project.sandbox, pdf, { version: 1, annotations: [{
      id: annotationId, type: "highlight", page: 3, text: "The cohort contained 42 samples.",
      note: "Check the reported exclusions.",
      rects: [{ x: 10, y: 20, w: 120, h: 14 }],
      author: { kind: "user", id: "user", label: "You" },
      createdAt: "2026-11-21T00:00:00.000Z",
    }] });
    const app = await notesApp();
    try {
      const payload = {
        title: "Check sample exclusions",
        summary: "The cohort contained 42 samples. Check the reported exclusions.",
        requestId: "00aabbccddeeff000102030405060708",
        source: { kind: "pdfAnnotation", path: pdf, annotationId, page: 9 },
      };
      const create = (body = payload) => app.inject({ method: "POST", url: "/notes", payload: body });
      expect((await create({ ...payload, source: { ...payload.source, annotationId: "missing" } })).statusCode).toBe(404);
      const response = await create();
      expect(response.statusCode).toBe(201);
      const page = response.json<NotePage>();
      expect(page.sources).toEqual([{
        id: "s1", kind: "pdfAnnotation", path: pdf, annotationId, page: 3, label: pdf,
        excerpt: "Highlighted text\nThe cohort contained 42 samples.\n\nAnnotation text\nCheck the reported exclusions.",
      }]);
      expect((await app.inject("/notes")).json().pages[0].source).toMatchObject({ kind: "pdfAnnotation", path: pdf, page: 3, annotationId });
      await replacePdfAnnotations(project.sandbox, pdf, { version: 1, annotations: [] });
      expect((await create()).json<NotePage>().id).toBe(page.id);
      expect((await app.inject("/notes/" + page.id)).json<NotePage>().sources).toEqual(page.sources);
    } finally { await app.close(); }
  });
});
