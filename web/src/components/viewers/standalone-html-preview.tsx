"use client";

import { useEffect, useState } from "react";
import { useT } from "@/components/i18n-provider";
import { apiFetch } from "@/lib/projects";
import HtmlViewer from "./html-viewer";

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

  const name = path?.split("/").at(-1) ?? "";
  return <main className="flex h-dvh min-h-0 flex-col">
    <h1 className="shrink-0 truncate border-b px-3 py-2 text-sm font-medium" title={path}>{name || t("HTML preview")}</h1>
    <div className="min-h-0 flex-1">
      {path && projectId && !error && content !== null ? (
        <HtmlViewer content={content} name={name} path={path} projectId={projectId} standalone />
      ) : (
        <p className="p-4 text-sm text-muted-foreground" role={error ? "alert" : "status"}>
          {t(error || (path ? "Loading HTML preview…" : "Open an HTML file from the file panel."))}
        </p>
      )}
    </div>
  </main>;
}
