import type { ChatMessage } from "./use-agent";

/** A draft or a first response still streaming is not a recent conversation. */
export function hasCompletedChatTurn(messages: ChatMessage[], isStreaming: boolean): boolean {
  const lastUser = messages.findLastIndex((message) => message.role === "user");
  if (lastUser < 0) return false;
  let hasUser = false;
  return messages.some((message, index) => {
    if (message.role === "user") hasUser = true;
    return hasUser && message.role === "assistant" && (!isStreaming || index < lastUser);
  });
}
