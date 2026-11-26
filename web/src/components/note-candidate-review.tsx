"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowUpRightIcon, ChevronDownIcon } from "lucide-react";
import { useT } from "@/components/i18n-provider";
import { NoteDraftProcess } from "@/components/note-draft-process";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { notifyNotePagesChanged } from "@/lib/note-events";
import {
  MAX_NOTE_CANDIDATES, NOTE_RECORD_FLAG_LABELS, NOTE_SOURCE_LABELS, NOTE_TYPES, type NoteAnchor, type NoteBatchResult, type NoteCandidate, type NoteCandidateBatch,
  type NoteDraftProgress, type NotePage, type NoteSourceLink, type NoteTaskReference,
} from "@/lib/note-pages";
import { apiFetch } from "@/lib/projects";
import { cn } from "@/lib/utils";

interface ReviewRow {
  candidate: NoteCandidate;
  checked: boolean;
  expanded: boolean;
  saved?: NotePage;
  failure?: string;
  uncertain?: boolean;
}

export function NoteCandidateReview({ batch, progress, projectId, task, source, sourceLabel, savedPages, onOpenSource, onBack, onDone, onSavingChange }: {
  batch: NoteCandidateBatch;
  progress: NoteDraftProgress[];
  projectId: string;
  task?: NoteTaskReference;
  source?: NoteAnchor;
  sourceLabel?: string;
  savedPages?: NotePage[];
  onOpenSource?: (source: NoteSourceLink) => void;
  onBack: () => void;
  onDone: (pages: NotePage[]) => void;
  onSavingChange: (pending: boolean) => void;
}) {
  const t = useT();
  const [rows, setRows] = useState<ReviewRow[]>(() => {
    const byRequest = new Map(savedPages?.map((page) => [page.id.replaceAll("-", ""), page]));
    return batch.candidates.map((candidate) => {
      const saved = byRequest.get(candidate.requestId);
      const content = saved?.revisions.at(-1);
      return { candidate: content ? { ...candidate, title: content.title, summary: content.summary, fields: content.fields } : candidate,
        saved, checked: !saved && batch.candidates.length === 1, expanded: batch.candidates.length === 1 };
    });
  });
  const [saving, setSaving] = useState(false);
  const inFlight = useRef(false);
  const reviewHeading = useRef<HTMLHeadingElement>(null);
  const remaining = rows.filter((row) => !row.saved);
  const selected = remaining.filter((row) => row.checked);
  const saved = rows.flatMap((row) => row.saved ? [row.saved] : []);

  useEffect(() => reviewHeading.current?.focus(), []);

  function update(requestId: string, patch: Partial<ReviewRow>) {
    setRows((current) => current.map((row) => row.candidate.requestId === requestId ? { ...row, ...patch } : row));
  }

  function leave() {
    if (rows.some((row) => row.uncertain || (row.failure && row.checked)) &&
        !window.confirm(t("Leave without retrying the remaining saves?"))) return;
    if (saved.length) onDone(saved);
    else onBack();
  }

  async function save(confirmed: ReviewRow[]) {
    if (inFlight.current || !confirmed.length || confirmed.some((row) => !row.candidate.title.trim())) return;
    inFlight.current = true;
    setSaving(true);
    onSavingChange(true);
    const savedNow: NotePage[] = [];
    const updates = new Map<string, Partial<ReviewRow>>();
    try {
      for (let offset = 0; offset < confirmed.length; offset += MAX_NOTE_CANDIDATES) {
        const chunk = confirmed.slice(offset, offset + MAX_NOTE_CANDIDATES);
        let results: NoteBatchResult[] = [];
        try {
          const response = await apiFetch("/notes/batch", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ pages: chunk.map((row) => row.candidate), task, source, draftCredit: batch.draftCredit }),
          }, projectId);
          if (response.ok) {
            const body = await response.json() as { results?: NoteBatchResult[] };
            if (Array.isArray(body.results)) results = body.results;
          }
        } catch { /* Mark this request uncertain so its original IDs can be retried. */ }
        const byId = new Map(results.map((result) => [result.requestId, result]));
        for (const { candidate: { requestId } } of chunk) {
          const result = byId.get(requestId);
          if (result?.status === "saved" && result.page?.id) {
            updates.set(requestId, { saved: result.page, failure: undefined, uncertain: false, checked: false });
            savedNow.push(result.page);
          } else if (result?.status === "failed" && result.code < 500) {
            updates.set(requestId, { failure: result.code === 404 || result.code === 403
              ? "The selected note source is unavailable." : "Could not save this candidate." });
          } else {
            updates.set(requestId, { failure: "Could not confirm the save. Retry this page.", uncertain: true });
          }
        }
      }
    } finally {
      setRows((current) => current.map((row) => ({ ...row, ...updates.get(row.candidate.requestId) })));
      if (savedNow.length) notifyNotePagesChanged(projectId);
      inFlight.current = false;
      setSaving(false);
      onSavingChange(false);
    }
    if (rows.length === 1 && savedNow.length === 1) onDone(savedNow);
  }

  return <>
    <div className="min-h-0 flex-1 overflow-y-auto p-4">
      <section className="mx-auto w-full max-w-2xl space-y-3" aria-label={t("Review note candidates")}>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <h3 ref={reviewHeading} tabIndex={-1} className="text-base font-semibold outline-none">{t("Review note candidates")}</h3>
            <p className="break-words text-xs text-muted-foreground">{batch.draftCredit.expert}{sourceLabel && <> · {sourceLabel}</>}</p>
          </div>
          {remaining.length > 1 && <label className="flex items-center gap-1.5 text-xs">
            <input type="checkbox" className="size-4 accent-primary" checked={selected.length === remaining.length} disabled={saving}
              onChange={(event) => setRows((current) => current.map((row) => row.saved ? row : { ...row, checked: event.target.checked }))} />
            {t("Select all candidates")}
          </label>}
        </div>
        <NoteDraftProcess steps={progress} />
        {batch.taskExcerptShortened && <p className="text-xs text-muted-foreground">{t("The draft uses an excerpt of the task.")}</p>}
        {batch.sourceExcerptShortened && <p className="text-xs text-muted-foreground">{t("The draft uses an excerpt of the selected source.")}</p>}
        {batch.taskRecords && <>
          {batch.taskRecords.coverage !== "recorded" && <p className="text-xs text-muted-foreground">
            {t(batch.taskRecords.coverage === "legacy" ? "This task has saved messages but no separate execution log."
              : "Some task records are missing or the task was still running.")}
          </p>}
          <details className="text-xs text-muted-foreground">
            <summary className="cursor-pointer">{t("Read {read} of {total} task records", {
              read: batch.taskRecords.read.length, total: batch.taskRecords.total,
            })}</summary>
            <ul className="mt-1 max-h-40 space-y-1 overflow-y-auto pl-3">
              {batch.taskRecords.read.map((record) => <li key={record.id} className="break-words">
                {record.label}{record.partial && " · " + t("Partially read")}
                {record.flags.map((flag) => " · " + t(NOTE_RECORD_FLAG_LABELS[flag]))}
              </li>)}
            </ul>
          </details>
        </>}
        {Boolean(batch.checks?.length) && <details className="text-xs text-muted-foreground">
          <summary className="cursor-pointer">{t("Expert checks")}</summary>
          <ul className="mt-1 space-y-1 pl-3">
            {batch.checks?.map((check) => <li key={check.kind + check.detail}>{check.kind === "source"
              ? t("Read source lines {range}", { range: check.detail })
              : check.kind === "table" ? t("Checked {count} table rows", { count: check.detail })
                : t("Read skill {skill}", { skill: check.detail })}</li>)}
          </ul>
        </details>}
        {rows.length === 0 && <p role="status" className="rounded-md border p-3 text-sm text-muted-foreground">{t("The expert found no note candidates.")}</p>}
        <ul className="space-y-2.5">
          {rows.map((row) => {
            const page = row.candidate;
            const patch = (change: Partial<NoteCandidate>) => update(page.requestId, { candidate: { ...page, ...change } });
            return <li key={page.requestId} className="space-y-2 rounded-lg border bg-card p-3">
              <div className="flex min-w-0 items-start gap-2">
                <input type="checkbox" className="mt-0.5 size-4 shrink-0 accent-primary" checked={row.checked}
                  aria-label={t("Select {title}", { title: page.title || t("Untitled note") })} disabled={saving || Boolean(row.saved)}
                  onChange={(event) => update(page.requestId, { checked: event.target.checked })} />
                <button type="button" aria-expanded={row.expanded} onClick={() => update(page.requestId, { expanded: !row.expanded })}
                  className="flex min-w-0 flex-1 items-start justify-between gap-2 rounded-sm text-left focus-visible:outline-2 focus-visible:outline-ring">
                  <span className="min-w-0 break-words text-sm font-semibold">
                    <span className="block text-xs font-normal text-muted-foreground">{t(NOTE_TYPES[page.type].label)}</span>
                    {page.title || t("Untitled note")}
                  </span>
                  <ChevronDownIcon aria-hidden="true" className={cn("size-4 shrink-0 text-muted-foreground", row.expanded && "rotate-180")} />
                </button>
              </div>
              {row.expanded ? <><fieldset disabled={saving || row.uncertain || Boolean(row.saved)} className="space-y-2">
                <label className="block space-y-1 text-sm">{t("Note title")}
                  <Input value={page.title} maxLength={300} onChange={(event) => patch({ title: event.target.value })} />
                </label>
                <label className="block space-y-1 text-sm">{t("Current summary")}
                  <Textarea value={page.summary} maxLength={32_000} className="min-h-28"
                    onChange={(event) => patch({ summary: event.target.value })} />
                </label>
                {Object.entries(NOTE_TYPES[page.type].fields).map(([id, label]) => <label key={id} className="block space-y-1 text-sm">{t(label)}
                  <Textarea value={page.fields[id] ?? ""} maxLength={4_000}
                    onChange={(event) => patch({ fields: { ...page.fields, [id]: event.target.value } })} />
                </label>)}
              </fieldset>
              {Boolean(page.sources?.length) && <div className="space-y-1.5 border-t pt-2">
                <h4 className="text-xs font-medium">{t("Sources")}</h4>
                <ul className="space-y-1.5">
                  {page.sources?.map((citation, index) => <li key={index} className="space-y-1 rounded-md border px-2 py-1.5 text-xs">
                    <div className="flex min-w-0 items-start justify-between gap-2">
                      <span className="min-w-0 break-words">{t(NOTE_SOURCE_LABELS[citation.kind])} · {citation.label}</span>
                      {onOpenSource && <Button type="button" variant="ghost" size="xs" className="shrink-0" onClick={() => onOpenSource(citation)}>
                        <ArrowUpRightIcon aria-hidden="true" />{t(citation.kind === "task" ? "Open source task" : "Open source")}
                      </Button>}
                    </div>
                    {Boolean(citation.recordFlags?.length) && <p className="text-muted-foreground">
                      {citation.recordFlags?.map((flag) => t(NOTE_RECORD_FLAG_LABELS[flag])).join(" · ")}
                    </p>}
                    {citation.excerpt && <details className="text-muted-foreground">
                      <summary className="cursor-pointer">{t("View cited excerpt")}</summary>
                      <p className="mt-1 whitespace-pre-wrap break-words">{citation.excerpt}</p>
                    </details>}
                  </li>)}
                </ul>
              </div>}</> : <p className="line-clamp-2 whitespace-pre-line break-words text-xs text-muted-foreground">{page.summary}</p>}
              {row.saved && <p className="text-xs font-medium text-muted-foreground">{t("Saved")}</p>}
              {row.failure && <div className="flex flex-wrap items-center gap-2 text-xs text-destructive">
                <span role="alert">{t(row.failure)}</span>
                <Button type="button" size="xs" variant="outline" disabled={saving || !page.title.trim()}
                  onClick={() => void save([row])}>{t("Retry")}</Button>
              </div>}
            </li>;
          })}
        </ul>
      </section>
    </div>
    <footer className="shrink-0 border-t bg-background px-4 py-2.5">
      <div className="mx-auto flex w-full max-w-2xl flex-wrap items-center justify-between gap-2">
        <span className="text-xs text-muted-foreground" role="status">
          {rows.length > 0 && t("{selected} selected · {saved} saved", { selected: selected.length, saved: saved.length })}
        </span>
        <div className="ml-auto flex flex-wrap gap-2">
          <Button type="button" size="sm" variant="ghost" disabled={saving} onClick={leave}>{t(saved.length ? "Done" : "Back to editor")}</Button>
          {remaining.length > 0 && <Button type="button" size="sm" disabled={saving || !selected.length || selected.some((row) => !row.candidate.title.trim())}
            onClick={() => void save(selected)}>{t(saving ? "Saving…" : rows.length === 1 ? "Save note page" : "Save selected notes")}</Button>}
        </div>
      </div>
    </footer>
  </>;
}
