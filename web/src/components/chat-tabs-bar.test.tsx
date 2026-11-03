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
