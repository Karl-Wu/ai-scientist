import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ChatTabsBar } from "./chat-tabs-bar";
import { apiFetch } from "@/lib/projects";
import { toast } from "sonner";
vi.mock("@/lib/projects", () => ({ apiFetch: vi.fn() }));
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));
vi.mock("@/components/ui/confirm-dialog", () => ({ useConfirm: () => ({ confirm: async () => true, dialog: null }) }));
const saved = { id: "saved-chat", name: "Historical chat", created: Date.now(), modified: Date.now(), messageCount: 2 };
const fetchMock = vi.mocked(apiFetch);
const props = {
  projectId: "project-a", tabs: [{ id: "blank", title: "New chat", isStreaming: false, userMessageCount: 0 }],
  activeTabId: "blank", view: "chat" as const, maxTabs: 10,
  onSelect: vi.fn(), onClose: vi.fn(), onNew: vi.fn(), onRename: vi.fn(), onSelectWorkflows: vi.fn(), onOpenSession: vi.fn(),
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
    expect(screen.getByRole("status", { name: "Chat is running" })).toBeInTheDocument();
    view.rerender(<TooltipProvider><ChatTabsBar {...props} tabs={[tabs[0], { ...tabs[1], isStreaming: false }]} /></TooltipProvider>);
    expect(screen.queryByRole("status", { name: "Chat is running" })).not.toBeInTheDocument();
  });

  it("shows a saved meaningful title instead of an open tab's placeholder", async () => {
    render(<TooltipProvider><ChatTabsBar {...props} tabs={[{ ...props.tabs[0], title: "Chat 1", sessionId: saved.id }]} /></TooltipProvider>);
    expect(await screen.findByText("Historical chat")).toBeInTheDocument();
    expect(screen.queryByText("Chat 1")).not.toBeInTheDocument();
  });

  it("refreshes session metadata when a message is sent instead of waiting for polling", async () => {
    const initial = [{ ...props.tabs[0], sessionId: saved.id }];
    const view = render(<TooltipProvider><ChatTabsBar {...props} tabs={initial} /></TooltipProvider>);
    await screen.findByRole("button", { name: "Chat actions for New chat" });
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    fetchMock.mockClear();
    view.rerender(<TooltipProvider><ChatTabsBar {...props} tabs={[{ ...initial[0], userMessageCount: 1, isStreaming: true }]} /></TooltipProvider>);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/sessions", {}, "project-a"));
  });

  it("offers Delete on unopened history and removes it after API success", async () => {
    const user = userEvent.setup();
    render(<TooltipProvider><ChatTabsBar {...props} /></TooltipProvider>);
    await user.click(await screen.findByRole("button", { name: "Chat actions for Historical chat" }));
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
    await user.click(await screen.findByRole("button", { name: "Chat actions for Historical chat" }));
    await user.click(screen.getByRole("menuitem", { name: "Delete" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Stop the running chat before deleting it"));
    expect(screen.getByText("Historical chat")).toBeInTheDocument();
    expect(props.onClose).not.toHaveBeenCalled();
  });
});
