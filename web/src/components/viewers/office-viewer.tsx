"use client";
import { lazy, Suspense, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { apiFetch, getActiveProjectId } from "@/lib/projects";
import { renderOffice } from "@/lib/office-render";
import type { OfficeText } from "@/lib/office";
import type { ViewerProps } from "@/lib/viewers/registry";
import { useT } from "@/components/i18n-provider";
import { PreviewZoomControls } from "@/components/preview-zoom-controls";
import { ScaledPreviewFrame } from "@/components/scaled-preview-frame";
import { usePreviewZoom } from "@/components/use-preview-zoom";
import { ExternalLinkIcon, RefreshCwIcon } from "lucide-react";
const XlsxTableViewer = lazy(() => import("./xlsx-table-viewer"));
const button = "rounded border px-2.5 py-1 text-xs hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed";

export default function OfficeViewer({ path, name, projectId = getActiveProjectId(), onDirtyChange, onSavingChange }: ViewerProps) {
  const t = useT();
  const [model, setModel] = useState<OfficeText | null>(null);
  const [error, setError] = useState("");
  const [generation, setGeneration] = useState(0);
  const spreadsheet = /\.xlsx$/i.test(path);
  const reload = useCallback(() => setGeneration(n => n + 1), []);
  useEffect(() => {
    const changed = (e: StorageEvent) => {
      if (e.key !== "kady:office-saved" || !e.newValue) return;
      try { const data = JSON.parse(e.newValue); if (data.projectId === projectId && data.path === path) reload(); } catch {}
    };
    window.addEventListener("storage", changed); return () => window.removeEventListener("storage", changed);
  }, [path, projectId, reload]);
  useEffect(() => {
    if (spreadsheet) return;
    const cancel = new AbortController(); setError(""); setModel(null);
    void apiFetch(`/sandbox/office?path=${encodeURIComponent(path)}`, { signal: cancel.signal }, projectId).then(async res => {
      const data = await res.json(); if (!res.ok) throw new Error(data.detail || "Could not preview document");
      if (!cancel.signal.aborted) setModel(data);
    }).catch(e => { if (!cancel.signal.aborted) setError(String(e.message)); });
    return () => cancel.abort();
  }, [path, projectId, generation, spreadsheet]);
  const url = `/office?${new URLSearchParams({ path, project: projectId })}`;
  const officeLink = <a href={url} target="_blank" rel="noopener noreferrer" className="flex h-7 shrink-0 items-center gap-1.5 rounded-md border px-2.5 text-xs font-medium hover:bg-muted">{t("Edit in Office")} <ExternalLinkIcon className="size-3" /></a>;
  if (spreadsheet) return <Suspense fallback={<p role="status" className="p-4 text-xs">{t("Loading workbook…")}</p>}>
    <XlsxTableViewer key={projectId + ":" + path} path={path} name={name} projectId={projectId} content={null}
      generation={generation} officeLink={officeLink} onDirtyChange={onDirtyChange} onSavingChange={onSavingChange} />
  </Suspense>;
  const renderToolbar = (controls?: ReactNode) => (
    <div role="group" aria-label={t("Document preview")} className="flex shrink-0 flex-wrap items-center gap-x-2 gap-y-1 border-b px-3 py-2">
      {controls ?? <span className="text-xs text-muted-foreground">{t("Document preview")}</span>}
      <div className="ml-auto flex shrink-0 items-center gap-2">
        <button className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted" onClick={reload} aria-label={t("Refresh Office preview")} title={t("Refresh Office preview")}><RefreshCwIcon className="size-3.5" /></button>
        {officeLink}
      </div>
    </div>
  );
  return <div className="flex h-full min-h-0 flex-col">
    {model ? <OfficePreview model={model} renderToolbar={renderToolbar} /> : <>
      {renderToolbar()}
      {error
        ? <div role="alert" className="p-4 text-sm text-destructive">{error} <button className={button} onClick={reload}>Retry</button></div>
        : <p className="p-4 text-xs text-muted-foreground">Loading document…</p>}
    </>}
  </div>;
}

function OfficePreview({ model, renderToolbar }: { model: OfficeText; renderToolbar: (controls?: ReactNode) => ReactNode }) {
  const [preview, setPreview] = useState<Awaited<ReturnType<typeof renderOffice>> | null>(null);
  const [error, setError] = useState("");
  const [slide, setSlide] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setPreview(null); setError(""); setSlide(0);
    void renderOffice(model).then(result => { if (!cancelled) setPreview(result); }, e => { if (!cancelled) setError(String(e)); });
    return () => { cancelled = true; };
  }, [model]);
  if (error) return <>{renderToolbar()}<div className="overflow-auto p-4"><p role="alert" className="mb-3 text-xs text-destructive">Visual preview unavailable: {error}. Text contents are shown below.</p>{model.groups.map((g, i) => <section key={i}><h3 className="font-medium">{g.label}</h3>{g.paragraphs.map((p, j) => <p className="my-2 whitespace-pre-wrap" key={j}>{p.runs.map(r => r.text).join("")}</p>)}</section>)}</div></>;
  if (!preview) return <>{renderToolbar()}<div className="p-4 text-xs text-muted-foreground" role="status">Rendering preview…</div></>;
  if ("html" in preview) return <DocxPreview html={preview.html} layoutWidth={preview.layoutWidth} renderToolbar={renderToolbar} />;
  const slides = preview.slides;
  return <>
    {renderToolbar()}
    <div className="flex items-center justify-center gap-3 border-b p-2">
      <button className={button} disabled={slide === 0} onClick={() => setSlide(i => i - 1)}>Previous slide</button>
      <span className="text-xs">Slide {slides.length ? slide + 1 : 0} of {slides.length}</span>
      <button className={button} disabled={slide >= slides.length - 1} onClick={() => setSlide(i => i + 1)}>Next slide</button>
    </div>
    <div className="flex min-h-0 flex-1 items-start justify-center overflow-auto bg-muted/30 p-3">{slides[slide] && <img src={slides[slide]} alt={`Slide ${slide + 1}`} className="w-full bg-white shadow" />}</div>
  </>;
}

function DocxPreview({ html, layoutWidth, renderToolbar }: {
  html: string;
  layoutWidth: number;
  renderToolbar: (controls?: ReactNode) => ReactNode;
}) {
  const t = useT();
  const host = useRef<HTMLDivElement>(null);
  // The page and its surrounding padding scale together inside the iframe.
  const { zoom, setZoom, fitWidth, fitToWidth } = usePreviewZoom(host, layoutWidth, true, 0);

  return <>
    {renderToolbar(<PreviewZoomControls zoom={zoom} setZoom={setZoom} fitWidth={fitWidth} onFitWidth={fitToWidth} />)}
    <div ref={host} className="min-h-0 flex-1">
      <ScaledPreviewFrame title={t("Word document preview")} sandbox="" srcDoc={html} zoom={zoom} />
    </div>
  </>;
}
