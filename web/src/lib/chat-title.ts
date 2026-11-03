import { commandPreview } from "@/lib/command-blocks";

export function suggestedChatTitle(firstMessage: string | undefined): string | undefined {
  const text = commandPreview(firstMessage ?? "").replace(/\s+/g, " ").trim();
  return text ? (text.length > 60 ? `${text.slice(0, 60)}…` : text) : undefined;
}

export function resolveChatTitle(title: string, suggestion?: string, isCustom = false): string {
  return !isCustom && /^Chat\s+\d+$/i.test(title.trim()) && suggestion ? suggestion : title;
}
