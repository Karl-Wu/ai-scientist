import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import OfficeViewer from "./office-viewer";
vi.mock("@/lib/office-render", () => ({ renderOffice: vi.fn(async () => ({ html: "<p>Rendered document</p>" })) }));
vi.mock("./arraydata-viewer", () => ({ default: ({ toolbarActions }: { toolbarActions?: import("react").ReactNode }) => <div>{toolbarActions}Workbook data preview</div> }));
const original = { kind: "docx", revision: "a".repeat(64), readOnly: false, data: "", groups: [] };
let fetcher: ReturnType<typeof vi.fn>;
const props = { path: "report.docx", name: "report.docx", projectId: "office-tests", content: null };
beforeEach(() => { fetcher = vi.fn(async () => new Response(JSON.stringify(original))); vi.stubGlobal("fetch", fetcher); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
it("opens the isolated full editor with the file's project and path", async () => {
  render(<OfficeViewer {...props} />); await screen.findByTitle("Word document preview");
  expect(screen.getByRole("link", { name: /Edit in Office/ })).toHaveAttribute("href", "/office?path=report.docx&project=office-tests");
  expect(new Headers(fetcher.mock.calls[0][1].headers).get("X-Project-Id")).toBe("office-tests");
});
it("refreshes after a matching save from the editor window", async () => {
  render(<OfficeViewer {...props} />); await screen.findByTitle("Word document preview");
  fireEvent(window, new StorageEvent("storage", { key: "kady:office-saved", newValue: JSON.stringify({ projectId: "another", path: props.path }) }));
  expect(fetcher).toHaveBeenCalledTimes(1);
  fireEvent(window, new StorageEvent("storage", { key: "kady:office-saved", newValue: JSON.stringify({ projectId: props.projectId, path: props.path }) }));
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
});
it("keeps the read-only spreadsheet preview available when inline loading is unsupported", async () => {
  fetcher.mockResolvedValueOnce(new Response(JSON.stringify({ detail: "Unsupported" }), { status: 422 }));
  render(<OfficeViewer {...props} path="book.xlsx" name="book.xlsx" />);
  await screen.findByText("Workbook data preview");
  expect(screen.getByRole("link", { name: /Edit in Office/ })).toHaveAttribute("href", "/office?path=book.xlsx&project=office-tests");
  expect(screen.queryByRole("button", { name: "Save changes" })).toBeNull();
});

it("uses workbook coordinates after filtering and sorting the selected sheet", async () => {
  const revision = "b".repeat(64);
  const summary = {
    format: "xlsx", kind: "table", file_size: 200, num_rows: 3, num_columns: 3,
    columns: ["label", "rank", "formula"].map(name => ({ name, dtype: "cell" })),
    head: [["trial A", 10, null], ["other B", 100, null], ["trial C", 30, 60]],
    collections: ["Primary", "Comparison"], protectedCells: ["C4"], protectedRanges: [],
    readOnly: false, revision,
  };
  fetcher.mockImplementation(async (input: string, init?: RequestInit) => {
    if (init?.method === "PATCH") {
      return new Response(JSON.stringify({
        revision: "c".repeat(64), table: { ...summary, selected: "Comparison", head: [...summary.head.slice(0, 2), ["trial C", 35, 60]] },
      }));
    }
    return new Response(JSON.stringify({ ...summary, selected: input.includes("sheet=Comparison") ? "Comparison" : "Primary" }));
  });
  render(<OfficeViewer {...props} path="book.xlsx" name="book.xlsx" />);
  const sheet = await screen.findByRole("combobox", { name: "Sheet" });
  fireEvent.change(sheet, { target: { value: "Comparison" } });
  await waitFor(() => expect(sheet).toBeEnabled());
  expect(screen.queryByRole("button", { name: "Cell C4" })).toBeNull();
  fireEvent.change(screen.getByRole("searchbox"), { target: { value: "trial" } });
  fireEvent.click(screen.getByRole("button", { name: "rank" }));
  fireEvent.click(screen.getByRole("button", { name: "rank ↑" }));
  fireEvent.doubleClick(screen.getByRole("button", { name: "Cell B4" }));
  fireEvent.change(screen.getByRole("textbox", { name: "Cell B4" }), { target: { value: "35" } });
  expect(sheet).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "Cell B4" })).toHaveTextContent("35"));
  const [, request] = fetcher.mock.calls.find(([, init]) => init?.method === "PATCH")!;
  expect(JSON.parse(request.body)).toEqual({ sheet: "Comparison", changes: [{ ref: "B4", value: "35" }] });
  expect(new Headers(request.headers).get("If-Match")).toBe(revision);
  expect(screen.getByRole("searchbox")).toHaveValue("trial");
  expect(screen.getByRole("columnheader", { name: "rank ↓" })).toHaveAttribute("aria-sort", "descending");
  expect(sheet).toHaveValue("Comparison");
});
