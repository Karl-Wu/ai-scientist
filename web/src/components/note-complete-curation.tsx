"use client";

import { useEffect, useState } from "react";
import { LayersIcon, LoaderCircleIcon } from "lucide-react";
import { useLocale, useT } from "@/components/i18n-provider";
import { Button } from "@/components/ui/button";
import type { NoteCandidateBatch, NoteCurationStatus, NotePage } from "@/lib/note-pages";
import { apiFetch } from "@/lib/projects";

function failureMessage(status?: number, action?: "start" | "cancel" | "resume") {
  switch (status) {
    case 401: return "Connect a model provider to draft a note.";
    case 402: return "The project spend limit has been reached.";
    case 404: return "The selected note source is unavailable.";
    case 409: return action === "start" ? "The selected expert is unavailable for note drafting."
      : action ? "Refresh complete curation status and try again." : "Complete curation was interrupted.";
    case 422: return "The expert model is unavailable or its context is too small.";
    case 504: return "Note drafting timed out.";
    default: return "Complete curation could not finish this step.";
  }
}

export function NoteCompleteCuration({ projectId, taskId, expert, model, disabled, onReview }: {
  projectId: string;
  taskId: string;
  expert?: string;
  model?: string;
  disabled: boolean;
  onReview: (batch: NoteCandidateBatch, savedPages?: NotePage[]) => void;
}) {
  const t = useT();
  const locale = useLocale();
  const [job, setJob] = useState<NoteCurationStatus | null>();
  const [loadError, setLoadError] = useState(false);
  const [actionError, setActionError] = useState<string>();
  const [working, setWorking] = useState(false);
  const [reload, setReload] = useState(0);
  const url = "/notes/curation/" + encodeURIComponent(taskId);
  const running = job?.state === "running";

  useEffect(() => {
    const controller = new AbortController();
    let timer: number | undefined;
    async function refresh() {
      try {
        const response = await apiFetch(url, { signal: controller.signal, cache: "no-store" }, projectId);
        if (!response.ok) throw new Error("Could not load note curation");
        const next = await response.json() as NoteCurationStatus | null;
        if (controller.signal.aborted) return;
        setJob(next);
        setLoadError(false);
        if (next?.state === "running") timer = window.setTimeout(refresh, 1_000);
      } catch {
        if (controller.signal.aborted) return;
        setLoadError(true);
        if (running) timer = window.setTimeout(refresh, 2_500);
      }
    }
    if (!working) void refresh();
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [projectId, reload, running, url, working]);

  async function change(action: "start" | "cancel" | "resume") {
    setWorking(true);
    setActionError(undefined);
    try {
      const response = await apiFetch(url, {
        method: action === "start" ? "POST" : "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(action === "start" ? { expert, model, locale } : { action, id: job?.id }),
      }, projectId);
      if (!response.ok) {
        setActionError(failureMessage(response.status, action));
        return;
      }
      setJob(await response.json() as NoteCurationStatus);
    } catch {
      setActionError(failureMessage(500, action));
    } finally {
      setWorking(false);
    }
  }

  const progress = job?.progress;
  const coverage = job?.coverage;
  const resumable = job?.state === "failed" || job?.state === "cancelled";
  const reading = job?.phase === "reading";
  const merging = job?.phase === "merging";
  return <div className="space-y-2">
    <p className="text-xs text-muted-foreground">{t("Review the whole saved task in batches, including records hidden in chat. Files and attachments are excluded.")}</p>
    {job && <div className="space-y-1 rounded-md bg-muted/50 p-2.5 text-xs">
      <div role="status" className="space-y-1">
        <p className="flex items-center gap-2 font-medium">
          {running && <LoaderCircleIcon aria-hidden className="size-3.5 animate-spin" />}
          {t(job.state === "completed" ? "Complete curation finished" : job.state === "cancelled" ? "Complete curation stopped"
            : job.state === "failed" ? "Complete curation paused" : reading ? "Reading saved records"
              : merging ? "Merging note candidates" : "Indexing saved task records")}
          <span className="font-normal text-muted-foreground">{t(job.expert)}</span>
        </p>
        {progress && <p className="tabular-nums text-muted-foreground">
          {t("{read} of {total} records read · {done} of {batches} batches", {
            read: progress.readRecords, total: progress.totalRecords, done: progress.readBatches, batches: progress.totalBatches,
          })}
        </p>}
        {merging && Boolean(progress?.mergeBatches) && <p className="tabular-nums text-muted-foreground">
          {t("{done} of {total} merge batches", { done: progress!.mergedBatches ?? 0, total: progress!.mergeBatches ?? 0 })}
        </p>}
      </div>
      {coverage && <details className="text-muted-foreground" open={coverage.incomplete || coverage.truncated > 0 || coverage.unavailable > 0 || undefined}>
        <summary className="cursor-pointer">{t("Coverage and gaps")}</summary>
        <ul className="mt-1 space-y-0.5 pl-4">
          <li>{t("{count} saved execution events scanned", { count: coverage.events })}</li>
          {(coverage.truncated > 0 || coverage.unavailable > 0 || coverage.redacted > 0) && <li>
            {t("{truncated} truncated · {unavailable} unavailable · {redacted} redacted records", {
              truncated: coverage.truncated, unavailable: coverage.unavailable, redacted: coverage.redacted,
            })}
          </li>}
          {Boolean(coverage.unavailableReasoning) && <li>
            {t("{count} reasoning records contain text the provider did not save in readable form.", { count: coverage.unavailableReasoning ?? 0 })}
          </li>}
          {coverage.excludedAttachments > 0 && <li>{t("{count} saved images excluded", { count: coverage.excludedAttachments })}</li>}
          {coverage.incomplete && <li>{t("The execution history has gaps or was still being written at the snapshot.")}</li>}
          {(coverage.eventGaps > 0 || coverage.damagedRows > 0 || coverage.unsupportedEvents > 0) && <li>
            {t("{eventGaps} logged gaps · {damagedRows} damaged entries · {unsupportedEvents} unsupported events", {
              eventGaps: coverage.eventGaps, damagedRows: coverage.damagedRows, unsupportedEvents: coverage.unsupportedEvents,
            })}
          </li>}
          {coverage.activeAtStart && <li>{t("Records added after this snapshot are outside this run.")}</li>}
        </ul>
      </details>}
      {job.state === "failed" && <p role="alert" className="text-destructive">{t(failureMessage(job.errorStatus))}</p>}
      {job.state === "completed" && job.batch?.candidates.length === 0 && <p>{t("No note candidates were found in the saved records.")}</p>}
    </div>}
    {actionError && <p role="alert" className="text-xs text-destructive">{t(actionError)}</p>}
    {loadError && <div className="flex flex-wrap items-center gap-2">
      <p role="alert" className="text-xs text-destructive">{t("Could not load complete curation status.")}</p>
      <Button type="button" size="sm" variant="ghost" onClick={() => setReload((value) => value + 1)}>{t("Retry")}</Button>
    </div>}
    <div className="flex flex-wrap items-center gap-2">
      {(!job || job.state === "completed") && <Button type="button" size="sm" variant="outline" disabled={disabled || working || job === undefined || !expert}
        onClick={() => void change("start")}>
        <LayersIcon aria-hidden />{t(job ? "Start another curation" : "Start complete curation")}
      </Button>}
      {running && <Button type="button" size="sm" variant="ghost" disabled={working} onClick={() => void change("cancel")}>{t("Stop curation")}</Button>}
      {resumable && <Button type="button" size="sm" variant="outline" disabled={disabled || working} onClick={() => void change("resume")}>{t("Resume curation")}</Button>}
      {job?.state === "completed" && Boolean(job.batch?.candidates.length) && <Button type="button" size="sm" disabled={disabled || working}
        onClick={() => { if (job.batch) onReview(job.batch, job.savedPages); }}>
        {t("Review {count} note candidates", { count: job.batch?.candidates.length ?? 0 })}
      </Button>}
    </div>
  </div>;
}
