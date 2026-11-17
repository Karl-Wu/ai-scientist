import zhCN from "@/data/workflow-prompt-locales/zh-CN.json";
import type { Locale } from "@/lib/i18n";
import { WORKFLOW_PROMPT_COPY, type WorkflowPromptCopy } from "./workflow-inputs";

interface PreviewCatalog {
  workflows: Record<string, { source: string; text: string }>;
  copy: { source: WorkflowPromptCopy; text: WorkflowPromptCopy };
}
// Additional UI languages can register their own catalogs here.
const catalogs: Partial<Record<Locale, PreviewCatalog>> = { "zh-CN": zhCN };
export function workflowPromptTranslation(id: string, original: string, locale: Locale,
  catalog = catalogs[locale],
): { status: "available"; text: string; copy: WorkflowPromptCopy } | { status: "missing" | "stale" } {
  const item = catalog?.workflows[id];
  if (!item || !catalog) return { status: "missing" };
  // This is a version check, not a security digest: exact source equality avoids
  // both stale translations and hash-collision concerns, with no runtime model call.
  if (item.source !== original || (Object.keys(WORKFLOW_PROMPT_COPY) as (keyof WorkflowPromptCopy)[])
    .some((key) => catalog.copy.source[key] !== WORKFLOW_PROMPT_COPY[key])) return { status: "stale" };
  const tokens = (value: string) => [...new Set(value.match(/\{\w+\}/g) ?? [])].sort().join("\0");
  if (!item.text.trim() || tokens(original) !== tokens(item.text)) return { status: "stale" };
  return { status: "available", text: item.text, copy: catalog.copy.text };
}
