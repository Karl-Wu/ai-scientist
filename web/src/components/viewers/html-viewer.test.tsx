import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import HtmlViewer from "./html-viewer";

vi.mock("@/components/code-views", () => ({
  ReadOnlyCodeView: ({ content, revealLine }: { content: string; revealLine?: number }) =>
    <pre data-line={revealLine}>{content}</pre>,
}));

const content = '<!doctype html><style>p{color:red}</style><p>&quot;Report&quot;</p><script>window.label = \'"><p>\';</script>';
const props = { content, path: "report.html", name: "report.html" };

it("gives the report its own script-enabled frame under an isolated policy", () => {
  render(<HtmlViewer {...props} />);
  const outer = screen.getByTitle("HTML preview");
  expect(outer).toHaveAttribute("sandbox", "allow-scripts");
  const wrapper = new DOMParser().parseFromString(outer.getAttribute("srcdoc")!, "text/html");
  const inner = wrapper.querySelector("iframe");
  expect(inner?.getAttribute("sandbox")).toBe("allow-scripts");
  expect(inner?.getAttribute("srcdoc")).toBe(content);
  expect(wrapper.querySelector("script")).toBeNull();
  const policy = wrapper.querySelector('meta[http-equiv="Content-Security-Policy"]')?.getAttribute("content");
  expect(policy).toContain("script-src 'unsafe-inline'");
  expect(policy).toContain("connect-src 'none'");
  expect(policy).toContain("frame-src 'none'");
});

it("keeps source access and switches to source when a file line is revealed", () => {
  const { rerender } = render(<HtmlViewer {...props} />);
  fireEvent.click(screen.getByRole("button", { name: "Source" }));
  expect(screen.queryByTitle("HTML preview")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Preview" }));
  expect(screen.getByTitle("HTML preview")).toBeVisible();

  rerender(<HtmlViewer {...props} revealLine={12} revealToken={1} />);
  expect(screen.queryByTitle("HTML preview")).toBeNull();
  expect(screen.getByText(content, { normalizer: (text) => text })).toHaveAttribute("data-line", "12");
});

it("changes scale without replacing the interactive document and links to its standalone preview", () => {
  render(<HtmlViewer {...props} path="reports/source & target.html" projectId="lineage" />);
  const frame = screen.getByTitle("HTML preview");
  const document = frame.getAttribute("srcdoc");
  fireEvent.click(screen.getByRole("button", { name: "Zoom in" }));
  expect(screen.getByText("110%")).toBeVisible();
  expect(screen.getByTitle("HTML preview")).toBe(frame);
  expect(frame).toHaveAttribute("srcdoc", document);
  expect(frame).toHaveStyle({ transform: "scale(1.1)" });
  fireEvent.click(screen.getByRole("button", { name: "Zoom out" }));
  expect(screen.getByText("100%")).toBeVisible();
  expect(screen.getByRole("link", { name: "Open in external browser" })).toHaveAttribute(
    "href", "/html-preview?path=reports%2Fsource+%26+target.html&project=lineage",
  );
});
