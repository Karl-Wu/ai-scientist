import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { NotePagesView } from "./note-pages-view";
import { apiFetch } from "@/lib/projects";
import type { NotePage, NoteSummary } from "@/lib/note-pages";

vi.mock("@/lib/projects", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/projects")>(), apiFetch: vi.fn(),
}));

it("shows card metadata and source actions while keeping note filters and revision details", async () => {
  const source = { id: "s1", kind: "tool", sessionId: "source-task", toolCallId: "scan", label: "Scan", excerpt: "Sample excluded" } as const;
  const sourceLink = { kind: "tool", sessionId: "source-task", toolCallId: "scan", label: "Scan" } as const;
  const secondSource = { id: "s2", kind: "file", path: "report.csv", label: "Report", excerpt: "" } as const;
  const pages: NoteSummary[] = [
    { id: "first", type: "observation", version: 2, organizer: "Research", draftExpert: "Scientific reviewer", title: "Study observation", savedAt: 2,
      status: "pending", tasks: [source.sessionId], excerpt: "## Finding\n**Three exclusions** in the [study](study.md).", source: sourceLink, sourceCount: 2 },
    { id: "second", type: "mappingRule", version: 1, organizer: "Created manually", title: "Diagnosis mapping", savedAt: 2, status: "saved", tasks: [], excerpt: "", sourceCount: 0 },
  ];
  const page: NotePage = {
    id: "first", schemaVersion: 3, type: "observation", typeVersion: 1, organizer: "Research", sources: [source, secondSource],
    revisions: [
      { version: 1, title: "First observation", summary: "", fields: { scope: "Before exclusion" }, savedAt: 1, status: "pending" },
      { version: 2, title: "Study observation", summary: "Study findings", fields: { scope: "After exclusion" }, savedAt: 2, status: "pending" },
    ],
  };
  vi.mocked(apiFetch).mockImplementation(async (url) => {
    if (url === "/sessions") return Response.json([{ id: "source-task", name: "Source analysis" }]);
    if (url === "/notes") return Response.json({ pages });
    if (url === "/notes/first") return Response.json(page);
    throw new Error("Unexpected request");
  });

  const onOpenSource = vi.fn();
  const user = userEvent.setup();
  render(<NotePagesView projectId="default" onOpenSource={onOpenSource} />);
  await screen.findByRole("button", { name: /Diagnosis mapping/ });
  expect(screen.getByText("2 pages")).toBeTruthy();
  expect(screen.getByText("Pending review")).toBeTruthy();
  expect(screen.queryByText("Saved")).toBeNull();
  const list = within(screen.getByRole("list"));
  expect(list.queryByText("Scientific reviewer")).toBeNull();
  expect(list.queryByText("Created manually")).toBeNull();
  expect(screen.getByText("Finding Three exclusions in the study.")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Study observation" }).closest("li")?.querySelector("time")?.dateTime).toBe(new Date(2).toISOString());
  await within(screen.getByRole("combobox", { name: "Source task" })).findByText("Source analysis");
  await user.click(screen.getByRole("button", { name: "Tool result · Scan" }));
  expect(onOpenSource).toHaveBeenCalledWith(sourceLink);
  expect(screen.queryByRole("heading", { name: "Study observation" })).toBeNull();
  const typeFilter = screen.getByRole("combobox", { name: "Note type" });
  expect(within(typeFilter).getAllByRole("option").map((option) => option.textContent)).toEqual(["All note types", "Observation", "Mapping rule"]);
  await user.selectOptions(typeFilter, "observation");
  expect(screen.queryByRole("button", { name: /Diagnosis mapping/ })).toBeNull();
  expect(screen.getByText("1 page")).toBeTruthy();
  await user.click(screen.getByRole("button", { name: "View 1 more source" }));
  expect(await screen.findByText("After exclusion")).toBeTruthy();
  expect(screen.getByRole("region", { name: "Sources" })).toHaveFocus();
  expect(screen.getByText("Report")).toBeTruthy();
  expect(screen.getByText("Sample excluded")).toBeTruthy();
  await user.click(screen.getByRole("button", { name: "Open source" }));
  expect(onOpenSource).toHaveBeenCalledWith(source);
  await user.selectOptions(screen.getByRole("combobox", { name: "Revision" }), "1");
  expect(screen.getByText("Before exclusion")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Edit note page" })).toBeNull();
});

it("shows the list's type filter with the only available note type", async () => {
  vi.mocked(apiFetch).mockResolvedValue(Response.json({ pages: [{
    id: "first", type: "note", version: 1, organizer: "Created manually", title: "Project note", savedAt: 1,
    status: "saved", tasks: [], excerpt: "", sourceCount: 0,
  } satisfies NoteSummary] }));
  render(<NotePagesView projectId="default" onOpenSource={vi.fn()} />);
  await screen.findByRole("button", { name: "Project note" });
  const typeFilter = screen.getByRole("combobox", { name: "Note type" });
  expect(within(typeFilter).getAllByRole("option").map((option) => option.textContent)).toEqual(["All note types", "General note"]);
});

it("prefills a PDF annotation note and passes its exact source to the workspace", async () => {
  const anchor = { kind: "pdfAnnotation", path: "papers/study.pdf", annotationId: "highlight-3" } as const;
  const initialSummary = "### Highlighted text\n\nSelected passage\n\n### Annotation text\n\nReview this claim.";
  const citation = { ...anchor, id: "s1", page: 3, label: "study.pdf", excerpt: "Selected passage\nReview this claim." };
  vi.mocked(apiFetch).mockImplementation(async (url, options) => {
    if (url === "/notes" && options?.method === "POST") {
      const request = JSON.parse(String(options.body));
      expect(request).toMatchObject({ source: anchor, summary: initialSummary });
      return Response.json({
        id: "pdf-note", schemaVersion: 3, type: "note", typeVersion: 1, organizer: "Created manually",
        sources: [citation],
        revisions: [{ version: 1, title: request.title, summary: request.summary, fields: {}, savedAt: 1, status: "saved" }],
      } satisfies NotePage, { status: 201 });
    }
    if (url === "/notes/experts") return Response.json({ experts: [] });
    if (url === "/notes") return Response.json({ pages: [] });
    throw new Error("Unexpected request");
  });

  const onOpenSource = vi.fn();
  const user = userEvent.setup();
  render(<NotePagesView projectId="default" onOpenSource={onOpenSource}
    createFrom={{ title: "study.pdf · Page 3", anchor, initialSummary }} />);
  expect(await screen.findByRole("textbox", { name: "Note title" })).toHaveValue("study.pdf · Page 3");
  expect(screen.getByRole("textbox", { name: "Current summary" })).toHaveValue(initialSummary);
  await user.click(screen.getByRole("button", { name: "Save note page" }));
  await user.click(await screen.findByRole("button", { name: "Open PDF annotation" }));
  expect(onOpenSource).toHaveBeenCalledWith(citation);
});

it("creates a manual note from the empty state and keeps the draft and request id when saving fails", async () => {
  const currentTask = { id: "source-task", title: "Scope review" };
  const source = { id: "s1", kind: "task", sessionId: currentTask.id, label: currentTask.title, excerpt: "" } as const;
  const requests: Array<{ title: string; summary: string; task: typeof currentTask; requestId: string }> = [];
  vi.mocked(apiFetch).mockImplementation(async (url, options) => {
    if (url === "/notes" && options?.method === "POST") {
      const request: (typeof requests)[number] = JSON.parse(String(options.body));
      requests.push(request);
      const { title, summary } = request;
      const page: NotePage = {
        id: "new-page", schemaVersion: 3, type: "note", typeVersion: 1, organizer: "Created manually", sources: [source],
        revisions: [{ version: 1, title, summary, fields: {}, savedAt: 1, status: "saved" }],
      };
      return requests.length === 1 ? new Response(null, { status: 503 }) : Response.json(page, { status: 201 });
    }
    if (url === "/notes") return Response.json({ pages: [] });
    throw new Error("Unexpected request");
  });

  const onOpenSource = vi.fn();
  const user = userEvent.setup();
  render(<NotePagesView projectId="default" currentTask={currentTask} onOpenSource={onOpenSource} />);
  await screen.findByText("No note pages yet");
  await user.click(screen.getByRole("button", { name: "New note page" }));
  const title = screen.getByRole("textbox", { name: "Note title" }) as HTMLInputElement;
  const summary = screen.getByRole("textbox", { name: "Current summary" }) as HTMLTextAreaElement;
  const save = screen.getByRole("button", { name: "Save note page" }) as HTMLButtonElement;
  const attach = screen.getByRole("checkbox", { name: /Reference current task/ }) as HTMLInputElement;
  expect(save.disabled).toBe(true);
  expect(attach.checked).toBe(false);
  await user.type(title, "My reminder");
  await user.type(summary, "**Remember this**");
  await user.click(attach);
  expect(screen.queryByRole("button", { name: "Add timeline entry" })).toBeNull();
  await user.click(save);
  await screen.findByRole("alert");
  expect(title.value).toBe("My reminder");
  expect(summary.value).toBe("**Remember this**");
  expect(attach.checked).toBe(true);
  await user.click(save);
  await screen.findByRole("heading", { name: "My reminder" });
  expect(requests).toHaveLength(2);
  expect(requests[1]).toEqual(requests[0]);
  expect(requests[0]).toMatchObject({ title: "My reminder", summary: "**Remember this**", task: currentTask });
  expect(requests[0]).not.toHaveProperty("timeline");
  expect(screen.getByRole("heading", { name: "Current summary" })).toBeTruthy();
  expect(screen.queryByRole("heading", { name: "Timeline" })).toBeNull();
  expect(screen.getByRole("heading", { name: "Sources" })).toBeTruthy();
  expect(screen.getByText("Created manually")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Mark as reviewed" })).toBeNull();
  await user.click(screen.getByRole("button", { name: "Open source task" }));
  expect(onOpenSource).toHaveBeenCalledWith(source);
});

it("shows an assistant draft without changing the user's inputs until they apply it", async () => {
  vi.mocked(apiFetch).mockClear();
  vi.mocked(apiFetch).mockImplementation(async (url, options) => {
    if (url === "/notes" && !options?.method) return Response.json({ pages: [] });
    if (url === "/notes/draft") {
      expect(JSON.parse(String(options?.body))).toMatchObject({
        title: "My title", summary: "My rough notes", taskId: "task-a", model: "direct/mock",
      });
      return Response.json({ title: "Suggested title", summary: "Suggested summary", taskExcerptShortened: true });
    }
    throw new Error("The assistant must not write a note");
  });

  const user = userEvent.setup();
  render(<NotePagesView projectId="default" currentTask={{ id: "task-a", title: "Current task" }} model="direct/mock" onOpenSource={vi.fn()} />);
  await user.click(await screen.findByRole("button", { name: "New note page" }));
  const title = screen.getByRole("textbox", { name: "Note title" }) as HTMLInputElement;
  const summary = screen.getByRole("textbox", { name: "Current summary" }) as HTMLTextAreaElement;
  const button = screen.getByRole("button", { name: "Draft with assistant" }) as HTMLButtonElement;
  expect(button.disabled).toBe(true);
  await user.type(title, "My title");
  await user.type(summary, "My rough notes");
  await user.click(screen.getByRole("checkbox", { name: /Reference current task/ }));
  expect(vi.mocked(apiFetch).mock.calls.some(([url]) => url === "/notes/draft")).toBe(false);
  await user.click(button);
  expect(await screen.findByText("Suggested summary")).toBeTruthy();
  expect(screen.getByText("The draft uses an excerpt of the task.")).toBeTruthy();
  expect(title.value).toBe("My title");
  expect(summary.value).toBe("My rough notes");
  await user.click(screen.getByRole("button", { name: "Apply draft" }));
  expect(title.value).toBe("Suggested title");
  expect(summary.value).toBe("Suggested summary");
  expect(vi.mocked(apiFetch).mock.calls.some(([url, options]) => url === "/notes" && options?.method === "POST")).toBe(false);
});

it("opens the editor with an exact source and uses that source for both drafting and saving", async () => {
  const anchor = { kind: "message", sessionId: "task-one", entryId: "answer-two" } as const;
  const source = { ...anchor, id: "s1", label: "Selected finding", excerpt: "" };
  const received = vi.fn();
  vi.mocked(apiFetch).mockImplementation(async (url, options) => {
    if (url === "/notes" && !options?.method) return Response.json({ pages: [] });
    const body = JSON.parse(String(options?.body));
    received(url, body);
    if (url === "/notes/draft") return Response.json({ title: "Draft title", summary: "Draft summary", taskExcerptShortened: false });
    if (url === "/notes") return Response.json({
      id: "new-page", schemaVersion: 3, type: "note", typeVersion: 1, organizer: "Created manually", sources: [source],
      revisions: [{ version: 1, title: body.title, summary: body.summary, fields: {}, savedAt: 1, status: "saved" }],
    } satisfies NotePage, { status: 201 });
    throw new Error("Unexpected request");
  });
  const onOpenSource = vi.fn();
  const user = userEvent.setup();
  render(<NotePagesView projectId="default" createFrom={{ title: "Selected finding", anchor }}
    currentTask={{ id: "unrelated-task", title: "Unrelated task" }} onOpenSource={onOpenSource} />);
  const title = await screen.findByRole("textbox", { name: "Note title" }) as HTMLInputElement;
  expect(title.value).toBe("Selected finding");
  expect(within(screen.getByRole("group", { name: "Sources" })).getByText("Selected finding")).toBeTruthy();
  expect(screen.queryByRole("checkbox", { name: /Reference current task/ })).toBeNull();
  expect(received).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "Draft with assistant" }));
  await screen.findByText("Draft summary");
  expect(received).toHaveBeenCalledWith("/notes/draft", expect.objectContaining({ source: anchor }));
  expect(received.mock.calls[0][1]).not.toHaveProperty("taskId");
  await user.click(screen.getByRole("button", { name: "Apply draft" }));
  await user.click(screen.getByRole("button", { name: "Save note page" }));
  await screen.findByRole("heading", { name: "Draft title" });
  expect(received).toHaveBeenLastCalledWith("/notes", expect.objectContaining({ source: anchor, summary: "Draft summary" }));
  expect(received.mock.calls[1][1]).not.toHaveProperty("task");
  await user.click(screen.getByRole("button", { name: "Open source" }));
  expect(onOpenSource).toHaveBeenCalledWith(source);
});

it("gives the chosen expert instructions and redrafts the preview before applying or saving it", async () => {
  const expert = "scientific-result-reviewer";
  const skill = "scientific-result-note";
  const draftCredit = { expert, skill: { name: skill, scope: "project", sha256: "b".repeat(64) } } as const;
  const drafts = vi.fn();
  const save = vi.fn();
  vi.mocked(apiFetch).mockImplementation(async (url, options) => {
    if (url === "/notes" && !options?.method) return Response.json({ pages: [] });
    if (url === "/notes/experts") return Response.json({ experts: [{ name: expert, skill, available: true }] });
    const body = JSON.parse(String(options?.body));
    if (url === "/notes/draft") {
      drafts(body);
      return Response.json({ title: "Review", summary: drafts.mock.calls.length === 1 ? "First preview" : "Refined preview", draftCredit, taskExcerptShortened: false });
    }
    if (url === "/notes") {
      save(body);
      return Response.json({ id: "expert-page", schemaVersion: 3, type: "note", typeVersion: 1, organizer: "Created manually", sources: [],
        revisions: [{ version: 1, title: body.title, summary: body.summary, fields: {}, draftCredit: body.draftCredit, savedAt: 1, status: "saved" }],
      } satisfies NotePage, { status: 201 });
    }
    throw new Error("Unexpected request");
  });
  const user = userEvent.setup();
  render(<NotePagesView projectId="default" onOpenSource={vi.fn()} />);
  await user.click(await screen.findByRole("button", { name: "New note page" }));
  await screen.findByRole("option", { name: expert });
  await user.selectOptions(screen.getByRole("combobox", { name: "Note expert" }), expert);
  const instructions = screen.getByRole("textbox", { name: "Instructions for the expert (optional)" });
  const summary = screen.getByRole("textbox", { name: "Current summary" });
  await user.type(instructions, "Focus on the limitations.");
  await user.click(screen.getByRole("button", { name: "Draft with assistant" }));
  expect(drafts).toHaveBeenLastCalledWith(expect.objectContaining({ expert, instructions: "Focus on the limitations.", summary: "" }));
  await screen.findByText("First preview");
  expect(summary).toHaveValue("");
  await user.type(instructions, " Use three bullets.");
  await user.click(screen.getByRole("button", { name: "Redraft" }));
  expect(drafts).toHaveBeenLastCalledWith(expect.objectContaining({ expert, instructions: "Focus on the limitations. Use three bullets.",
    previousDraft: { title: "Review", summary: "First preview" }, summary: "" }));
  await screen.findByText("Refined preview");
  expect(summary).toHaveValue("");
  expect(save).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "Apply draft" }));
  expect(summary).toHaveValue("Refined preview");
  await user.click(screen.getByRole("button", { name: "Save note page" }));
  await screen.findByText(/Drafted with scientific-result-reviewer/);
  expect(save).toHaveBeenCalledWith(expect.objectContaining({ draftCredit, summary: "Refined preview" }));
  expect(save.mock.calls[0][0]).not.toHaveProperty("instructions");
});
