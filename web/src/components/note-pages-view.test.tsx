import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { Toaster } from "sonner";
import { SentContextChips } from "./context-chips";
import { NotePagesView } from "./note-pages-view";
import { ResearchPickerBody } from "./research-picker";
import { TooltipProvider } from "./ui/tooltip";
import { apiFetch } from "@/lib/projects";
import { EMPTY_DELEGATION } from "@/lib/composer-context";
import type { NotePage, NoteSummary } from "@/lib/note-pages";

vi.mock("@/lib/projects", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/projects")>(), apiFetch: vi.fn(),
}));

it("deletes and undoes a note while its earlier revision stays readable in the conversation", async () => {
  const page: NotePage = {
    id: "study-note", schemaVersion: 3, type: "note", typeVersion: 1, organizer: "Created manually", sources: [],
    revisions: [
      { version: 1, title: "First assessment", summary: "Original finding", fields: {}, savedAt: 1, status: "saved" },
      { version: 2, title: "Updated assessment", summary: "Revised finding", fields: {}, savedAt: 2, status: "saved" },
    ],
  };
  const summary: NoteSummary = {
    id: page.id, type: "note", version: 2, organizer: page.organizer, title: "Updated assessment", savedAt: 2,
    status: "saved", excerpt: "Revised finding", tasks: [], sourceCount: 0,
  };
  const patches: object[] = [];
  vi.mocked(apiFetch).mockImplementation(async (url, options) => {
    if (url === "/notes") return Response.json({ pages: page.deletedAt ? [] : [summary], unavailableCount: 0 });
    if (url !== "/notes/study-note") throw new Error("Unexpected request");
    if (options?.method === "PATCH") {
      const request = JSON.parse(String(options.body));
      patches.push(request);
      if (request.action === "delete") page.deletedAt = 100;
      if (request.action === "restore") delete page.deletedAt;
    }
    return Response.json(page);
  });
  const user = userEvent.setup();
  render(<TooltipProvider>
    <Toaster />
    <NotePagesView projectId="default" onOpenSource={vi.fn()} />
    <div data-testid="picker"><ResearchPickerBody projectId="default" currentSessionId={null} selected={[]} onChange={vi.fn()} /></div>
    <SentContextChips projectId="default" context={{ delegation: EMPTY_DELEGATION,
      research: [{ kind: "note", type: "note", id: page.id, version: 1, title: "First assessment" }] }} />
  </TooltipProvider>);
  const picker = within(screen.getByTestId("picker"));
  expect(await picker.findByText("Updated assessment")).toBeVisible();
  await user.click(await screen.findByRole("button", { name: "Updated assessment" }));
  await user.click(await screen.findByRole("button", { name: "Delete note page" }));
  await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Cancel" }));
  expect(patches).toEqual([]);
  await user.click(screen.getByRole("button", { name: "Delete note page" }));
  await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Delete" }));
  expect(await within(screen.getByRole("region", { name: "Notes" })).findByText("No note pages yet")).toBeVisible();
  expect(await picker.findByText("No note pages yet")).toBeVisible();

  const reference = screen.getByRole("button", { name: "Open First assessment, revision 1" });
  await user.click(reference);
  const dialog = within(screen.getByRole("dialog"));
  expect(await dialog.findByText("Original finding")).toBeVisible();
  expect(dialog.getByText("Deleted")).toBeVisible();
  expect(dialog.queryByText("Revised finding")).toBeNull();
  expect(dialog.queryByRole("button", { name: "Edit note page" })).toBeNull();
  await user.click(dialog.getByRole("button", { name: "Close" }));

  fireEvent.click(await screen.findByRole("button", { name: "Undo" }));
  expect(await screen.findByRole("button", { name: "Updated assessment" })).toBeVisible();
  expect(await picker.findByText("Updated assessment")).toBeVisible();
  expect(patches).toEqual([{ action: "delete", expectedVersion: 2 }, { action: "restore", expectedDeletedAt: 100 }]);
});

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
  render(<NotePagesView projectId="default" currentTask={{ id: source.sessionId, title: "Source analysis" }} onOpenSource={onOpenSource} />);
  await screen.findByRole("button", { name: /Diagnosis mapping/ });
  expect(screen.getByText("2 pages")).toBeTruthy();
  expect(screen.getByText("Pending review")).toBeTruthy();
  expect(screen.queryByText("Saved")).toBeNull();
  const list = within(screen.getByRole("list"));
  expect(list.queryByText("Scientific reviewer")).toBeNull();
  expect(list.queryByText("Created manually")).toBeNull();
  expect(list.getByText("Observation")).toBeVisible();
  expect(list.getByText("Mapping rule")).toBeVisible();
  expect(screen.getByText("Finding Three exclusions in the study.")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Study observation" }).closest("li")?.querySelector("time")?.dateTime).toBe(new Date(2).toISOString());
  await user.click(screen.getByRole("button", { name: "Tool result · Scan" }));
  expect(onOpenSource).toHaveBeenCalledWith(sourceLink);
  expect(screen.queryByRole("heading", { name: "Study observation" })).toBeNull();
  const typeFilters = within(screen.getByRole("group", { name: "Note type" }));
  const taskScope = within(screen.getByRole("group", { name: "Task scope" }));
  expect(taskScope.getByRole("button", { name: "All tasks" })).toHaveAttribute("aria-pressed", "true");
  expect(typeFilters.getByRole("button", { name: "Mapping rule 1" })).toBeVisible();
  await user.click(taskScope.getByRole("button", { name: "Current task" }));
  expect(typeFilters.getByRole("button", { name: "Mapping rule 0" })).toBeVisible();
  expect(screen.queryByRole("button", { name: "Diagnosis mapping" })).toBeNull();
  await user.click(typeFilters.getByRole("button", { name: "Observation 1" }));
  await user.click(taskScope.getByRole("button", { name: "All tasks" }));
  expect(typeFilters.getByRole("button", { name: "Observation 1" })).toHaveAttribute("aria-pressed", "true");
  expect(typeFilters.getByRole("button", { name: "Mapping rule 1" })).toBeVisible();
  expect(screen.queryByRole("button", { name: "Diagnosis mapping" })).toBeNull();
  await user.click(typeFilters.getByRole("button", { name: "Mapping rule 1" }));
  expect(typeFilters.getByRole("button", { name: "Observation 1" })).toHaveAttribute("aria-pressed", "true");
  expect(typeFilters.getByRole("button", { name: "Mapping rule 1" })).toHaveAttribute("aria-pressed", "true");
  expect(screen.getByRole("button", { name: "Study observation" })).toBeVisible();
  expect(screen.getByRole("button", { name: "Diagnosis mapping" })).toBeVisible();
  await user.click(typeFilters.getByRole("button", { name: "Observation 1" }));
  expect(screen.queryByRole("button", { name: "Study observation" })).toBeNull();
  expect(screen.getByRole("button", { name: "Diagnosis mapping" })).toBeVisible();
  await user.click(typeFilters.getByRole("button", { name: "Mapping rule 1" }));
  expect(screen.getByRole("button", { name: "Study observation" })).toBeVisible();
  expect(screen.getByRole("button", { name: "Diagnosis mapping" })).toBeVisible();
  await user.click(screen.getByRole("button", { name: "More filters" }));
  const taskFilter = screen.getByRole("combobox", { name: "Source task" });
  await within(taskFilter).findByText("Source analysis");
  await user.selectOptions(taskFilter, "source-task");
  await user.selectOptions(screen.getByRole("combobox", { name: "Organizer" }), "Scientific reviewer");
  expect(screen.queryByRole("button", { name: /Diagnosis mapping/ })).toBeNull();
  expect(screen.getByText("1 page")).toBeTruthy();
  await user.keyboard("{Escape}");
  await user.click(screen.getByRole("button", { name: "More filters 2" }));
  expect(screen.getByRole("combobox", { name: "Organizer" })).toHaveValue("Scientific reviewer");
  await user.click(screen.getByRole("button", { name: "Clear filters" }));
  expect(screen.getByText("2 pages")).toBeTruthy();
  await user.keyboard("{Escape}");
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
  expect(screen.getByRole("button", { name: "Current task" })).toBeDisabled();
  const typeFilters = within(screen.getByRole("group", { name: "Note type" }));
  expect(typeFilters.getAllByRole("button")).toHaveLength(1);
  const filter = typeFilters.getByRole("button", { name: "General note 1" });
  await userEvent.click(filter);
  expect(filter).toHaveAttribute("aria-pressed", "true");
});

it("shows readable notes alongside a warning about unavailable pages", async () => {
  vi.mocked(apiFetch).mockResolvedValue(Response.json({ unavailableCount: 1, pages: [{
    id: "readable", type: "note", version: 1, organizer: "Created manually", title: "Readable note", savedAt: 1,
    status: "saved", tasks: [], excerpt: "Review findings", sourceCount: 0,
  } satisfies NoteSummary] }));
  render(<NotePagesView projectId="default" onOpenSource={vi.fn()} />);
  expect(await screen.findByRole("button", { name: "Readable note" })).toBeVisible();
  expect(screen.getByRole("status")).toHaveTextContent("1 note page could not be read.");
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
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
    if (url === "/agents") return Response.json({ agents: [] });
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
    if (url === "/agents") return Response.json({ agents: [] });
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

const reviewer = { name: "scientific-result-reviewer", description: "Review results", source: "project",
  systemPrompt: "Review", enabled: true, canDraftNotes: true };

function candidate(title: string, summary: string, requestId = "a".repeat(32)) {
  return { type: "note", requestId, title, summary, fields: {} };
}

it("reviews a single candidate and restores the original inputs when going back", async () => {
  vi.mocked(apiFetch).mockClear();
  vi.mocked(apiFetch).mockImplementation(async (url, options) => {
    if (url === "/agents") return Response.json({ agents: [reviewer], noteDefaultExpert: reviewer.name });
    if (url === "/notes" && !options?.method) return Response.json({ pages: [] });
    if (url === "/notes/draft") {
      expect(JSON.parse(String(options?.body))).toMatchObject({
        format: "candidates", title: "My title", summary: "My rough notes", taskId: "task-a", model: "direct/mock",
      });
      return Response.json({ candidates: [candidate("Suggested title", "Suggested summary")], draftCredit: { expert: reviewer.name }, taskExcerptShortened: true });
    }
    throw new Error("The assistant must not write a note");
  });

  const user = userEvent.setup();
  render(<NotePagesView projectId="default" currentTask={{ id: "task-a", title: "Current task" }} model="direct/mock" onOpenSource={vi.fn()} />);
  await user.click(await screen.findByRole("button", { name: "New note page" }));
  const title = screen.getByRole("textbox", { name: "Note title" }) as HTMLInputElement;
  const summary = screen.getByRole("textbox", { name: "Current summary" }) as HTMLTextAreaElement;
  const button = screen.getByRole("button", { name: "Draft with expert" }) as HTMLButtonElement;
  expect(button.disabled).toBe(true);
  await user.type(title, "My title");
  await user.type(summary, "My rough notes");
  await user.click(screen.getByRole("checkbox", { name: /Reference current task/ }));
  expect(vi.mocked(apiFetch).mock.calls.some(([url]) => url === "/notes/draft")).toBe(false);
  await user.click(button);
  expect(await screen.findByDisplayValue("Suggested summary")).toBeVisible();
  expect(screen.getByRole("checkbox", { name: "Select Suggested title" })).toBeChecked();
  expect(screen.getByText("The draft uses an excerpt of the task.")).toBeTruthy();
  await user.click(screen.getByRole("button", { name: "Back to editor" }));
  expect(screen.getByRole("textbox", { name: "Note title" })).toHaveValue("My title");
  expect(screen.getByRole("textbox", { name: "Current summary" })).toHaveValue("My rough notes");
  expect(vi.mocked(apiFetch).mock.calls.some(([url, options]) => url === "/notes/batch" || (url === "/notes" && options?.method === "POST"))).toBe(false);
});

it("opens the editor with an exact source and uses that source for both drafting and saving", async () => {
  const anchor = { kind: "message", sessionId: "task-one", entryId: "answer-two" } as const;
  const source = { ...anchor, id: "s1", label: "Selected finding", excerpt: "" };
  const received = vi.fn();
  vi.mocked(apiFetch).mockImplementation(async (url, options) => {
    if (url === "/agents") return Response.json({ agents: [reviewer], noteDefaultExpert: reviewer.name });
    if (url === "/notes" && !options?.method) return Response.json({ pages: [] });
    const body = JSON.parse(String(options?.body));
    received(url, body);
    if (url === "/notes/draft") return Response.json({
      candidates: [candidate("Draft title", "Draft summary")], draftCredit: { expert: reviewer.name }, taskExcerptShortened: false,
    });
    if (url === "/notes/batch") {
      const [draft] = body.pages;
      const page = {
        id: "new-page", schemaVersion: 3, type: "note", typeVersion: 1, organizer: "Created manually", sources: [source],
        revisions: [{ version: 1, title: draft.title, summary: draft.summary, fields: {}, savedAt: 1, status: "saved" }],
      } satisfies NotePage;
      return Response.json({ results: [{ requestId: draft.requestId, status: "saved", page }] });
    }
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
  await user.click(screen.getByRole("button", { name: "Draft with expert" }));
  await screen.findByDisplayValue("Draft summary");
  expect(received).toHaveBeenCalledWith("/notes/draft", expect.objectContaining({ source: anchor }));
  expect(received.mock.calls[0][1]).not.toHaveProperty("taskId");
  await user.click(screen.getByRole("button", { name: "Save note page" }));
  await screen.findByRole("heading", { name: "Draft title" });
  expect(received).toHaveBeenLastCalledWith("/notes/batch", expect.objectContaining({ source: anchor, pages: [candidate("Draft title", "Draft summary")] }));
  expect(received.mock.calls[1][1]).not.toHaveProperty("task");
  await user.click(screen.getByRole("button", { name: "Open source" }));
  expect(onOpenSource).toHaveBeenCalledWith(source);
});

it("preselects the project expert, allows another expert, and shows checks before saving", async () => {
  const expert = "mapping-checker";
  const draftCredit = { expert };
  const drafts = vi.fn();
  const save = vi.fn();
  vi.mocked(apiFetch).mockImplementation(async (url, options) => {
    if (url === "/notes" && !options?.method) return Response.json({ pages: [] });
    if (url === "/agents") return Response.json({ agents: [reviewer, { ...reviewer, name: expert },
      { ...reviewer, name: "disabled-expert", enabled: false }], noteDefaultExpert: reviewer.name });
    const body = JSON.parse(String(options?.body));
    if (url === "/notes/draft") {
      drafts(body);
      return Response.json({ candidates: [candidate("Review", "Reviewed mappings")], draftCredit, taskExcerptShortened: false,
        checks: [{ kind: "table", detail: "2" }] });
    }
    if (url === "/notes/batch") {
      save(body);
      const [draft] = body.pages;
      const page = { id: "expert-page", schemaVersion: 3, type: "note", typeVersion: 1, organizer: "Created manually", sources: [],
        revisions: [{ version: 1, title: draft.title, summary: draft.summary, fields: {}, draftCredit: body.draftCredit, savedAt: 1, status: "saved" }],
      } satisfies NotePage;
      return Response.json({ results: [{ requestId: draft.requestId, status: "saved", page }] });
    }
    throw new Error("Unexpected request");
  });
  const user = userEvent.setup();
  render(<NotePagesView projectId="default" onOpenSource={vi.fn()} />);
  await user.click(await screen.findByRole("button", { name: "New note page" }));
  await screen.findByRole("option", { name: expert });
  const selection = screen.getByRole("combobox", { name: "Note expert" });
  expect(selection).toHaveValue(reviewer.name);
  expect(screen.queryByRole("option", { name: "disabled-expert" })).toBeNull();
  await user.selectOptions(selection, expert);
  const summary = screen.getByRole("textbox", { name: "Current summary" });
  await user.type(summary, "Check the field mappings.");
  await user.click(screen.getByRole("button", { name: "Draft with expert" }));
  expect(drafts).toHaveBeenCalledWith(expect.objectContaining({ expert, summary: "Check the field mappings." }));
  expect(drafts.mock.lastCall![0]).not.toHaveProperty("instructions");
  await screen.findByDisplayValue("Reviewed mappings");
  await user.click(screen.getByText("Expert checks"));
  expect(screen.getByText("Checked 2 table rows")).toBeVisible();
  expect(summary).toHaveValue("Check the field mappings.");
  expect(save).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "Save note page" }));
  await screen.findByText(/Drafted with mapping-checker/);
  expect(save).toHaveBeenCalledWith(expect.objectContaining({ draftCredit, pages: [candidate("Review", "Reviewed mappings")] }));
});

it("cancels drafting without changing the note editor", async () => {
  let signal: AbortSignal | null | undefined;
  vi.mocked(apiFetch).mockImplementation(async (url, options) => {
    if (url === "/agents") return Response.json({ agents: [reviewer], noteDefaultExpert: reviewer.name });
    if (url === "/notes/draft") {
      signal = options?.signal;
      return await new Promise<Response>((_resolve, reject) => {
        signal?.addEventListener("abort", () => reject(new DOMException("Cancelled", "AbortError")), { once: true });
      });
    }
    return Response.json({ pages: [] });
  });
  const user = userEvent.setup();
  render(<NotePagesView projectId="default" onOpenSource={vi.fn()} />);
  await user.click(await screen.findByRole("button", { name: "New note page" }));
  const summary = screen.getByRole("textbox", { name: "Current summary" });
  await user.type(summary, "Keep my original note.");
  await user.click(screen.getByRole("button", { name: "Draft with expert" }));
  await user.click(await screen.findByRole("button", { name: "Cancel drafting" }));
  expect(signal?.aborted).toBe(true);
  expect(await screen.findByRole("button", { name: "Draft with expert" })).toBeEnabled();
  expect(summary).toHaveValue("Keep my original note.");
  expect(screen.queryByRole("region", { name: "Review note candidates" })).toBeNull();
});

it("reviews mixed candidates for a task, saves only selected pages and retries one ambiguous result", async () => {
  const task = { id: "task-a", title: "Review task" };
  const observation = { ...candidate("Observation A", "First summary"), type: "observation", fields: { finding: "Recorded result" } };
  const decision = { ...candidate("Decision B", "Second summary", "b".repeat(32)), type: "decision" };
  const unselected = candidate("Other page", "Third summary", "c".repeat(32));
  const confirmed = vi.fn();
  const draft = vi.fn();
  const savedPage = { id: "saved-id" };
  vi.mocked(apiFetch).mockImplementation(async (url, options) => {
    if (url === "/agents") return Response.json({ agents: [reviewer], noteDefaultExpert: reviewer.name });
    if (url === "/notes" && !options?.method) return Response.json({ pages: [] });
    const body = JSON.parse(String(options?.body));
    if (url === "/notes/draft") {
      draft(body);
      return Response.json({ candidates: [observation, decision, unselected], draftCredit: { expert: reviewer.name }, taskExcerptShortened: false });
    }
    if (url === "/notes/batch") {
      confirmed(body);
      return Response.json({ results: confirmed.mock.calls.length === 1 ? [
        { requestId: decision.requestId, status: "failed", code: 500 },
        { requestId: observation.requestId, status: "saved", page: savedPage },
      ] : [{ requestId: decision.requestId, status: "saved", page: { id: "second-id" } }] });
    }
    throw new Error("Unexpected request");
  });
  const user = userEvent.setup();
  render(<NotePagesView projectId="default" createFrom={{ title: task.title, task }} onOpenSource={vi.fn()} />);
  await user.click(await screen.findByRole("button", { name: "Draft with expert" }));
  expect(draft).toHaveBeenCalledWith(expect.objectContaining({ taskId: task.id, format: "candidates" }));
  const save = await screen.findByRole("button", { name: "Save selected notes" });
  expect(save).toBeDisabled();
  expect(screen.getByText("Observation")).toBeVisible();
  expect(screen.getByText("Decision")).toBeVisible();
  await user.click(screen.getByRole("button", { name: /Observation A/ }));
  const summary = screen.getByRole("textbox", { name: "Current summary" });
  await user.clear(summary);
  await user.type(summary, "Edited summary");
  expect(screen.getByRole("textbox", { name: "Finding" })).toHaveValue("Recorded result");
  await user.click(screen.getByRole("checkbox", { name: "Select Observation A" }));
  await user.click(screen.getByRole("checkbox", { name: "Select Decision B" }));
  await user.click(save);
  expect(confirmed.mock.calls[0][0]).toMatchObject({ task, pages: [{ ...observation, summary: "Edited summary" }, decision] });
  expect(await screen.findByText("Could not confirm the save. Retry this page.")).toBeVisible();
  expect(screen.getByText("1 selected · 1 saved")).toBeVisible();
  await user.click(screen.getByRole("button", { name: "Retry" }));
  expect(await screen.findByText("0 selected · 2 saved")).toBeVisible();
  expect(confirmed.mock.calls[1][0]).toMatchObject({ task, pages: [decision] });
  expect(screen.getByRole("checkbox", { name: "Select Other page" })).not.toBeChecked();
  await user.click(screen.getByRole("button", { name: "Done" }));
  expect(await screen.findByRole("heading", { name: "Notes" })).toBeVisible();
});
