import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AnswerActions } from "./answer-actions";
import * as api from "@/lib/projects";
import type { TaskResponse } from "@/lib/use-task-responses";
vi.mock("@/lib/projects", () => ({ apiFetch: vi.fn() }));
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));
const response: TaskResponse = { entryId: "answer", content: "Finding", feedback: null, children: [] };
const onOpenTask = vi.fn();
const props = { projectId: "p1", sessionId: "s1", response, copied: false, canFork: true, onCopy: vi.fn(), onOpenTask };
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.apiFetch).mockResolvedValue({ ok: true, json: async () => ({ id: "child", name: "Research (1)" }) } as Response);
});
const show = (value = props) => render(<TooltipProvider><AnswerActions {...value} /></TooltipProvider>);
it("saves icon-only feedback, toggles off, and switches mutually exclusively", async () => {
  const view = show();
  expect(screen.getByRole("button", { name: "Like" })).toHaveAttribute("aria-pressed", "false");
  fireEvent.click(screen.getByRole("button", { name: "Like" }));
  await waitFor(() => expect(api.apiFetch).toHaveBeenCalledWith("/sessions/s1/responses/answer/feedback", expect.objectContaining({ body: JSON.stringify({ feedback: "up" }) }), "p1"));
  view.rerender(<TooltipProvider><AnswerActions {...props} response={{ ...response, feedback: "up" }} /></TooltipProvider>);
  await waitFor(() => expect(screen.getByRole("button", { name: "Like" })).not.toBeDisabled());
  fireEvent.click(screen.getByRole("button", { name: "Like" }));
  await waitFor(() => expect(api.apiFetch).toHaveBeenLastCalledWith(expect.any(String), expect.objectContaining({ body: JSON.stringify({ feedback: null }) }), "p1"));
  await waitFor(() => expect(screen.getByRole("button", { name: "Dislike" })).not.toBeDisabled());
  fireEvent.click(screen.getByRole("button", { name: "Dislike" }));
  await waitFor(() => expect(api.apiFetch).toHaveBeenLastCalledWith(expect.any(String), expect.objectContaining({ body: JSON.stringify({ feedback: "down" }) }), "p1"));
});
it("creates and opens a task directly when there are no children", async () => {
  show();
  const fork = screen.getByRole("button", { name: "New task from here" });
  expect(within(fork).getByText("New task from here")).toHaveClass("sr-only");
  await userEvent.hover(fork);
  expect(await screen.findByRole("tooltip")).toHaveTextContent("New task from here");
  fireEvent.click(fork);
  await waitFor(() => expect(onOpenTask).toHaveBeenCalledWith("child", "Research (1)"));
  expect(api.apiFetch).toHaveBeenCalledWith("/sessions/s1/responses/answer/fork", { method: "POST" }, "p1");
});
it("lists existing children with a way to open or create another", async () => {
  show({ ...props, response: { ...response, children: [{ id: "child", name: "Existing task" }] } });
  await userEvent.click(screen.getByRole("button", { name: "Follow-up tasks 1" }));
  expect(await screen.findByText("Tasks from this answer")).toBeInTheDocument();
  await userEvent.click(screen.getByRole("menuitem", { name: /Existing task/ }));
  expect(onOpenTask).toHaveBeenCalledWith("child", "Existing task");
});
it("prevents creating branches during a run and before persistence", () => {
  const view = show({ ...props, canFork: false });
  expect(screen.getByRole("button", { name: "New task from here" })).toBeDisabled();
  view.rerender(<TooltipProvider><AnswerActions {...props} response={undefined} /></TooltipProvider>);
  expect(screen.getByRole("button", { name: "Like" })).toBeDisabled();
});

it("opens a note draft anchored to the persisted answer", async () => {
  const onCreateNote = vi.fn();
  render(<TooltipProvider><AnswerActions {...props} onCreateNote={onCreateNote} /></TooltipProvider>);
  await userEvent.click(screen.getByRole("button", { name: "Create note from this answer" }));
  expect(onCreateNote).toHaveBeenCalledWith({ title: "Finding", anchor: { kind: "message", sessionId: "s1", entryId: "answer" } });
  expect(api.apiFetch).not.toHaveBeenCalled();
});
