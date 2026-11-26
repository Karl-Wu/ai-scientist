"use client";

import { ArrowUpRightIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { useLocale, useT } from "@/components/i18n-provider";
import { getFileOrigin, SOURCE_EVIDENCE_LABELS, type FileOrigin, type FileSourceStep, type SourceStepReference } from "@/lib/provenance";

const USER_OPERATIONS: Record<string, string> = {
  upload: "Uploaded by user",
  save: "Saved by user",
  move: "Moved by user",
  delete: "Deleted by user",
};

export function FileOriginControl({ path, projectId, consumer, onJump }: {
  path: string;
  projectId: string;
  consumer?: SourceStepReference;
  onJump: (step: FileSourceStep) => void;
}) {
  const t = useT();
  const locale = useLocale();
  const [lookup, setLookup] = useState<FileOrigin | "error" | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    void getFileOrigin(path, projectId, consumer, controller.signal).then((origin) => {
      if (!controller.signal.aborted) setLookup(origin);
    }, () => {
      if (!controller.signal.aborted) setLookup("error");
    });
    return () => controller.abort();
  }, [path, projectId, consumer]);

  const source = lookup && lookup !== "error" ? lookup.source ?? lookup.lastKnown : undefined;
  const status = lookup && lookup !== "error" ? {
    matched: undefined,
    edited: "Manually edited after generation",
    historical: lookup.changedSinceUse === true ? "The working file has changed since this step used it." :
      lookup.changedSinceUse === null ? "The working file cannot be compared to the recorded input." : "Version used by the selected step",
    changed: "File changed. The source of the change is unknown.",
    unknown: consumer ? "Could not confirm the version used by this step." : "Could not confirm the current version.",
    unrecorded: "No file source recorded",
  }[lookup.status] : undefined;

  return (
    <section className="space-y-2 border-b px-3 py-2.5 text-xs" aria-label={t("File source")}>
      {lookup === null ? <p role="status">{t("Looking up file source…")}</p> :
        lookup === "error" ? <p role="alert">{t("Could not look up this file's source.")}</p> : (
          <>
            {status && <p role="status" className="text-muted-foreground">{t(status)}</p>}
            {lookup.inputConfidence === "inferred" && <p className="text-amber-700 dark:text-amber-400">{t("Inferred input")}</p>}
            {source && (
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                {source.role === "agent" && (
                  <button type="button" onClick={() => onJump(source)} className="inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 font-medium hover:bg-muted">
                    <ArrowUpRightIcon aria-hidden="true" className="size-3.5" />
                    {t(lookup.lastKnown ? "View last known writing step" : lookup.status === "edited" ? "View original writing step" :
                      source.change === "modified" && source.toolName !== "write" ? "View writing step" : "View generating step")}
                  </button>
                )}
                <span className="font-medium text-muted-foreground">{source.role === "user" ? t(USER_OPERATIONS[source.toolName] ?? "User operation") : source.toolName}</span>
                {source.evidence !== "recorded" && (
                  <span className="text-amber-700 dark:text-amber-400">{t(SOURCE_EVIDENCE_LABELS[source.evidence])}</span>
                )}
              </div>
            )}
            {lookup.history.length > (source ? 1 : 0) && (
              <details className="border-t pt-2">
                <summary className="cursor-pointer font-medium">{t("Recent file history")}</summary>
                <ul className="mt-1 space-y-1">
                  {lookup.history.map((step) => (
                    <li key={JSON.stringify([step.sessionId, step.runId, step.stepId])} className="flex flex-wrap items-center justify-between gap-x-2 rounded-sm px-1 py-0.5">
                      <span>{step.role === "user" ? t(USER_OPERATIONS[step.toolName] ?? "User operation") : step.toolName}</span>
                      <span className="text-muted-foreground">{new Date(step.timestamp).toLocaleString(locale)}</span>
                      {step.evidence !== "recorded" && <span className="text-amber-700 dark:text-amber-400">{t(SOURCE_EVIDENCE_LABELS[step.evidence])}</span>}
                      {step.role === "agent" && step.change !== "deleted" && (
                        <button type="button" className="underline underline-offset-2" onClick={() => onJump(step)}>{t("Open step")}</button>
                      )}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </>
        )}
    </section>
  );
}
