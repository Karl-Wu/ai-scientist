import { useCallback, useEffect, useState, type RefObject } from "react";
import { MAX_PREVIEW_ZOOM, MIN_PREVIEW_ZOOM } from "./preview-zoom-controls";

/** Fit stays responsive to pane resizing; a manual zoom explicitly leaves it. */
export function usePreviewZoom(container: RefObject<HTMLDivElement | null>, pageWidth: number, initialFitWidth: boolean, gutter = 24) {
  const [manualZoom, setManualZoom] = useState(1);
  const [fitWidth, setFitWidth] = useState(initialFitWidth);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = container.current;
    if (!el) return;
    const measure = () => {
      // Source-only mode hides the pane. Retain its scale until visible again.
      if (el.clientWidth > 0) setWidth(el.clientWidth);
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [container]);
  const zoom = fitWidth && width > 0 && pageWidth > 0
    ? Math.max(MIN_PREVIEW_ZOOM, Math.min(MAX_PREVIEW_ZOOM, (width - gutter) / pageWidth))
    : manualZoom;
  const setZoom = useCallback((value: number) => {
    setFitWidth(false);
    setManualZoom(value);
  }, []);
  return { zoom, setZoom, fitWidth, fitToWidth: () => setFitWidth(true) };
}
