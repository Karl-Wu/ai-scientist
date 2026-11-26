import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TableFileViewer } from "./table-explorer";
describe("table explorer views", () => {
  it("always shows pagination and lets a small file use multiple pages", () => {
    render(<TableFileViewer name="small.csv" content={'id\n' + Array.from({ length: 38 }, (_, i) => `item-${i}`).join('\n')} />);
    expect(screen.getByText("Page 1 of 1")).toBeVisible();
    expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();
    fireEvent.change(screen.getByRole("combobox", { name: "Rows per page" }), { target: { value: "25" } });
    expect(within(screen.getByRole("table")).getAllByRole("row")).toHaveLength(26);
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByText("Page 2 of 2")).toBeVisible();
    expect(screen.getByText("item-37")).toBeVisible();
    expect(screen.queryByText("item-0")).toBeNull();
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "item-0" } });
    expect(screen.getByText("Page 1 of 1")).toBeVisible();
    expect(screen.getByText("item-0")).toBeVisible();
  });
  it("switches between data, profiles, filtered distributions and original source", () => {
    render(<TableFileViewer name="sample.json" content='[{"id":"001","value":10},{"id":"002","value":2},{"id":"003","value":null}]' />);
    expect(screen.getByText("001")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "value" }));
    expect(within(screen.getByRole("table")).getAllByRole("row")[1]).toHaveTextContent("002");
    fireEvent.click(screen.getByRole("button", { name: "Schema" }));
    expect(screen.getByText("Inferred type")).toBeVisible();
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "002" } });
    fireEvent.click(screen.getByRole("button", { name: "Distribution" }));
    fireEvent.change(screen.getByLabelText("Distribution column"), { target: { value: "1" } });
    expect(screen.getByRole("img", { name: "Histogram" })).toBeVisible();
    expect(screen.getByText("1 matching rows")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Source" }));
    expect(screen.getByText(/"id":"001"/)).toBeVisible();
  });
  it.each(['{"theme":"dark"}', '{"nested":{"counts":[1,2]}}', '[1,2,3]', '[{"id":1},null]', '{"unfinished":', 'null'])("keeps non-tabular or invalid JSON in source view without table chrome: %s", (content) => {
    render(<TableFileViewer name="config.json" content={content} />);
    expect(screen.getByText(content)).toBeVisible();
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.queryByText("Table explorer")).toBeNull();
    expect(screen.queryByRole("button", { name: "Source" })).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });
  it("uses the supplied source viewer directly for ordinary JSON", () => {
    render(<TableFileViewer name="qc.json" content='{"count":38}' sourceView={<div>Source editor</div>} />);
    expect(screen.getByText("Source editor")).toBeVisible();
    expect(screen.queryByText("Table explorer")).toBeNull();
  });
});

describe("inline table editing", () => {
  it("edits a source row past 5,000 in place and preserves the filtered, sorted page after save", async () => {
    const records = Array.from({ length: 5_025 }, (_, i) => "sample-" + String(i + 1).padStart(5, "0") + ",original,001");
    const original = "\uFEFFid,value,code\r\n" + records.join("\r\n") + "\r\n";
    const saved = original.replace(records[5000], 'sample-05001,"checked, ""yes""",001');
    const onSave = vi.fn(async () => "saved" as const);
    const onDirtyChange = vi.fn();
    const editing = { revision: "original", onSave, onDirtyChange };
    const { rerender } = render(<TableFileViewer content={original} name="large.csv" editing={editing} />);
    expect(screen.getByRole("button", { name: "Save changes" })).toBeDisabled();
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "sample-050" } });
    fireEvent.click(screen.getByRole("button", { name: "id" }));
    fireEvent.click(screen.getByRole("button", { name: "id ↑" }));
    fireEvent.change(screen.getByRole("combobox", { name: "Rows per page" }), { target: { value: "10" } });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByText("Page 3 of 3")).toBeVisible();
    const cell = screen.getByRole("button", { name: "Row 5001, column value" });
    fireEvent.click(cell);
    expect(screen.queryByRole("textbox", { name: "Row 5001, column value" })).toBeNull();
    fireEvent.doubleClick(cell);
    fireEvent.change(screen.getByRole("textbox", { name: "Row 5001, column value" }), { target: { value: 'checked, "yes"' } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith(saved, "original"));
    await waitFor(() => expect(screen.getByRole("button", { name: "Save changes" })).toBeDisabled());
    rerender(<TableFileViewer content={saved} name="large.csv" editing={{ ...editing, revision: "saved" }} />);
    expect(screen.getByRole("searchbox")).toHaveValue("sample-050");
    expect(screen.getByRole("columnheader", { name: "id ↓" })).toHaveAttribute("aria-sort", "descending");
    expect(screen.getByRole("combobox", { name: "Rows per page" })).toHaveValue("10");
    expect(screen.getByText("Page 3 of 3")).toBeVisible();
    expect(screen.getByRole("button", { name: "Row 5001, column value" })).toHaveTextContent('checked, "yes"');
    expect(onDirtyChange).toHaveBeenLastCalledWith(false);
  });

  it("preserves TSV formatting and keeps an inline draft when a newer file is loaded", async () => {
    const original = '\uFEFFid\tcomment\tcode\r\n"001"\t"before\r\noriginal"\t0002\r\n\r\n002\r\n';
    const onSave = vi.fn(async () => "conflict" as const);
    const editing = { revision: "original", onSave, onDirtyChange: vi.fn() };
    const { rerender } = render(<TableFileViewer content={original} name="data.tsv" editing={editing} />);
    fireEvent.doubleClick(screen.getByRole("button", { name: "Row 2, column code" }));
    const editor = screen.getByRole("textbox", { name: "Row 2, column code" });
    fireEvent.change(editor, { target: { value: "tab\tinside\nline" } });
    fireEvent.keyDown(editor, { key: "Enter" });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("The file changed on disk.");
    expect(onSave).toHaveBeenCalledWith(original.replace("\r\n002\r\n", '\r\n002\t\t"tab\tinside\nline"\r\n'), "original");
    rerender(<TableFileViewer content={"id\tcomment\tcode\n002\t\tnew version\n"} name="data.tsv" editing={{ ...editing, revision: "new" }} />);
    expect(screen.getByRole("button", { name: "Row 2, column code" })).toHaveAttribute("title", "tab\tinside\nline");
    fireEvent.click(screen.getByRole("button", { name: "Discard changes" }));
    expect(screen.getByRole("button", { name: "Row 1, column code" })).toHaveTextContent("new version");
  });
});
