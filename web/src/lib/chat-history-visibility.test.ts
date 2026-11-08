import { describe, expect, it } from "vitest";
import { hasCompletedChatTurn } from "./chat-history-visibility";
import type { ChatMessage } from "./use-agent";
const msg = (role: ChatMessage["role"]): ChatMessage => ({ id: `${role}-${Math.random()}`, role, content: "text", timestamp: 1 });
describe("completed chat history", () => {
  it("excludes empty drafts, notices and the first in-flight response", () => {
    expect(hasCompletedChatTurn([], false)).toBe(false);
    expect(hasCompletedChatTurn([msg("system")], false)).toBe(false);
    expect(hasCompletedChatTurn([msg("user")], false)).toBe(false);
    expect(hasCompletedChatTurn([msg("user"), msg("assistant")], true)).toBe(false);
  });
  it("includes a completed response and keeps it visible during a later turn", () => {
    expect(hasCompletedChatTurn([msg("user"), msg("assistant")], false)).toBe(true);
    expect(hasCompletedChatTurn([msg("user"), msg("assistant"), msg("user"), msg("assistant")], true)).toBe(true);
  });
});
