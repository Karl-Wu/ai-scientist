import { fireEvent, render, screen } from "@testing-library/react";
import { foldable, foldedRanges, syntaxTreeAvailable } from "@codemirror/language";
import { expect, it, vi } from "vitest";
import { EditorView } from "@uiw/react-codemirror";
import { ReadOnlyCodeView } from "./code-views";

it("collapses a JSON block and its descendants, then opens only the clicked block", async () => {
  const source = JSON.stringify({ results: [{ title: "A result" }], metadata: { owner: "Reviewer" } }, null, 2);
  const { container } = render(<ReadOnlyCodeView content={source} name="report.json" />);
  await screen.findByText(/"A result"/);
  const editor = EditorView.findFromDOM(container.querySelector<HTMLElement>(".cm-editor")!)!;
  const rootArrow = screen.getAllByTitle("Fold line")[0];
  fireEvent.click(rootArrow, { clientY: editor.documentTop + 1 });
  expect(foldedRanges(editor.state).size).toBe(4);
  expect(screen.queryByText('"results"')).not.toBeInTheDocument();

  fireEvent.click(screen.getByLabelText("folded code"));
  expect(foldedRanges(editor.state).size).toBe(3);
  expect(screen.getByText('"results"')).toBeInTheDocument();
  expect(screen.getByText('"metadata"')).toBeInTheDocument();
  expect(screen.queryByText(/"A result"/)).not.toBeInTheDocument();

  const resultsLine = screen.getByText('"results"').closest(".cm-line")!;
  fireEvent.click(resultsLine.querySelector(".cm-foldPlaceholder")!);
  expect(foldedRanges(editor.state).size).toBe(2);
  expect(screen.queryByText(/"A result"/)).not.toBeInTheDocument();

  fireEvent.click(screen.getAllByLabelText("folded code")[0]);
  expect(screen.getByText(/"A result"/)).toBeInTheDocument();
  expect(screen.queryByText(/"Reviewer"/)).not.toBeInTheDocument();
  expect(editor.state.doc.toString()).toBe(source);
});

it("folds a large tables block before syntax highlighting has reached its closing brace", () => {
  const label = 'A literal } ] { [ and \\ "';
  const source = JSON.stringify({
    tables: {
      ods_clinic_visit: { label },
      ods_clinic_diagnosis: { fields: Array.from({ length: 2500 }, () => label.repeat(3)) },
    },
  }, null, 2);
  const { container } = render(<ReadOnlyCodeView content={source} name="schema.json" />);
  const editor = EditorView.findFromDOM(container.querySelector<HTMLElement>(".cm-editor")!)!;
  const tablesLine = editor.state.doc.line(2);
  const visitLine = editor.state.doc.line(3);
  expect(syntaxTreeAvailable(editor.state)).toBe(false);
  expect(foldable(editor.state, visitLine.from, visitLine.to)).toBeTruthy();
  expect(foldable(editor.state, tablesLine.from, tablesLine.to)).toEqual({
    from: tablesLine.to,
    to: editor.state.doc.line(editor.state.doc.lines - 1).to - 1,
  });

  // jsdom has no gutter layout. Resolve the click to the tables line explicitly.
  const gutterHit = vi.spyOn(editor, "lineBlockAtHeight").mockReturnValueOnce(editor.lineBlockAt(tablesLine.from));
  fireEvent.click(screen.getAllByTitle("Fold line")[1]);
  gutterHit.mockRestore();
  expect(foldedRanges(editor.state).size).toBe(4);
  fireEvent.click(screen.getByLabelText("folded code"));
  expect(foldedRanges(editor.state).size).toBe(3);
  expect(editor.contentDOM).toHaveTextContent('"ods_clinic_visit"');
  expect(editor.contentDOM).not.toHaveTextContent('"label"');
  expect(editor.state.doc.toString()).toBe(source);
});
