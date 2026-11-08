import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatMessage } from "@/lib/use-agent";
import { conversationTurns, ConversationMap } from "./conversation-map";

const context = vi.hoisted(() => ({ scrollRef: { current: null as HTMLElement | null }, contentRef: { current: null as HTMLElement | null }, stopScroll: vi.fn() }));
vi.mock("use-stick-to-bottom", () => ({ useStickToBottomContext: () => context }));
const message = (id: string, role: ChatMessage["role"], content: string): ChatMessage => ({ id, role, content, timestamp: 1 });

describe("conversation map", () => {
  beforeEach(() => { vi.clearAllMocks(); context.scrollRef.current = null; context.contentRef.current = null; });

  it("groups assistant continuations with their user turn and ignores system notices", () => {
    expect(conversationTurns([
      message("old", "assistant", "Orphan response"),
      message("u1", "user", "First question"),
      message("a1", "assistant", "First answer"),
      message("system", "system", "A notice"),
      message("a2", "assistant", "Continuation"),
      message("u2", "user", "Second question"),
    ])).toEqual([
      { id: "u1", prompt: "First question", answer: "Continuation" },
      { id: "u2", prompt: "Second question", answer: "" },
    ]);
  });

  it("omits navigation for a single turn", () => {
    render(<ConversationMap messages={[message("u1", "user", "Only question")]} />);
    expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
  });

  it("jumps within the chat scroll container and releases following the latest message", () => {
    const { container } = render(<ConversationMap messages={[message("u1", "user", "One"), message("u2", "user", "Two")]} />);
    const scroll = document.createElement("div");
    const content = document.createElement("div");
    const target = document.createElement("div");
    target.dataset.chatUserId = "u1";
    content.append(target);
    context.scrollRef.current = scroll;
    context.contentRef.current = content;
    scroll.scrollTop = 100;
    scroll.getBoundingClientRect = () => ({ top: 20 }) as DOMRect;
    target.getBoundingClientRect = () => ({ top: 300 }) as DOMRect;
    scroll.scrollTo = vi.fn();
    vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: true })));
    fireEvent.click(screen.getByRole("button", { name: "Go to turn 1: One" }));
    expect(context.stopScroll).toHaveBeenCalledOnce();
    expect(scroll.scrollTo).toHaveBeenCalledWith({ top: 364, behavior: "instant" });
    expect(container.querySelector("nav")).toHaveClass("hidden", "@min-[640px]/chat:flex");
    context.scrollRef.current = null;
    context.contentRef.current = null;
    vi.unstubAllGlobals();
  });
});
