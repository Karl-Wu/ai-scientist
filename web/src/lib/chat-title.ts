import { commandPreview } from "@/lib/command-blocks";
import type { Translate } from "@/lib/translations";

/** Localize generated placeholders without rewriting stored or user-chosen names. */
export function taskDisplayTitle(title: string, isCustom: boolean | undefined, t: Translate): string {
  const placeholder = !isCustom && /^Chat\s+(\d+)$/i.exec(title.trim());
  return placeholder ? t("Task {number}", { number: placeholder[1] }) : title;
}

export function suggestedChatTitle(firstMessage: string | undefined): string | undefined {
  const text = commandPreview(firstMessage ?? "").replace(/\s+/g, " ").trim();
  return text ? (text.length > 60 ? `${text.slice(0, 60)}…` : text) : undefined;
}

export function resolveChatTitle(title: string, suggestion?: string, isCustom = false): string {
  return !isCustom && /^Chat\s+\d+$/i.test(title.trim()) && suggestion ? suggestion : title;
}
