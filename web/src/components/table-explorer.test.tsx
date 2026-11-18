import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
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
  it("keeps non-tabular JSON in source view", () => {
    render(<TableFileViewer name="config.json" content='{"theme":"dark"}' />);
    expect(screen.getByText('{"theme":"dark"}')).toBeVisible();
    expect(screen.queryByRole("table")).toBeNull();
  });
});
