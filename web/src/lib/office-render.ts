import DOMPurify from "dompurify";
import type { OfficeText } from "./office";
import { notebookSvgDataUrl } from "./notebook-output-sanitize";

const DOCX_PREVIEW_PADDING = 16;

/** Render into a separate, scriptless document with no network or navigation. */
export function officeHtmlDocument(html: string): string {
  const clean = DOMPurify.sanitize(html, {
    ADD_TAGS: ["style"], FORCE_BODY: true,
    FORBID_TAGS: ["script", "iframe", "object", "embed", "form", "link", "base"],
    FORBID_ATTR: ["href", "xlink:href", "srcset", "action", "formaction"],
  });
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; base-uri 'none'; form-action 'none'"><style>body{margin:0;background:#e5e7eb;color:#111827}img{max-width:100%}.docx-wrapper{padding:${DOCX_PREVIEW_PADDING}px!important}section.docx{margin:0 auto 16px!important}</style></head><body>${clean}</body></html>`;
}

type OfficePreviewResult = { html: string; layoutWidth: number } | { slides: string[] };

export async function renderOffice(model: OfficeText): Promise<OfficePreviewResult> {
  const bytes = Uint8Array.from(atob(model.data), c => c.charCodeAt(0));
  if (model.kind === "pptx") {
    const [{ loadPresentation, getSlides }, { renderSlideToSvg, defaultMeasurer }] = await Promise.all([
      import("@office-kit/pptx"), import("@office-kit/pptx-preview"),
    ]);
    const deck = await loadPresentation(bytes);
    const slides = getSlides(deck);
    // Yield between slides so navigating the rest of the app stays responsive.
    const images: string[] = [];
    for (const slide of slides) {
      images.push(notebookSvgDataUrl(renderSlideToSvg(deck, slide, { textLayout: "svg", measureText: defaultMeasurer })));
      await new Promise(resolve => setTimeout(resolve, 0));
    }
    return { slides: images };
  }
  const { renderAsync } = await import("docx-preview");
  const body = document.createElement("div"), styles = document.createElement("div");
  await renderAsync(bytes, body, styles, {
    useBase64URL: true, renderAltChunks: false, renderComments: false,
    ignoreLastRenderedPageBreak: false, breakPages: true,
  });
  const widths = [...body.querySelectorAll<HTMLElement>("section.docx")].map(p => {
    const value = parseFloat(p.style.width);
    return value * (p.style.width.endsWith("pt") ? 4 / 3 : 1);
  }).filter(Number.isFinite);
  const pageWidth = Math.max(0, ...widths) || 816;
  return {
    html: officeHtmlDocument(styles.innerHTML + body.innerHTML),
    layoutWidth: pageWidth + 2 * DOCX_PREVIEW_PADDING,
  };
}
