import { code, type HighlightOptions } from "@streamdown/code";

// Model output may name languages outside Shiki's bundled grammars. Keep the
// code intact, but never ask Shiki to load a grammar it does not ship.
export const safeCode = {
  ...code,
  highlight(options: HighlightOptions, callback?: Parameters<typeof code.highlight>[1]) {
    return code.highlight(
      code.supportsLanguage(options.language)
        ? options
        : { ...options, language: "text" as HighlightOptions["language"] },
      callback,
    );
  },
};
