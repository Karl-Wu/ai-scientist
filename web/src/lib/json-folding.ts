import { foldEffect, foldService } from "@codemirror/language";
import { EditorState, StateField } from "@uiw/react-codemirror";

type FoldRange = { from: number; to: number };

// Syntax highlighting parses large files incrementally. Match the delimiters
// across the whole document so a block can fold as soon as its opener is visible.
function indexJsonFolds(source: string): FoldRange[] {
  const ranges: FoldRange[] = [];
  const stack: { from: number; line: number; closer: string }[] = [];
  let line = 0;
  let inString = false;

  for (let pos = 0; pos < source.length; pos++) {
    const char = source[pos];
    if (char === "\n") line++;
    if (inString) {
      if (char === "\\") pos++;
      else if (char === '"') inString = false;
      continue;
    }

    if (char === '"') {
      inString = true;
    } else if (char === "{" || char === "[") {
      stack.push({ from: pos + 1, line, closer: char === "{" ? "}" : "]" });
    } else if (char === "}" || char === "]") {
      const opening = stack.pop();
      if (opening?.closer !== char) stack.length = 0;
      else if (opening.line < line) ranges.push({ from: opening.from, to: pos });
    }
  }
  return ranges.sort((a, b) => a.from - b.from);
}

function firstRangeAtOrAfter(ranges: FoldRange[], pos: number) {
  let start = 0;
  let end = ranges.length;
  while (start < end) {
    const middle = Math.floor((start + end) / 2);
    if (ranges[middle].from < pos) start = middle + 1;
    else end = middle;
  }
  return start;
}

const jsonFoldRanges = StateField.define({
  create: (state) => indexJsonFolds(state.doc.toString()),
  update: (ranges, transaction) => transaction.docChanged ? indexJsonFolds(transaction.newDoc.toString()) : ranges,
});

export const jsonFolding = [
  jsonFoldRanges,
  foldService.of((state, lineStart, lineEnd) => {
    const ranges = state.field(jsonFoldRanges);
    const range = ranges[firstRangeAtOrAfter(ranges, lineStart)];
    return range && range.from <= lineEnd && range.to > lineEnd ? range : null;
  }),
  EditorState.transactionExtender.of((transaction) => {
    if (transaction.docChanged || !transaction.effects.length) return null;
    const ranges = transaction.startState.field(jsonFoldRanges);
    const effects = transaction.effects.flatMap((effect) => {
      if (!effect.is(foldEffect)) return [];
      const parent = effect.value;
      const children: typeof effect[] = [];
      for (let i = firstRangeAtOrAfter(ranges, parent.from + 1); i < ranges.length && ranges[i].from < parent.to; i++) {
        const range = ranges[i];
        if (range.to <= parent.to) children.push(foldEffect.of(range));
      }
      return children;
    });
    // CodeMirror unfolds only the clicked range, leaving child folds in place.
    return effects.length ? { effects } : null;
  }),
];
