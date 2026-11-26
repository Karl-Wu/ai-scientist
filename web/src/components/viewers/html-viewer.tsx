"use client";

import { useEffect, useMemo, useState, type MouseEvent } from "react";
import { ArrowLeft, ArrowRight, CodeXml, Eye, ExternalLinkIcon, RotateCw } from "lucide-react";
import { ReadOnlyCodeView } from "@/components/code-views";
import { useT } from "@/components/i18n-provider";
import { Button } from "@/components/ui/button";
import { PreviewZoomControls } from "@/components/preview-zoom-controls";
import { ScaledPreviewFrame } from "@/components/scaled-preview-frame";
import { htmlPreviewDocument, htmlPreviewPath } from "@/lib/html-preview";
import { apiFetch } from "@/lib/projects";
import type { ViewerProps } from "@/lib/viewers/registry";

import { useReportNavigation } from "./use-report-navigation";

export default function HtmlViewer(props: ViewerProps) {
  return <ReportBrowser key={JSON.stringify([props.projectId, props.path])} {...props} />;
}

function ReportBrowser({
  content, name, path, projectId, revealLine, revealToken, renderFileActions,
}: ViewerProps) {
  const t = useT();
  const [view, setView] = useState<"preview" | "source">(revealLine ? "source" : "preview");
  const [zoom, setZoom] = useState(1);
  const [opening, setOpening] = useState(false);
  const [openFailed, setOpenFailed] = useState(false);
  useEffect(() => {
    if (revealLine) setView("source");
  }, [revealLine, revealToken]);
  const nav = useReportNavigation(path, projectId, content);
  const body = nav.document.revision === 0 ? content : nav.document.body;
  const title = t("HTML preview");
  const previewDocument = useMemo(() => view === "preview" && body !== null
    ? htmlPreviewDocument(body, title, true)
    : undefined, [body, title, view]);
  if (content === null) return null;

  async function openExternal(event: MouseEvent<HTMLAnchorElement>) {
    // A remote client can open a new tab itself, but must not open apps on the host.
    const local = /^(?:localhost|.*\.localhost|127(?:\.\d{1,3}){3}|\[::1\])$/i.test(window.location.hostname);
    if (!local || openFailed || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    if (opening) return;
    setOpening(true);
    try {
      const response = await apiFetch("/sandbox/html-preview/open", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: nav.document.path }),
      }, projectId);
      if (!response.ok) setOpenFailed(true);
    } catch {
      setOpenFailed(true);
    } finally {
      setOpening(false);
    }
  }

  return <div className="flex h-full min-h-0 flex-col">
    <div role="group" aria-label={title} className="flex shrink-0 flex-wrap items-center gap-1 border-b px-2 py-1.5">
      <form className="flex min-w-0 basis-44 grow items-center gap-1"
        onSubmit={event => { event.preventDefault(); void nav.navigate(nav.address); }}>
        <div className="flex shrink-0 items-center rounded-full border px-1">
          {([{ label: "Back", Icon: ArrowLeft, delta: -1 }, { label: "Forward", Icon: ArrowRight, delta: 1 }]).map(({ label, Icon, delta }) => {
            const index = nav.history.index + delta;
            return <Button key={label} size="icon-xs" variant="ghost" type="button"
              aria-label={t(label)} title={t(label)} disabled={index < 0 || index >= nav.history.entries.length}
              onClick={() => void nav.navigate(nav.history.entries[index], index)}><Icon /></Button>;
          })}
          <span className="mx-1 h-3 border-l" />
          <Button size="icon-xs" variant="ghost" type="button" title={t("Refresh")} aria-label={t("Refresh")}
            onClick={() => void nav.navigate(nav.current, undefined, true)}><RotateCw className={nav.busy ? "animate-spin" : ""} /></Button>
        </div>
        <input aria-label={t("Project HTML address")} title={t("Project HTML address")}
          className="h-7 min-w-0 flex-1 rounded-md border bg-background px-2 text-xs"
          value={nav.address} onChange={event => nav.setAddress(event.target.value)}
          onKeyDown={event => { if (event.key === "Escape") nav.setAddress(nav.current); }} />
      </form>
      <div className="ml-auto flex shrink-0 items-center gap-0.5">
        <Button type="button" size="icon-xs" variant={view === "source" ? "secondary" : "ghost"}
          title={t(view === "preview" ? "Source" : "Preview")} aria-label={t(view === "preview" ? "Source" : "Preview")}
          onClick={() => setView(view === "preview" ? "source" : "preview")}>
          {view === "preview" ? <CodeXml /> : <Eye />}
        </Button>
        {view === "preview" && <PreviewZoomControls zoom={zoom} setZoom={setZoom} />}
        {projectId && <Button asChild size="icon-xs" variant="ghost">
          <a href={htmlPreviewPath(nav.document.path, projectId)} target="_blank" rel="noopener noreferrer" onClick={openExternal}
            title={t(opening ? "Opening…" : openFailed ? "Open in new tab" : "Open in external browser")}
            aria-label={t(opening ? "Opening…" : openFailed ? "Open in new tab" : "Open in external browser")}>
            <ExternalLinkIcon />
          </a>
        </Button>}
        {renderFileActions?.(nav.document.path)}
      </div>
    </div>
    {openFailed && <p role="status" className="px-3 text-xs text-muted-foreground">{t("Could not launch the system browser.")}</p>}
    {nav.error && <p role="alert" className="px-3 py-1 text-xs text-destructive">{t(nav.error)}</p>}
    <div className="min-h-0 flex-1">
      {view === "source" ? (
        <ReadOnlyCodeView content={body ?? ""} name={nav.document.path === path ? name : nav.document.path} className="h-full" revealLine={revealLine} revealToken={revealToken} />
      ) : (
        <ScaledPreviewFrame key={nav.document.revision} ref={nav.frame} title={title} sandbox="allow-scripts" srcDoc={previewDocument} zoom={zoom} />
      )}
    </div>
  </div>;
}
