"use client";

import { MinusIcon, PlusIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useT } from "@/components/i18n-provider";

export const MIN_PREVIEW_ZOOM = 0.1;
export const MAX_PREVIEW_ZOOM = 4;

export function PreviewZoomControls({ zoom, setZoom, fitWidth, onFitWidth }: {
  zoom: number;
  setZoom: (zoom: number) => void;
  fitWidth?: boolean;
  onFitWidth?: () => void;
}) {
  const t = useT();
  const step = (change: number) =>
    setZoom(Math.max(MIN_PREVIEW_ZOOM, Math.min(MAX_PREVIEW_ZOOM, Number((zoom + change).toFixed(2)))));
  return <div role="group" aria-label={t("Preview zoom")} className="flex shrink-0 items-center gap-0.5">
    <Button type="button" variant="ghost" size="icon-xs" title={t("Zoom out")} aria-label={t("Zoom out")}
      disabled={zoom <= MIN_PREVIEW_ZOOM} onClick={() => step(-0.1)}>
      <MinusIcon aria-hidden />
    </Button>
    <Button type="button" variant="ghost" size="xs" className="min-w-11 tabular-nums"
      title={t("Reset zoom to 100%")} aria-label={t("Reset zoom to 100%")} onClick={() => setZoom(1)}>
      <span aria-live="polite">{Math.round(zoom * 100)}%</span>
    </Button>
    <Button type="button" variant="ghost" size="icon-xs" title={t("Zoom in")} aria-label={t("Zoom in")}
      disabled={zoom >= MAX_PREVIEW_ZOOM} onClick={() => step(0.1)}>
      <PlusIcon aria-hidden />
    </Button>
    {onFitWidth && <Button type="button" variant={fitWidth ? "secondary" : "ghost"} size="xs"
      aria-pressed={fitWidth} onClick={onFitWidth}>{t("Fit width")}</Button>}
  </div>;
}
