import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { TableFileViewer } from "./table-explorer";
describe("distribution types", () => {
  it("lets numeric codes be displayed as categories without changing their inferred type", () => {
    render(<TableFileViewer name="codes.csv" content={'status\n0\n1\n1'} />);
    fireEvent.click(screen.getByRole("button", { name: "Distribution" }));
    expect(screen.getByRole("img", { name: "Histogram" })).toBeVisible();
    fireEvent.change(screen.getByLabelText("Display as"), { target: { value: "category" } });
    expect(screen.getByRole("img", { name: "Value frequency" })).toHaveTextContent("2 · 66.7%");
    fireEvent.click(screen.getByRole("button", { name: "Schema" }));
    expect(screen.getByText("Number")).toBeVisible();
  });
  it("shows categorical and boolean counts, missingness and filtered denominators", () => {
    render(<TableFileViewer name="values.json" content='[{"group":"A","flag":true},{"group":"A","flag":false},{"group":"B","flag":null},{"group":null,"flag":true}]' />);
    fireEvent.click(screen.getByRole("button", { name: "Distribution" }));
    expect(within(screen.getByRole("img", { name: "Value frequency" })).getByText("2 · 50.0%")).toBeVisible();
    expect(screen.getByText("Missing values").parentElement).toHaveTextContent("1 · 25.0%");
    fireEvent.change(screen.getByLabelText("Distribution column"), { target: { value: "1" } });
    expect(screen.getByText("Boolean")).toBeVisible();
    expect(within(screen.getByRole("img", { name: "Value frequency" })).getByText("false")).toBeVisible();
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "A" } });
    expect(screen.getByText("Missing values").parentElement).toHaveTextContent("0 · 0.0%");
    expect(screen.getByText("Matching rows").parentElement).toHaveTextContent("2");
  });
  it("offers date grouping controls and handles empty matches", () => {
    render(<TableFileViewer name="dates.csv" content={'date\n2024-01-01\n2024-01-02\n2025-02-01'} />);
    fireEvent.click(screen.getByRole("button", { name: "Distribution" }));
    expect(screen.getByRole("img", { name: "Date distribution" })).toHaveTextContent("2024-01");
    fireEvent.change(screen.getByLabelText("Group dates by"), { target: { value: "year" } });
    expect(screen.getByRole("img", { name: "Date distribution" })).toHaveTextContent("2025");
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "nothing" } });
    expect(screen.getByText("No values available for this selection.")).toBeVisible();
    expect(screen.getByText("Missing values").parentElement).toHaveTextContent("0 · 0.0%");
  });
});
