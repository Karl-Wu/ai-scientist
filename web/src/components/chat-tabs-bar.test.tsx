import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ChatTabsBar } from "./chat-tabs-bar";
import { apiFetch } from "@/lib/projects";
import { toast } from "sonner";
vi.mock("@/lib/projects", () => ({ apiFetch: vi.fn() }));
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));
vi.mock("@/components/ui/confirm-dialog", () => ({ useConfirm: () => ({ confirm: async () => true, dialog: null }) }));
const saved = { id: "saved-chat", name: "Historical chat", created: Date.now(), modified: Date.now(), messageCount: 2, visibleInHistory: true, isRunning: false };
const fetchMock = vi.mocked(apiFetch);
const props = {
  projectId: "project-a", tabs: [{ id: "blank", title: "New chat", isStreaming: false, userMessageCount: 0 }],
  activeTabId: "blank", maxTabs: 10,
  onSelect: vi.fn(), onClose: vi.fn(), onNew: vi.fn(), onRename: vi.fn(), onOpenSession: vi.fn(),
};
beforeEach(() => {
  vi.clearAllMocks();
  fetchMock.mockImplementation(async (_url, options) => ({
    ok: true, status: 200, json: async () => options?.method === "DELETE" ? { deleted: true } : [saved],
  } as Response));
});
describe("historical chat deletion", () => {
  it("shows a running indicator on an inactive saved chat and removes it when the run ends", async () => {
    const tabs = [props.tabs[0], { id: "background", title: "Historical chat", sessionId: saved.id, isStreaming: true, userMessageCount: 1 }];
    const view = render(<TooltipProvider><ChatTabsBar {...props} tabs={tabs} /></TooltipProvider>);
    await screen.findByText("Historical chat");
    expect(screen.getByRole("status", { name: "Task is running" })).toBeInTheDocument();
    view.rerender(<TooltipProvider><ChatTabsBar {...props} tabs={[tabs[0], { ...tabs[1], isStreaming: false }]} /></TooltipProvider>);
    expect(screen.queryByRole("status", { name: "Task is running" })).not.toBeInTheDocument();
  });

  it("shows a saved meaningful title instead of an open tab's placeholder", async () => {
    render(<TooltipProvider><ChatTabsBar {...props} tabs={[{ ...props.tabs[0], title: "Chat 1", sessionId: saved.id }]} /></TooltipProvider>);
    expect(await screen.findByText("Historical chat")).toBeInTheDocument();
    expect(screen.queryByText("Chat 1")).not.toBeInTheDocument();
  });

  it("refreshes session metadata when a message is sent instead of waiting for polling", async () => {
    const initial = [{ ...props.tabs[0], sessionId: saved.id }];
    const view = render(<TooltipProvider><ChatTabsBar {...props} tabs={initial} /></TooltipProvider>);
    await screen.findByRole("button", { name: "Task actions for Historical chat" });
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    fetchMock.mockClear();
    view.rerender(<TooltipProvider><ChatTabsBar {...props} tabs={[{ ...initial[0], userMessageCount: 1, isStreaming: true }]} /></TooltipProvider>);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/sessions", {}, "project-a"));
  });

  it("offers Delete on unopened history and removes it after API success", async () => {
    const user = userEvent.setup();
    render(<TooltipProvider><ChatTabsBar {...props} /></TooltipProvider>);
    await user.click(await screen.findByRole("button", { name: "Task actions for Historical chat" }));
    await user.click(screen.getByRole("menuitem", { name: "Delete" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/sessions/saved-chat", { method: "DELETE" }, "project-a"));
    await waitFor(() => expect(screen.queryByText("Historical chat")).not.toBeInTheDocument());
    expect(props.onClose).not.toHaveBeenCalled();
  });
  it("keeps history visible when the backend refuses deletion", async () => {
    fetchMock.mockImplementation(async (_url, options) => ({
      ok: options?.method !== "DELETE", status: options?.method === "DELETE" ? 409 : 200,
      json: async () => options?.method === "DELETE" ? { detail: "Stop the running chat before deleting it" } : [saved],
    } as Response));
    const user = userEvent.setup();
    render(<TooltipProvider><ChatTabsBar {...props} /></TooltipProvider>);
    await user.click(await screen.findByRole("button", { name: "Task actions for Historical chat" }));
    await user.click(screen.getByRole("menuitem", { name: "Delete" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Stop the running chat before deleting it"));
    expect(screen.getByText("Historical chat")).toBeInTheDocument();
    expect(props.onClose).not.toHaveBeenCalled();
  });
});

describe("draft conversation visibility", () => {
  it("hides empty drafts and inputs that the backend has not saved", async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => [
      { ...saved, id: "empty", name: "Chat 1", messageCount: 0, visibleInHistory: false },
    ] } as Response);
    const tabs = [
      { ...props.tabs[0], title: "Chat 2", hasCompletedTurn: false },
      { ...props.tabs[0], id: "unsaved", title: "Rejected submission", userMessageCount: 1, hasCompletedTurn: true },
    ];
    render(<TooltipProvider><ChatTabsBar {...props} tabs={tabs} /></TooltipProvider>);
    await screen.findByText("No tasks yet.");
    expect(screen.queryByText("Chat 1")).not.toBeInTheDocument();
    expect(screen.queryByText("Chat 2")).not.toBeInTheDocument();
    expect(screen.queryByText("Rejected submission")).not.toBeInTheDocument();
  });

  it("shows a first prompt as soon as it is saved and can reopen it after remounting", async () => {
    const pending = { ...saved, name: null, firstMessage: "Analyze my data", messageCount: 1, isRunning: true };
    fetchMock.mockResolvedValue({ ok: true, json: async () => [] } as Response);
    const tab = { ...props.tabs[0], sessionId: saved.id, userMessageCount: 1, isStreaming: true, hasCompletedTurn: false };
    const view = render(<TooltipProvider><ChatTabsBar {...props} tabs={[tab]} /></TooltipProvider>);
    await screen.findByText("No tasks yet.");
    fetchMock.mockResolvedValue({ ok: true, json: async () => [pending] } as Response);
    act(() => { window.dispatchEvent(new Event("kady:tasks-changed")); });
    expect(await screen.findByText("Analyze my data")).toBeInTheDocument();
    expect(screen.getAllByText("Analyze my data")).toHaveLength(1);
    expect(screen.getByRole("status", { name: "Task is running" })).toBeInTheDocument();

    view.unmount();
    render(<TooltipProvider><ChatTabsBar {...props} /></TooltipProvider>);
    await userEvent.click(await screen.findByText("Analyze my data"));
    expect(props.onOpenSession).toHaveBeenCalledWith(saved.id, "Analyze my data");
    expect(screen.getByRole("status", { name: "Task is running" })).toBeInTheDocument();

    fetchMock.mockResolvedValue({ ok: true, json: async () => [{ ...pending, isRunning: false }] } as Response);
    act(() => { window.dispatchEvent(new Event("kady:tasks-changed")); });
    await waitFor(() => expect(screen.queryByRole("status", { name: "Task is running" })).not.toBeInTheDocument());
    expect(screen.getByText("Analyze my data")).toBeInTheDocument();
  });
});

describe("saved chat names", () => {
  it("renames an unopened chat and reads the saved name after remounting", async () => {
    let name = saved.name;
    fetchMock.mockImplementation(async (_url, options) => {
      if (options?.method === "PATCH") name = JSON.parse(String(options.body)).name;
      return { ok: true, json: async () => [{ ...saved, name }] } as Response;
    });
    const user = userEvent.setup();
    const view = render(<TooltipProvider><ChatTabsBar {...props} /></TooltipProvider>);
    await user.click(await screen.findByRole("button", { name: "Task actions for Historical chat" }));
    await user.click(screen.getByRole("menuitem", { name: "Rename" }));
    const input = screen.getByRole("textbox", { name: "Task name" });
    await user.clear(input);
    await user.type(input, "Renamed research{Enter}");
    expect(await screen.findByText("Renamed research")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith("/sessions/saved-chat", expect.objectContaining({ method: "PATCH", body: JSON.stringify({ name: "Renamed research" }) }), "project-a");
    expect(props.onOpenSession).not.toHaveBeenCalled();
    view.unmount();
    render(<TooltipProvider><ChatTabsBar {...props} /></TooltipProvider>);
    expect(await screen.findByText("Renamed research")).toBeInTheDocument();
  });

  it("keeps the previous name when the server refuses the rename", async () => {
    fetchMock.mockImplementation(async (_url, options) => ({ ok: options?.method !== "PATCH", json: async () => [saved] } as Response));
    const user = userEvent.setup();
    render(<TooltipProvider><ChatTabsBar {...props} /></TooltipProvider>);
    await user.click(await screen.findByRole("button", { name: "Task actions for Historical chat" }));
    await user.click(screen.getByRole("menuitem", { name: "Rename" }));
    const input = screen.getByRole("textbox", { name: "Task name" });
    await user.clear(input);
    await user.type(input, "Unsaved name{Enter}");
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Could not rename task. Please try again."));
    expect(screen.getByText("Historical chat")).toBeInTheDocument();
  });
});
