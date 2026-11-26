import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ResearchPickerBody } from "./research-picker";
import { buildComposerContext, EMPTY_DELEGATION, type ResearchRef } from "@/lib/composer-context";
import type { NoteSummary } from "@/lib/note-pages";

vi.mock("@/lib/projects", async (original) => ({ ...await original<typeof import("@/lib/projects")>(), apiFetch: vi.fn() }));
const { apiFetch } = await import("@/lib/projects");
const fetch = vi.mocked(apiFetch);
const json = (body: unknown, ok = true) => ({ ok, status: ok ? 200 : 500, json: async () => body }) as Response;

const page: NoteSummary = {
  id: "c13de100-6450-4f00-9284-89e0a10d48ff", type: "mappingRule", version: 2, title: "Batch mapping",
  excerpt: "Map B to Batch B.", savedAt: 3, organizer: "Created manually", tasks: [], status: "saved", sourceCount: 0,
};
const observation: NoteSummary = {
  ...page, id: "c13de100-6450-4f00-9284-89e0a10d4800", type: "observation", version: 1, title: "Batch dominates PC1", savedAt: 2,
};
const sessions = [
  { id: "current", name: null, modified: 5, messageCount: 4, firstMessage: "This chat" },
  { id: "older", name: null, modified: 4, messageCount: 6, firstMessage: "Run QC on counts.csv" },
  { id: "empty", name: null, modified: 3, messageCount: 0, firstMessage: null },
];

beforeEach(() => {
  vi.clearAllMocks();
  fetch.mockImplementation(async (url) => {
    const u = String(url);
    if (u === "/notes?q=Harmony") return json({ pages: [observation] });
    if (u === "/notes") return json({ pages: [page, observation] });
    if (u === "/sessions") return json(sessions);
    return json({}, false);
  });
});

function setup(selected: ResearchRef[] = []) {
  const onChange = vi.fn();
  render(<ResearchPickerBody projectId="project-a" currentSessionId="current" selected={selected} onChange={onChange} />);
  return { onChange, user: userEvent.setup() };
}

describe("ResearchPickerBody", () => {
  it("lists the project's note pages and builds a reference that reads the selected revision", async () => {
    const { onChange, user } = setup();
    await screen.findByText(page.title);
    expect(fetch).toHaveBeenCalledWith("/notes", expect.anything(), "project-a");
    const rows = screen.getAllByRole("checkbox");
    expect(rows[0]).toHaveTextContent(page.title);
    await user.click(rows[0]);
    expect(onChange).toHaveBeenCalledWith([{ kind: "note", id: page.id, type: page.type, title: page.title, version: 2 }]);
    const prompt = buildComposerContext({ delegation: EMPTY_DELEGATION, research: onChange.mock.calls[0][0] });
    expect(prompt).toContain(`note ${page.id} · revision 2`);
    expect(prompt).toContain("Use note_read");
    expect(prompt).not.toContain("notebook_search");
  });

  it("searches the project note pages using the notes API", async () => {
    const { onChange, user } = setup();
    await screen.findByText(page.title);
    await user.type(screen.getByLabelText("Search note pages"), "Harmony");
    expect(await screen.findByRole("checkbox", { name: /Batch dominates PC1/ })).toBeTruthy();
    expect(fetch).toHaveBeenCalledWith("/notes?q=Harmony", expect.anything(), "project-a");
    expect(screen.queryByText(page.title)).toBeNull();
    expect(screen.getByRole("button", { name: "Mapping rule" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Hypothesis" })).toBeNull();
    await user.click(screen.getByRole("checkbox", { name: /Batch dominates PC1/ }));
    expect(onChange).toHaveBeenCalledWith([{ kind: "note", id: observation.id, type: "observation", title: observation.title, version: 1 }]);
  });

  it("filters by the new note types and indicates if the selected revision is older", async () => {
    const { user } = setup([{ kind: "note", id: page.id, type: page.type, title: page.title, version: 1 }]);
    await screen.findByText(page.title);
    await user.click(screen.getByRole("button", { name: "Mapping rule" }));
    expect(screen.queryByText(observation.title)).toBeNull();
    expect(screen.getByRole("checkbox", { name: /Batch mapping/ })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByText("Selected revision 1")).toBeTruthy();
  });

  it("shows All and the available type for a project with only one note type", async () => {
    fetch.mockResolvedValue(json({ pages: [page] }));
    setup();
    await screen.findByText(page.title);
    expect(screen.getByRole("button", { name: "All" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Mapping rule" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Observation" })).toBeNull();
  });

  it("offers earlier chats, excluding this one and empty ones, and deselects", async () => {
    const picked: ResearchRef = { kind: "chat", sessionId: "older", title: "Run QC on counts.csv" };
    const { onChange, user } = setup([picked]);
    await user.click(screen.getByRole("radio", { name: "Tasks" }));
    const row = await screen.findByRole("checkbox", { name: /Run QC on counts.csv/ });
    expect(row).toHaveAttribute("aria-checked", "true");
    expect(screen.queryByText("This chat")).toBeNull();
    expect(screen.getAllByRole("checkbox")).toHaveLength(1);
    await user.click(row);
    expect(onChange).toHaveBeenCalledWith([]);
  });

  it("shows a search failure instead of an empty list", async () => {
    fetch.mockImplementation(async () => json({ detail: "Enter a query" }, false));
    setup();
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not load notes.");
  });
});
