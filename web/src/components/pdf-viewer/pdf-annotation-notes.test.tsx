import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { fetchAnnotations, saveAnnotations, USER_AUTHOR, type FetchResult, type HighlightAnnotation, type SaveResult } from "@/lib/pdf-annotations";
import { PdfViewer } from "./pdf-viewer";

vi.mock("@/lib/pdf-annotations", async (original) => ({
  ...await original<typeof import("@/lib/pdf-annotations")>(),
  fetchAnnotations: vi.fn(),
  saveAnnotations: vi.fn(),
  subscribeAnnotations: vi.fn(() => () => {}),
}));

vi.mock("pdfjs-dist", () => ({
  GlobalWorkerOptions: {},
  getDocument: () => ({
    promise: Promise.resolve({
      numPages: 4,
      destroy() {},
      async getPage() {
        return {
          getViewport: () => ({
            width: 600, height: 800,
            convertToViewportRectangle: (rect: number[]) => rect,
            convertToPdfPoint: (x: number, y: number) => [x, y],
          }),
          getTextContent: async () => ({ items: [] }),
        };
      },
    }),
  }),
  TextLayer: class {
    async render() {}
    update() {}
    cancel() {}
  },
}));

const path = "papers/study.pdf";
const highlight: HighlightAnnotation = {
  id: "highlight-3", type: "highlight", page: 3, text: "Selected passage", note: "Review this claim.",
  rects: [{ x: 10, y: 20, w: 100, h: 12 }], color: "#fde68a",
  author: { kind: "expert", id: "reviewer", label: "Reviewer" }, createdAt: "2026-11-21T00:00:00.000Z",
};

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("No worker in the test environment")));
  vi.stubGlobal("IntersectionObserver", class {
    constructor(private callback: IntersectionObserverCallback) {}
    observe(target: Element) {
      this.callback([{ target, isIntersecting: true, intersectionRatio: 1 } as IntersectionObserverEntry], this as unknown as IntersectionObserver);
    }
    disconnect() {}
  });
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
  vi.mocked(fetchAnnotations).mockResolvedValue({ doc: { version: 1, annotations: [highlight] }, etag: null, lastModified: null });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("opens a note from the annotation popover using its original quote and saved comment", async () => {
  const onCreateNote = vi.fn();
  render(<PdfViewer path={path} onCreateNote={onCreateNote} />);
  fireEvent.click(await screen.findByTitle("Reviewer: Review this claim."));
  const comment = screen.getByDisplayValue("Review this claim.");
  fireEvent.click(within(comment.parentElement!).getByRole("button", { name: "Create note from this annotation" }));
  expect(onCreateNote).toHaveBeenCalledWith({
    title: "study.pdf · Page 3",
    anchor: { kind: "pdfAnnotation", path, annotationId: "highlight-3" },
    initialSummary: "### Highlighted text\n\nSelected passage\n\n### Annotation text\n\nReview this claim.",
  });
});

it("keeps the sidebar for navigation to the annotation", async () => {
  const scroll = vi.spyOn(Element.prototype, "scrollIntoView");
  render(<PdfViewer path={path} onCreateNote={vi.fn()} />);
  const marker = await screen.findByTitle("Reviewer: Review this claim.");
  const sidebar = within(screen.getByRole("complementary"));
  expect(sidebar.queryByRole("button", { name: "Create note from this annotation" })).not.toBeInTheDocument();
  fireEvent.click(sidebar.getByRole("button", { name: /Selected passage/ }));
  expect(scroll.mock.instances).toContain(marker.closest('[data-pdf-page="3"]'));
  expect(marker).toHaveClass("ring-primary");
});

it("disables the expert filter when the PDF has no expert annotations", async () => {
  vi.mocked(fetchAnnotations).mockResolvedValue({ doc: { version: 1, annotations: [] }, etag: null, lastModified: null });
  render(<PdfViewer path={path} />);
  const toggle = screen.getByRole("checkbox", { name: "Show expert annotations" });
  await waitFor(() => expect(toggle.closest("label")).toHaveTextContent("(0)"));
  expect(toggle).toBeDisabled();
  expect(toggle.closest("label")).toHaveAttribute("title", "No expert annotations in this PDF.");
  expect(screen.getByText(/No annotations yet/)).toBeVisible();
});

it("toggles expert marks in both the page and sidebar, including an annotation opened from a citation", async () => {
  const personal = { ...highlight, id: "personal", text: "Personal passage", note: "My comment.", author: USER_AUTHOR };
  vi.mocked(fetchAnnotations).mockResolvedValue({ doc: { version: 1, annotations: [highlight, personal] }, etag: null, lastModified: null });
  const { rerender } = render(<PdfViewer path={path} />);
  const toggle = screen.getByRole("checkbox", { name: "Show expert annotations" });
  await screen.findByTitle("Reviewer: Review this claim.");
  const sidebar = within(screen.getByRole("complementary"));
  expect(toggle).toBeChecked();
  expect(toggle.closest("label")).toHaveTextContent("(1)");
  fireEvent.click(toggle);
  expect(screen.queryByTitle("Reviewer: Review this claim.")).not.toBeInTheDocument();
  expect(sidebar.queryByText("Selected passage")).not.toBeInTheDocument();
  expect(screen.getByTitle("You: My comment.")).toBeVisible();
  expect(sidebar.getByText("Personal passage")).toBeVisible();

  rerender(<PdfViewer path={path} annotationFocus={{ path, annotationId: highlight.id, page: 3, token: 1 }} />);
  expect(toggle).toBeChecked();
  expect(await screen.findByTitle("Reviewer: Review this claim.")).toHaveClass("ring-primary");
  fireEvent.click(toggle);
  expect(toggle).not.toBeChecked();
  expect(screen.queryByTitle("Reviewer: Review this claim.")).not.toBeInTheDocument();
  fireEvent.click(toggle);
  expect(await screen.findByTitle("Reviewer: Review this claim.")).toBeVisible();
});

it("explains the empty sidebar when all annotations are hidden", async () => {
  render(<PdfViewer path={path} />);
  await screen.findByTitle("Reviewer: Review this claim.");
  fireEvent.click(screen.getByRole("checkbox", { name: "Show expert annotations" }));
  expect(within(screen.getByRole("complementary")).getByRole("status")).toHaveTextContent("Expert annotations are hidden.");
});

it("saves a new PDF annotation before opening its linked note draft", async () => {
  let finishSave!: (result: SaveResult) => void;
  vi.mocked(saveAnnotations)
    .mockResolvedValueOnce({ ok: false, conflict: false, etag: null, lastModified: null })
    .mockReturnValueOnce(new Promise((resolve) => { finishSave = resolve; }));
  const onCreateNote = vi.fn();
  render(<PdfViewer path={path} onCreateNote={onCreateNote} />);
  const marker = await screen.findByTitle("Reviewer: Review this claim.");
  fireEvent.click(screen.getByRole("button", { name: "Add note" }));
  fireEvent.click(marker.closest("[data-pdf-page]")!, { clientX: 32, clientY: 48 });
  const input = screen.getByPlaceholderText("Add a note…");
  fireEvent.change(input, { target: { value: "Verify the sample size." } });
  const create = within(input.parentElement!).getByRole("button", { name: "Create note from this annotation" });
  fireEvent.click(create);
  expect(await screen.findByRole("alert")).toHaveTextContent("Could not save the PDF annotation.");
  expect(onCreateNote).not.toHaveBeenCalled();
  expect(input).toHaveValue("Verify the sample size.");

  fireEvent.click(create);
  expect(create).toBeDisabled();
  expect(onCreateNote).not.toHaveBeenCalled();
  const annotation = vi.mocked(saveAnnotations).mock.lastCall?.[1].annotations.at(-1);
  expect(annotation).toMatchObject({ type: "note", page: 3, body: "Verify the sample size." });
  await act(async () => finishSave({ ok: true, conflict: false, etag: "saved", lastModified: null }));
  expect(onCreateNote).toHaveBeenCalledWith({
    title: "study.pdf · Page 3",
    anchor: { kind: "pdfAnnotation", path, annotationId: annotation!.id },
    initialSummary: "### Annotation text\n\nVerify the sample size.",
  });
  const pin = screen.getByTitle("You: Verify the sample size.");
  expect(pin).toHaveClass("pointer-events-auto", "size-8");
  fireEvent.click(pin);
  expect(screen.getByDisplayValue("Verify the sample size.")).toBeVisible();
});

it("scrolls to and highlights the cited annotation after its target page renders", async () => {
  const scroll = vi.spyOn(Element.prototype, "scrollIntoView");
  let loadAnnotations!: (result: FetchResult) => void;
  vi.mocked(fetchAnnotations).mockReturnValueOnce(new Promise<FetchResult>((resolve) => { loadAnnotations = resolve; }));
  render(<PdfViewer path={path} annotationFocus={{ path, annotationId: highlight.id, page: 3, token: 1 }} />);
  await waitFor(() => expect(scroll.mock.instances.some((element) =>
    element instanceof Element && element.getAttribute("data-pdf-page") === "3")).toBe(true));
  await act(async () => {
    loadAnnotations({ doc: { version: 1, annotations: [highlight] }, etag: null, lastModified: null });
  });
  const annotation = await screen.findByTitle("Reviewer: Review this claim.");
  expect(annotation.closest("[data-pdf-page]")).toHaveAttribute("data-pdf-page", "3");
  expect(annotation).toHaveClass("ring-primary");
  await waitFor(() => expect(scroll.mock.instances).toContain(annotation));
});

it("opens the recorded PDF page and reports a deleted annotation", async () => {
  vi.mocked(fetchAnnotations).mockResolvedValue({ doc: { version: 1, annotations: [] }, etag: null, lastModified: null });
  const scroll = vi.spyOn(Element.prototype, "scrollIntoView");
  const { container } = render(<PdfViewer path={path} annotationFocus={{ path, annotationId: "deleted", page: 3, token: 1 }} />);
  expect(await screen.findByText("The linked PDF annotation is unavailable.")).toBeVisible();
  await waitFor(() => expect(scroll.mock.instances).toContain(container.querySelector('[data-pdf-page="3"]')));
});
