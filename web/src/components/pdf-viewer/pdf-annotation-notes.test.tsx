import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { fetchAnnotations, type FetchResult, type HighlightAnnotation } from "@/lib/pdf-annotations";
import { PdfViewer } from "./pdf-viewer";

vi.mock("@/lib/pdf-annotations", async (original) => ({
  ...await original<typeof import("@/lib/pdf-annotations")>(),
  fetchAnnotations: vi.fn(),
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
          getViewport: () => ({ width: 600, height: 800, convertToViewportRectangle: (rect: number[]) => rect }),
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
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("opens a note from the annotation popover using its original quote and saved comment", async () => {
  const onCreateNote = vi.fn();
  render(<PdfViewer path={path} onCreateNote={onCreateNote} />);
  fireEvent.click(await screen.findByTitle("Reviewer: Review this claim."));
  fireEvent.click(screen.getByRole("button", { name: "Create note from this annotation" }));
  expect(onCreateNote).toHaveBeenCalledWith({
    title: "study.pdf · Page 3",
    anchor: { kind: "pdfAnnotation", path, annotationId: "highlight-3" },
    initialSummary: "### Highlighted text\n\nSelected passage\n\n### Annotation text\n\nReview this claim.",
  });
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
