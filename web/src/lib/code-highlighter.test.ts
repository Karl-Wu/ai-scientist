import { describe, expect, it, vi } from "vitest";
import { code, type HighlightOptions } from "@streamdown/code";
import { safeCode } from "./code-highlighter";

describe("safeCode", () => {
  it("renders unsupported languages as plain text without logging an error", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const source = 'run: lung_cancer -> { select: examination_id }';
    try {
      for (const language of ["malloy", "unknown-scientific-language"]) {
        const result = await new Promise<Parameters<NonNullable<Parameters<typeof code.highlight>[1]>>[0]>((resolve) => {
          const immediate = safeCode.highlight({
            code: source,
            language: language as HighlightOptions["language"],
            themes: code.getThemes(),
          }, resolve);
          if (immediate) resolve(immediate);
        });
        expect(result.tokens.flat().map((token) => token.content).join("")).toBe(source);
      }
      expect(error).not.toHaveBeenCalled();
    } finally {
      error.mockRestore();
    }
  });

  it("keeps syntax highlighting for supported languages and aliases", () => {
    const highlight = vi.spyOn(code, "highlight").mockReturnValue(null);
    try {
      for (const language of ["python", "js"] as HighlightOptions["language"][]) {
        const options = { code: "x = 1", language, themes: code.getThemes() };
        safeCode.highlight(options);
        expect(highlight).toHaveBeenLastCalledWith(options, undefined);
      }
    } finally {
      highlight.mockRestore();
    }
  });
});
