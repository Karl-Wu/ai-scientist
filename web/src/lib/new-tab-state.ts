import type { ChatWorkspaceState } from "@/lib/workspace-persistence";
import { EMPTY_DELEGATION } from "@/lib/composer-context";
import type { Model } from "@/components/model-selector";

/**
 * The workspace state a freshly opened chat tab should start from.
 *
 * A new chat almost always continues the same piece of work the user was
 * already doing, so it inherits the *choices* the source tab was configured
 * with — thinking level and compute target, plus its model when no explicit
 * app default model is configured — but never that tab's
 * in-progress content. Draft text, attachments, pinned databases/skills, +
 * menu research/delegation picks, and queued prompts belong to the
 * conversation that created them, so they start
 * empty. With no source tab (the very first tab of a project) the caller
 * falls back to the app defaults instead.
 */
export function seedChatStateFromTab(
  source: ChatWorkspaceState | undefined,
  defaultModel?: Model,
): ChatWorkspaceState | null {
  if (!source) return null;
  return {
    selectedModel: defaultModel ?? source.selectedModel,
    thinkingLevel: source.thinkingLevel,
    selectedComputeTarget: source.selectedComputeTarget,
    attachedFiles: [],
    selectedDatabases: [],
    selectedSkills: [],
    researchRefs: [],
    delegation: EMPTY_DELEGATION,
    queuedMessages: [],
    composer: { text: "", attachments: [] },
  };
}
