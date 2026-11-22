"use client";

import { useEffect, useMemo, useState, type MouseEvent } from "react";
import { ExternalLinkIcon } from "lucide-react";
import { ReadOnlyCodeView } from "@/components/code-views";
import { useT } from "@/components/i18n-provider";
import { Button } from "@/components/ui/button";
import { PreviewZoomControls } from "@/components/preview-zoom-controls";
import { ScaledPreviewFrame } from "@/components/scaled-preview-frame";
import { htmlPreviewDocument, htmlPreviewPath } from "@/lib/html-preview";
import { apiFetch } from "@/lib/projects";
import type { ViewerProps } from "@/lib/viewers/registry";

export default function HtmlViewer({
  content, name, path, projectId, revealLine, revealToken, standalone = false,
}: ViewerProps & { standalone?: boolean }) {
  const t = useT();
  const [view, setView] = useState<"preview" | "source">(revealLine ? "source" : "preview");
  const [zoom, setZoom] = useState(1);
  const [opening, setOpening] = useState(false);
  const [openFailed, setOpenFailed] = useState(false);
  useEffect(() => {
    if (revealLine) setView("source");
  }, [revealLine, revealToken]);
  const title = t("HTML preview");
  const previewDocument = useMemo(() => view === "preview" && content !== null
    ? htmlPreviewDocument(content, title)
    : undefined, [content, title, view]);
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
        body: JSON.stringify({ path }),
      }, projectId);
      if (!response.ok) setOpenFailed(true);
    } catch {
      setOpenFailed(true);
    } finally {
      setOpening(false);
    }
  }

  return <div className="flex h-full min-h-0 flex-col">
    <div className="flex shrink-0 flex-wrap items-center gap-1 border-b px-2.5 py-1.5">
      <Button type="button" size="xs" variant={view === "preview" ? "secondary" : "ghost"}
        aria-pressed={view === "preview"} onClick={() => setView("preview")}>{t("Preview")}</Button>
      <Button type="button" size="xs" variant={view === "source" ? "secondary" : "ghost"}
        aria-pressed={view === "source"} onClick={() => setView("source")}>{t("Source")}</Button>
      {view === "preview" && <PreviewZoomControls zoom={zoom} setZoom={setZoom} />}
      {!standalone && projectId && <Button asChild size="xs" variant="ghost" className="ml-auto">
        <a href={htmlPreviewPath(path, projectId)} target="_blank" rel="noopener noreferrer" onClick={openExternal}>
          <ExternalLinkIcon aria-hidden />
          {t(opening ? "Opening…" : openFailed ? "Open in new tab" : "Open in external browser")}
        </a>
      </Button>}
      {openFailed && <p role="status" className="w-full text-xs text-muted-foreground">{t("Could not launch the system browser.")}</p>}
    </div>
    <div className="min-h-0 flex-1">
      {view === "source" ? (
        <ReadOnlyCodeView content={content} name={name} className="h-full" revealLine={revealLine} revealToken={revealToken} />
      ) : (
        <ScaledPreviewFrame title={title} sandbox="allow-scripts" srcDoc={previewDocument} zoom={zoom} />
      )}
    </div>
  </div>;
}
