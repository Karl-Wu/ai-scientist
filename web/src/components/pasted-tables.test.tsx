import { fireEvent, render, screen, within } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { PastedTables } from "./pasted-tables";
import type { PastedTable } from "@/lib/clipboard-table";

it("previews a bounded sample, changes header interpretation and removes a draft", () => {
  const tables: PastedTable[] = [{ id: "fixture", rows: [["编号", "备注"], ...Array.from({ length: 60 }, (_, i) => [`00${i}`, i === 0 ? "多行\n内容" : "原文"])], firstRowHeader: true, uploadedPath: "old.csv" }];
  const onChange = vi.fn();
  render(<PastedTables tables={tables} onChange={onChange} />);
  fireEvent.click(screen.getByRole("button", { name: /Pasted table.*60 data rows/ }));
  const dialog = screen.getByRole("dialog");
  expect(within(dialog).getByRole("columnheader", { name: "编号" })).toBeInTheDocument();
  expect(within(dialog).getAllByRole("row")).toHaveLength(51);
  expect(within(dialog).getByText(/All 60 data rows/)).toBeInTheDocument();
  expect(within(dialog).getByText(/多行/)).toHaveTextContent("多行 内容");
  fireEvent.click(within(dialog).getByRole("checkbox", { name: "Use first row as column names" }));
  expect(onChange).toHaveBeenLastCalledWith([{ ...tables[0], firstRowHeader: false, uploadedPath: undefined }]);
  fireEvent.click(within(dialog).getAllByRole("button", { name: "Close" }).at(-1)!);
  fireEvent.click(screen.getByRole("button", { name: "Remove pasted table" }));
  expect(onChange).toHaveBeenLastCalledWith([]);
});
