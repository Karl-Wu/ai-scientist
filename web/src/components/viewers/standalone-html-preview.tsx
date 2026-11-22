"use client";

import { useEffect, useState } from "react";
import { useT } from "@/components/i18n-provider";
import { htmlPreviewDocument } from "@/lib/html-preview";
import { apiFetch } from "@/lib/projects";

export function StandaloneHtmlPreview({ path, projectId }: { path?: string; projectId?: string }) {
  const t = useT();
  const [content, setContent] = useState<string | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!path || !projectId) return;
    const controller = new AbortController();
    void apiFetch("/sandbox/file?" + new URLSearchParams({ path }), { signal: controller.signal }, projectId)
      .then(async (response) => {
        if (!response.ok || response.headers.has("X-Project-Fallback")) {
          throw new Error(response.status === 413
            ? "HTML previews are limited to 8 MB. Use Download to access the complete file."
            : "Could not load file");
        }
        const html = await response.text();
        if (!controller.signal.aborted) setContent(html);
      })
      .catch((err: unknown) => {
        if (!controller.signal.aborted) setError(err instanceof Error ? err.message : "Could not load file");
      });
    return () => controller.abort();
  }, [path, projectId]);

  const title = t("HTML preview");
  return <main className="h-dvh">
    {path && projectId && !error && content !== null ? (
      <iframe title={title} sandbox="allow-scripts" referrerPolicy="no-referrer"
        srcDoc={htmlPreviewDocument(content, title)} className="block size-full border-0" />
    ) : (
      <p className="p-4 text-sm text-muted-foreground" role={error ? "alert" : "status"}>
        {t(error || (path ? "Loading HTML preview…" : "Open an HTML file from the file panel."))}
      </p>
    )}
  </main>;
}
