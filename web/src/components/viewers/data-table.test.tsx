import { describe, it, expect } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import DataTable, { numericCell, type TableSummary } from "./data-table";
const summary: TableSummary = { format: "parquet", kind: "table", file_size: 100, num_rows: null, num_columns: 3,
  columns: [{ name: "Name", dtype: "VARCHAR" }, { name: "Time", dtype: "DOUBLE" }, { name: "Value", dtype: "DOUBLE" }],
  head: [["B", 10, 9], ["A", 2, 3], ["C", null, 5], ["D", "", false]], rows_truncated: true };
describe("binary table explorer adapter", () => {
  it("sorts and searches the explicitly labeled sample", () => {
    render(<DataTable summary={summary} />);
    expect(screen.getByText(/Total rows not scanned/)).toBeVisible();
    expect(screen.getByText(/Search, statistics and export use only this preview/)).toBeVisible();
    expect(screen.queryByRole("button", { name: "Copy original" })).toBeNull();
    expect(screen.getByRole("button", { name: "Export filtered preview" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Time" }));
    expect(within(screen.getByRole("table")).getAllByRole("row")[1]).toHaveTextContent("A");
    fireEvent.change(screen.getByLabelText("Search preview rows"), { target: { value: "B" } });
    expect(screen.getAllByRole("row")).toHaveLength(2);
  });
  it("keeps native source types and labels schema statistics as a preview", () => {
    render(<DataTable summary={{ ...summary, num_rows: 1000, cell_limit: 512 }} />);
    expect(screen.getByText(/Source: 1,000 rows/)).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Schema" }));
    expect(screen.getByText("Source type")).toBeVisible();
    expect(screen.getByText("VARCHAR")).toBeVisible();
    expect(screen.getByText(/Schema statistics use preview rows only/)).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Distribution" }));
    fireEvent.change(screen.getByLabelText("Distribution column"), { target: { value: "1" } });
    expect(screen.getByRole("img", { name: "Histogram" })).toBeVisible();
  });
  it("does not mistake nulls, booleans, or nonfinite values for measurements", () => {
    for (const value of [null, undefined, "", " ", false, "NaN", "Infinity", "0x10", "9007199254740993"]) expect(numericCell(value)).toBeNull();
    expect(numericCell("-1.25e-3")).toBe(-0.00125);
    expect(numericCell(0)).toBe(0);
  });
});
