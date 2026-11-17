import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import workflows from "@/data/workflows.json";
import catalog from "@/data/workflow-prompt-locales/zh-CN.json";
import { workflowPromptTranslation } from "./workflow-prompt-preview";
import { buildWorkflowPrompt, WORKFLOW_PROMPT_COPY } from "./workflow-inputs";

describe("version-bound prompt preview catalogs", () => {
  it("keeps every shipped translation bound to exact source text and preserves variable tokens", () => {
    expect(Object.keys(catalog.workflows).sort()).toEqual(workflows.map((workflow) => workflow.id).sort());
    for (const [id, entry] of Object.entries(catalog.workflows)) {
      const original = workflows.find((workflow) => workflow.id === id)!;
      expect(entry.source, id).toBe(original.prompt);
      expect(workflowPromptTranslation(id, original.prompt, "zh-CN").status, id).toBe("available");
      expect([...entry.text.matchAll(/\{\w+\}/g)].map(([token]) => token).sort()).toEqual([...original.prompt.matchAll(/\{\w+\}/g)].map(([token]) => token).sort());
    }
    expect(catalog.copy.source).toEqual(WORKFLOW_PROMPT_COPY);
  });
  it("rejects stale source or shared instructions and missing languages", () => {
    const source = workflows.find((workflow) => workflow.id === "review-paper")!.prompt;
    expect(workflowPromptTranslation("review-paper", source + "!", "zh-CN").status).toBe("stale");
    expect(workflowPromptTranslation("untranslated", "original", "zh-CN").status).toBe("missing");
    expect(workflowPromptTranslation("review-paper", source, "en").status).toBe("missing");
    const stale = { ...catalog, copy: { ...catalog.copy, source: { ...catalog.copy.source, guidance: "older" } } };
    expect(workflowPromptTranslation("review-paper", source, "zh-CN", stale).status).toBe("stale");
  });
  it("keeps execution prompt byte-for-byte compatible with the previous builder", () => {
    // Captured from the original builder before adding display-only localization.
    expect(createHash("sha256").update(buildWorkflowPrompt("BASE", [], "")).digest("hex")).toBe("d84048fe20337065c95dbc1a6f55303abe083d0772c7aac288cf12107a063cfb");
    expect(createHash("sha256").update(buildWorkflowPrompt("BASE\n内容", ["user_data/中 文.csv", "user_data/中 文.csv"], "s3://bucket/thing\nC:\\work\\data", ["derived"])).digest("hex")).toBe("e50fddf396a2a92e8c8465c224f7891d78c8b8aeee592343fdf0a8bc7c197efb");
  });
});
