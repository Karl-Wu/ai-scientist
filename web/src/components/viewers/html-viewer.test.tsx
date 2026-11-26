import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { apiFetch } from "@/lib/projects";
import HtmlViewer from "./html-viewer";

vi.mock("@/lib/projects", () => ({ apiFetch: vi.fn() }));

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
  expect(inner?.getAttribute("srcdoc")).toMatch(/^<!doctype html><script>[\s\S]*<\/script><style>p\{color:red\}/);
  expect(wrapper.querySelector("script")).toBeNull();
  const policy = wrapper.querySelector('meta[http-equiv="Content-Security-Policy"]')?.getAttribute("content");
  expect(policy).toContain("script-src 'unsafe-inline'");
  expect(policy).toContain("connect-src 'none'");
  expect(policy).toContain("frame-src 'none'");
});

it("lets an isolated report handle fragment links to a hidden section", async () => {
  const reportBody = `<a href="#rules"><strong>Rule</strong></a>
    <section id="rules" hidden>Rule details</section>`;
  const report = `<!doctype html><html lang="en"><head data-label="a > b">
    <meta http-equiv="Content-Security-Policy" content="script-src 'none'">
    </head><body>${reportBody}</body></html>`;
  render(<HtmlViewer {...props} content={report} />);
  const parser = new DOMParser();
  const wrapper = parser.parseFromString(screen.getByTitle("HTML preview").getAttribute("srcdoc")!, "text/html");
  const source = wrapper.querySelector("iframe")!.getAttribute("srcdoc")!;
  const head = parser.parseFromString(source, "text/html").head;
  expect(head.getAttribute("data-label")).toBe("a > b");
  expect([...head.children].map((element) => element.localName)).toEqual(["script", "meta"]);
  expect(head.querySelector("meta")?.getAttribute("content")).toBe("script-src 'none'");
  const script = head.querySelector("script")!.textContent!;
  const frame = document.body.appendChild(document.createElement("iframe"));
  try {
    const reportWindow = frame.contentWindow as Window & typeof globalThis;
    const reportDocument = frame.contentDocument!;
    reportDocument.body.innerHTML = reportBody;
    const section = reportDocument.querySelector<HTMLElement>("#rules")!;
    reportWindow.addEventListener("hashchange", () => {
      if (reportWindow.location.hash === "#rules") section.hidden = false;
    });
    new Function("window", "location", "Element", script)(reportWindow, reportWindow.location, reportWindow.Element);
    const click = new MouseEvent("click", { bubbles: true, cancelable: true });
    reportDocument.querySelector("strong")!.dispatchEvent(click);
    expect(click.defaultPrevented).toBe(true);
    expect(reportWindow.location.hash).toBe("#rules");
    await vi.waitFor(() => expect(section.hidden).toBe(false));
  } finally {
    frame.remove();
  }
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

it("navigates project pages, reloads from disk, and discards forward history after branching", async () => {
  vi.mocked(apiFetch).mockImplementation(async () => new Response("<p>Updated report</p>"));
  render(<HtmlViewer {...props} path="reports/index.html" projectId="lineage" />);
  const address = screen.getByRole("textbox", { name: "Project HTML address" });
  function go(value: string) {
    fireEvent.change(address, { target: { value } });
    fireEvent.submit(address.closest("form")!);
  }
  const back = screen.getByRole("button", { name: "Back" });
  const forward = screen.getByRole("button", { name: "Forward" });
  expect(back).toBeDisabled();
  go("details.html#table");
  await vi.waitFor(() => expect(address).toHaveValue("/reports/details.html#table"));
  expect(apiFetch).toHaveBeenCalledWith("/sandbox/file?path=reports%2Fdetails.html", expect.anything(), "lineage");
  fireEvent.click(back);
  await vi.waitFor(() => expect(address).toHaveValue("/reports/index.html"));
  fireEvent.click(forward);
  await vi.waitFor(() => expect(address).toHaveValue("/reports/details.html#table"));
  const frame = screen.getByTitle("HTML preview");
  fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
  await vi.waitFor(() => expect(screen.getByTitle("HTML preview")).not.toBe(frame));
  fireEvent.click(back);
  await vi.waitFor(() => expect(address).toHaveValue("/reports/index.html"));
  go("#summary");
  expect(address).toHaveValue("/reports/index.html#summary");
  expect(forward).toBeDisabled();
  const calls = vi.mocked(apiFetch).mock.calls.length;
  go("https://example.org/report.html");
  expect(screen.getByRole("alert")).toHaveTextContent("Enter a project HTML file path.");
  expect(apiFetch).toHaveBeenCalledTimes(calls);
});
