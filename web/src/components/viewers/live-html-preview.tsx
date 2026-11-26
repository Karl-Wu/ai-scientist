"use client";

import { useEffect, useRef, useState } from "react";
import { RotateCw, X } from "lucide-react";
import { apiFetch } from "@/lib/projects";
import type { LocalPreviewRef } from "@/lib/local-preview";
import { useT } from "../i18n-provider";
import { ScaledPreviewFrame } from "../scaled-preview-frame";
import { Button } from "../ui/button";

export function LiveHtmlPreview({ preview, onClose }: { preview: LocalPreviewRef; onClose?: () => void }) {
  const t = useT();
  const [url, setUrl] = useState<string>();
  const [failed, setFailed] = useState(false);
  const [attempt, retry] = useState(0);
  const [unconfirmed, setUnconfirmed] = useState(false);
  const frame = useRef<HTMLIFrameElement>(null);
  useEffect(() => {
    if (!url) return;
    const origin = new URL(url).origin;
    // Browsers conceal cross-origin frame errors, including frame-ancestors refusals.
    const timer = setTimeout(() => setUnconfirmed(true), 8000);
    const confirm = (event: MessageEvent) => {
      if (event.origin === origin && event.source === frame.current?.contentWindow && event.data?.type === "local-preview-ready") {
        clearTimeout(timer);
        setUnconfirmed(false);
      }
    };
    window.addEventListener("message", confirm);
    return () => { clearTimeout(timer); window.removeEventListener("message", confirm); };
  }, [url]);
  useEffect(() => {
    const controller = new AbortController();
    setUrl(undefined);
    setFailed(false);
    setUnconfirmed(false);
    void apiFetch(`/sessions/${encodeURIComponent(preview.sessionId)}/local-previews/${preview.previewId}`,
      { method: "POST", signal: controller.signal, cache: "no-store" }, preview.projectId)
      .then(async r => {
        if (!r.ok) throw new Error();
        const resolved = await r.json();
        if (!controller.signal.aborted) setUrl(resolved.url);
      }).catch(() => { if (!controller.signal.aborted) setFailed(true); });
    return () => controller.abort();
  }, [preview.sessionId, preview.previewId, preview.projectId, attempt]);
  return <div className="flex min-h-0 flex-1 flex-col" aria-label={t("HTML preview")}>
    <div className="flex items-center gap-2 border-b px-2 py-1 text-sm">
      <span className="flex-1 truncate">{preview.title}</span>
      <Button size="icon-xs" variant="ghost" aria-label={t("Refresh")} onClick={() => retry(n => n + 1)}><RotateCw /></Button>
      <Button size="icon-xs" variant="ghost" aria-label={t("Close preview")} onClick={onClose}><X /></Button>
    </div>
    {failed ? <p role="alert" className="p-3 text-sm">{t("Preview unavailable. Ask the tool to open it again.")}</p> :
      url && <div className="min-h-0 flex-1"><ScaledPreviewFrame ref={frame} title={preview.title} src={url} zoom={1}
        sandbox="allow-scripts allow-same-origin allow-forms" /></div>}
    {unconfirmed && !failed && <p role="status" className="px-2 py-1 text-xs text-muted-foreground">
      {t("If the page is blank, check that the service is running and allows embedding.")}</p>}
  </div>;
}
