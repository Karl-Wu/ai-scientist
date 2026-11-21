"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { ArrowLeftIcon, ArrowUpRightIcon, BookOpenIcon, ChevronRightIcon, FileTextIcon, LinkIcon, MessageSquareIcon, PlusIcon, SearchIcon, SparklesIcon, Table2Icon } from "lucide-react";
import { MessageResponse } from "@/components/ai-elements/message";
import { useLocale, useT } from "@/components/i18n-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  NOTE_INSTRUCTION_MAX_CHARS, NOTE_SOURCE_LABELS, NOTE_STATUS_LABELS, NOTE_TYPES, noteTypesIn,
  type NoteContent, type NoteCreationSource, type NoteDraft, type NoteDraftCredit, type NoteExpertOption,
  type NotePage, type NoteSourceLink, type NoteSummary, type NoteTaskReference, type NoteType,
} from "@/lib/note-pages";
import { apiFetch } from "@/lib/projects";
import { useCapabilitiesRevision } from "@/lib/capability-events";
import { relativeTime } from "@/lib/locale-time";
import { cn } from "@/lib/utils";

const selectClass = "h-8 max-w-full rounded-md border bg-background px-2 text-xs";
const listSelectClass = `${selectClass} min-w-0 flex-1 truncate`;
const noteListWidth = "mx-auto w-full max-w-xl @min-[54rem]/notes:max-w-5xl";

function newNoteKey() {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

interface NotesProps {
  projectId: string;
  onOpenSource: (source: NoteSourceLink) => void;
}

const sourceIcons = { task: LinkIcon, tool: LinkIcon, message: MessageSquareIcon, result: Table2Icon, file: FileTextIcon };

function NoteListCard({ page, onOpen, onOpenSources, onOpenSource }: {
  page: NoteSummary;
  onOpen: () => void;
  onOpenSources: () => void;
  onOpenSource: NotesProps["onOpenSource"];
}) {
  const t = useT();
  const locale = useLocale();
  const cardId = useId();
  const time = relativeTime(page.savedAt, locale);
  const { source } = page;
  const moreSources = page.sourceCount - 1;
  const SourceIcon = source && sourceIcons[source.kind];
  const sourceType = source && t(NOTE_SOURCE_LABELS[source.kind]);
  const pendingReview = page.status === "pending";
  const summary = page.excerpt
    .replace(/^[\t ]{0,3}(?:#{1,6}|>|[-+*]|\d+[.)])[\t ]+/gm, "")
    .replace(/!?\[([^\]\n]*)\]\([^\n)]*\)/g, "$1")
    .replace(/(\*\*|__|~~|`)(\S[^\n]*?)\1/g, "$2")
    .replace(/\s+/g, " ").trim();
  const description = [`${cardId}-type`, pendingReview && `${cardId}-status`, summary && `${cardId}-summary`, time && `${cardId}-time`].filter(Boolean).join(" ");

  return <li className="@container/note-card flex min-w-0 flex-col rounded-xl border bg-card text-card-foreground transition-colors hover:border-foreground/20">
    <button type="button" aria-label={page.title} aria-describedby={description}
      className="grid w-full min-w-0 gap-1 rounded-t-xl px-3 pb-2 pt-2.5 text-left focus-visible:outline-2 focus-visible:outline-ring"
      onClick={onOpen}>
      <span className="flex min-w-0 items-start gap-2">
        <span className="min-w-0 flex-1 break-words text-sm font-semibold leading-snug">{page.title}</span>
        {pendingReview && <span id={`${cardId}-status`} className="shrink-0 whitespace-nowrap rounded bg-amber-500/15 px-1.5 py-0.5 text-xs font-medium text-amber-800 dark:text-amber-300">
          {t(NOTE_STATUS_LABELS.pending)}
        </span>}
        <ChevronRightIcon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
      </span>
      {summary && <span id={`${cardId}-summary`} className="line-clamp-2 break-words text-[13px] leading-5 text-muted-foreground">{summary}</span>}
    </button>
    <div className={cn("mx-3 mt-auto grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2 gap-y-1 border-t border-border/70 py-1.5 text-xs text-muted-foreground",
      source && "@min-[25rem]/note-card:grid-cols-[auto_minmax(0,1fr)_auto]")}>
      <span id={`${cardId}-type`} className="col-start-1 row-start-1 truncate font-medium" title={t(NOTE_TYPES[page.type].label)}>{t(NOTE_TYPES[page.type].label)}</span>
      {time && <time id={`${cardId}-time`} dateTime={new Date(page.savedAt).toISOString()}
        className={cn("col-start-2 row-start-1 justify-self-end whitespace-nowrap tabular-nums", source && "@min-[25rem]/note-card:col-start-3")}
        title={t("Updated {date}", { date: new Date(page.savedAt).toLocaleString(locale) })}>{time}</time>}
      {source && SourceIcon && <div className="col-span-2 row-start-2 flex min-w-0 items-center gap-1 @min-[25rem]/note-card:col-span-1 @min-[25rem]/note-card:col-start-2 @min-[25rem]/note-card:row-start-1">
        <button type="button" onClick={() => onOpenSource(source)}
          className="flex min-w-0 items-center gap-1 rounded px-1 py-1 text-left text-blue-700 hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring dark:text-blue-300"
          title={source.kind === "file" ? source.path : source.label}>
          <SourceIcon aria-hidden="true" className="size-3 shrink-0" />
          <span className="min-w-0 truncate">{sourceType} · {source.label}</span>
          <ArrowUpRightIcon aria-hidden="true" className="size-3 shrink-0" />
        </button>
        {moreSources > 0 && <button type="button" onClick={onOpenSources}
          className="shrink-0 rounded px-1 py-1 hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
          aria-label={moreSources === 1 ? t("View 1 more source") : t("View {count} more sources", { count: moreSources })}>+{moreSources}</button>}
      </div>}
    </div>
  </li>;
}

export function NotePagesView({ projectId, onOpenSource, currentTask, model, createFrom, onCreationHandled }: NotesProps & {
  currentTask?: NoteTaskReference;
  model?: string;
  createFrom?: NoteCreationSource;
  onCreationHandled?: (source: NoteCreationSource) => void;
}) {
  const t = useT();
  const [pages, setPages] = useState<NoteSummary[]>();
  const [matches, setMatches] = useState<NoteSummary[]>();
  const [tasks, setTasks] = useState<Record<string, string>>({});
  const [error, setError] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [query, setQuery] = useState("");
  const [type, setType] = useState<NoteType | "">("");
  const [task, setTask] = useState("");
  const [organizer, setOrganizer] = useState("");
  const [selected, setSelected] = useState<{ id: string; initialPage?: NotePage; focusSources?: boolean }>();
  const [creating, setCreating] = useState<{ key: string; source?: NoteCreationSource }>();
  const handledCreation = useRef<NoteCreationSource | undefined>(undefined);
  const search = query.trim();

  useEffect(() => {
    if (!createFrom || handledCreation.current === createFrom) return;
    handledCreation.current = createFrom;
    onCreationHandled?.(createFrom);
    if (creating && !window.confirm(t("Replace the current note draft?"))) return;
    setCreating({ key: newNoteKey(), source: createFrom });
  }, [createFrom, creating, onCreationHandled, t]);

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await apiFetch("/notes", { signal: controller.signal }, projectId);
        if (!response.ok) throw new Error("Notes request failed");
        const data = await response.json() as { pages: NoteSummary[] };
        if (!controller.signal.aborted) {
          setPages(data.pages);
          setError(false);
        }
      } catch {
        if (!controller.signal.aborted) setError(true);
      }
    })();
    return () => controller.abort();
  }, [projectId, refresh]);

  useEffect(() => {
    if (!search) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      void (async () => {
        const response = await apiFetch("/notes?" + new URLSearchParams({ q: search }), { signal: controller.signal }, projectId);
        if (!response.ok) throw new Error("Notes search failed");
        const data = await response.json() as { pages: NoteSummary[] };
        if (!controller.signal.aborted) {
          setError(false);
          setMatches(data.pages);
        }
      })().catch(() => { if (!controller.signal.aborted) setError(true); });
    }, 150);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [projectId, refresh, search]);

  useEffect(() => {
    if (!pages?.some((page) => page.tasks.length)) return;
    const controller = new AbortController();
    void (async () => {
      const response = await apiFetch("/sessions", { signal: controller.signal }, projectId);
      if (!response.ok) return;
      const data = await response.json() as { id: string; name?: string; firstMessage?: string }[];
      if (!controller.signal.aborted && Array.isArray(data)) {
        setTasks(Object.fromEntries(data.map((session) => [session.id, session.name || session.firstMessage?.slice(0, 70) || session.id])));
      }
    })().catch(() => {});
    return () => controller.abort();
  }, [projectId, pages]);

  const taskIds = useMemo(() => [...new Set(pages?.flatMap((page) => page.tasks))], [pages]);
  const organizers = [...new Set(pages?.map((page) => page.organizer))];
  const availableTypes = useMemo(() => noteTypesIn(pages), [pages]);
  const activeType = type && availableTypes.includes(type) ? type : "";
  const visible = (search ? matches : pages)?.filter((page) => (!activeType || page.type === activeType)
    && (!task || page.tasks.includes(task))
    && (!organizer || page.organizer === organizer));

  if (creating) {
    return <NotePageCreate key={creating.key} projectId={projectId} currentTask={currentTask} model={model}
      source={creating.source} onCancel={() => setCreating(undefined)}
      onCreated={(page) => {
        setSelected({ id: page.id, initialPage: page });
        setCreating((current) => current?.key === creating.key ? undefined : current);
        setRefresh((value) => value + 1);
      }} />;
  }

  if (selected) {
    return <NotePageDetail key={selected.id} id={selected.id} projectId={projectId} onOpenSource={onOpenSource}
      initialPage={selected.initialPage} focusSources={selected.focusSources} onBack={() => setSelected(undefined)}
      onSaved={() => setRefresh((value) => value + 1)} />;
  }

  return (
    <section className="@container/notes flex min-h-0 min-w-0 flex-1 flex-col" aria-label={t("Notes")}>
      <header className="border-b px-3 py-2.5 @min-[32rem]/notes:px-4">
        <div className={cn(noteListWidth, "space-y-2.5")}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <h2 className="flex items-center gap-2 font-semibold"><BookOpenIcon aria-hidden="true" className="size-4 text-amber-600" />{t("Notes")}</h2>
              {visible && <span className="text-xs text-muted-foreground">
                {visible.length === 1 ? t("1 page") : t("{count} pages", { count: visible.length })}
              </span>}
            </div>
            <Button type="button" size="sm" variant="outline" onClick={() => setCreating({ key: newNoteKey() })}>
              <PlusIcon aria-hidden="true" />{t("New note page")}
            </Button>
          </div>
          {Boolean(pages?.length) && <div className="grid min-w-0 gap-1.5 @min-[30rem]/notes:grid-cols-[minmax(7rem,1fr)_minmax(0,2fr)]">
            <div className="relative min-w-0">
              <SearchIcon aria-hidden="true" className="pointer-events-none absolute start-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input className="h-8 min-w-0 ps-8" aria-label={t("Search note pages")} placeholder={t("Search note pages")} value={query} maxLength={300} onChange={(event) => { if (event.target.value.trim() !== search) setMatches(undefined); setError(false); setQuery(event.target.value); }} />
            </div>
            <div className="flex min-w-0 gap-1.5">
              {availableTypes.length > 0 && <select className={listSelectClass} aria-label={t("Note type")} value={activeType} onChange={(event) => setType(event.target.value as NoteType | "")}>
                <option value="">{t("All note types")}</option>
                {availableTypes.map((id) => <option key={id} value={id}>{t(NOTE_TYPES[id].label)}</option>)}
              </select>}
              {taskIds.length > 0 && <select className={listSelectClass} aria-label={t("Source task")} value={task} title={task ? tasks[task] ?? task : undefined} onChange={(event) => setTask(event.target.value)}>
                <option value="">{t("All tasks")}</option>
                {taskIds.map((id) => <option key={id} value={id}>{tasks[id] ?? id}</option>)}
              </select>}
              <select className={listSelectClass} aria-label={t("Organizer")} value={organizer} onChange={(event) => setOrganizer(event.target.value)}>
                <option value="">{t("All organizers")}</option>
                {organizers.map((id) => <option key={id} value={id}>{t(id)}</option>)}
              </select>
            </div>
          </div>}
        </div>
      </header>
      <div className="min-h-0 flex-1 overflow-auto bg-muted/20 px-3 py-2.5 @min-[32rem]/notes:px-4">
        {error ? <div className="flex items-center gap-2 text-sm" role="alert">
          {t("Could not load notes.")}<Button size="sm" variant="ghost" onClick={() => setRefresh((value) => value + 1)}>{t("Retry")}</Button>
        </div> : !pages ? <p role="status" className="text-sm text-muted-foreground">{t("Loading notes…")}</p>
          : !pages.length ? <p className="py-8 text-center text-sm text-muted-foreground">{t("No note pages yet")}</p>
          : !visible ? <p role="status" className="text-sm text-muted-foreground">{t("Searching notes…")}</p>
          : !visible.length ? <p className="py-8 text-center text-sm text-muted-foreground">{t("No matching note pages")}</p>
          : <ul className={cn(noteListWidth, "grid grid-cols-1 gap-3 @min-[54rem]/notes:grid-cols-2")}>
            {visible.map((page) => <NoteListCard key={page.id} page={page} onOpenSource={onOpenSource}
              onOpen={() => setSelected({ id: page.id })} onOpenSources={() => setSelected({ id: page.id, focusSources: true })} />)}
          </ul>}
      </div>
    </section>
  );
}

function NotePageCreate({ projectId, currentTask, model, source, onCancel, onCreated }: {
  projectId: string;
  currentTask?: NoteTaskReference;
  model?: string;
  source?: NoteCreationSource;
  onCancel: () => void;
  onCreated: (page: NotePage) => void;
}) {
  const t = useT();
  const locale = useLocale();
  const [sourceTask] = useState(currentTask);
  const [title, setTitle] = useState(() => source?.title.trim().slice(0, 300) ?? "");
  const [summary, setSummary] = useState("");
  const [includeTask, setIncludeTask] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const attempt = useRef<{ content: string; requestId: string } | undefined>(undefined);
  const [drafting, setDrafting] = useState(false);
  const [suggestion, setSuggestion] = useState<NoteDraft>();
  const [draftError, setDraftError] = useState<string>();
  const [expert, setExpert] = useState("");
  const [experts, setExperts] = useState<NoteExpertOption[]>([]);
  const [expertListError, setExpertListError] = useState(false);
  const [instructions, setInstructions] = useState("");
  const [draftCredit, setDraftCredit] = useState<NoteDraftCredit>();
  const capabilitiesRevision = useCapabilitiesRevision();
  const task = !source && includeTask ? sourceTask : undefined;
  const selectedExpert = experts.find((option) => option.name === expert);
  const canDraft = (!expert || selectedExpert?.available) && Boolean(title.trim() || summary.trim() || instructions.trim() || task || source || suggestion);
  const busy = pending || drafting;

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await apiFetch("/notes/experts", { signal: controller.signal }, projectId);
        if (!response.ok) throw new Error("Note expert lookup failed");
        const { experts } = await response.json() as { experts: NoteExpertOption[] };
        if (!controller.signal.aborted) {
          setExperts(experts);
          setExpertListError(false);
        }
      } catch {
        if (!controller.signal.aborted) setExpertListError(true);
      }
    })();
    return () => controller.abort();
  }, [projectId, capabilitiesRevision]);

  async function draftWithAssistant() {
    if (busy || !canDraft) return;
    setDrafting(true);
    setDraftError(undefined);
    try {
      const response = await apiFetch("/notes/draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, summary, instructions: instructions.trim() || undefined, expert: expert || undefined,
          previousDraft: suggestion ? { title: suggestion.title, summary: suggestion.summary } : undefined,
          taskId: task?.id, source: source?.anchor, model, locale }),
      }, projectId);
      if (response.ok) {
        setSuggestion(await response.json() as NoteDraft);
        return;
      }
      const messages: Record<number, string> = {
        400: "Enter instructions, write some note text, or select a source with saved content.",
        401: "Connect a model provider to draft a note.",
        402: "The project spend limit has been reached.",
        403: "The selected note source is unavailable.",
        404: source ? "The selected note source is unavailable." : "The referenced task or note assistant is unavailable.",
        409: "The selected note expert or its skill is unavailable.",
        415: "Add a description to draft a note from this file.",
        422: "The selected note assistant model is unavailable.",
      };
      setDraftError(messages[response.status] ?? "Could not generate a note draft.");
    } catch {
      setDraftError("Could not generate a note draft.");
    } finally {
      setDrafting(false);
    }
  }

  async function save() {
    if (busy || !title.trim()) return;
    setPending(true);
    setError(undefined);
    try {
      const draft = { title: title.trim(), summary, task, source: source?.anchor, draftCredit };
      const content = JSON.stringify(draft);
      if (attempt.current?.content !== content) {
        attempt.current = { content, requestId: newNoteKey() };
      }
      const response = await apiFetch("/notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...draft, requestId: attempt.current.requestId }),
      }, projectId);
      if (!response.ok) {
        setError(source && [403, 404].includes(response.status) ? "The selected note source is unavailable." : "Could not save the note page.");
        return;
      }
      onCreated(await response.json() as NotePage);
    } catch {
      setError("Could not save the note page.");
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="flex min-h-0 flex-1 flex-col" aria-label={t("New note page")}>
      <header className="border-b px-4 py-3"><h2 className="font-semibold">{t("New note page")}</h2></header>
      <div className="min-h-0 flex-1 overflow-auto p-4">
        <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); void save(); }}>
          <fieldset className="min-w-0 space-y-3" disabled={busy}>
            <label className="block space-y-1 text-sm">{t("Note title")}
              <Input required autoFocus maxLength={300} value={title} onChange={(event) => setTitle(event.target.value)} />
            </label>
            <label className="block space-y-1 text-sm">{t("Current summary")}
              <Textarea rows={6} maxLength={32000} placeholder={t("Markdown supported")} value={summary}
                onChange={(event) => setSummary(event.target.value)} />
            </label>
          </fieldset>
          <section className="space-y-3 rounded-md border p-3" aria-label={t("Note assistant")}>
            <div className="space-y-2">
              <label className="block space-y-1 text-xs font-medium">{t("Note expert")}
                <select className={`${selectClass} block w-full`} disabled={busy} value={expert} onChange={(event) => {
                  setExpert(event.target.value);
                  setSuggestion(undefined);
                  setDraftError(undefined);
                }}>
                  <option value="">{t("General assistant")}</option>
                  {expert && !selectedExpert && <option value={expert} disabled>{t(expert)} · {t("Unavailable")}</option>}
                  {experts.map((option) => <option key={option.name} value={option.name} disabled={!option.available}>
                    {t(option.name)}{!option.available ? ` · ${t("Unavailable")}` : ""}
                  </option>)}
                </select>
              </label>
              {selectedExpert && <p className="text-xs text-muted-foreground">{t("Drafting skill: {skill}", { skill: selectedExpert.skill })}</p>}
              {expertListError && <p className="text-xs text-muted-foreground">{t("Could not load note experts. You can still use the general assistant.")}</p>}
              <label className="block space-y-1 text-xs font-medium">{t("Instructions for the expert (optional)")}
                <Textarea disabled={busy} rows={2} maxLength={NOTE_INSTRUCTION_MAX_CHARS} value={instructions}
                  placeholder={t("For example, focus on the limitations and suggest one follow-up check.")}
                  onChange={(event) => setInstructions(event.target.value)} />
              </label>
            </div>
            <div className="space-y-1">
              <Button type="button" size="sm" variant="outline" disabled={busy || !canDraft} onClick={() => void draftWithAssistant()}>
                <SparklesIcon aria-hidden="true" />{t(drafting ? "Drafting note…" : suggestion ? "Redraft" : "Draft with assistant")}
              </Button>
              <p className="text-xs text-muted-foreground">{t(source?.anchor.kind === "file"
                ? "The assistant sends your input and a text excerpt when available. Add a description for other file formats."
                : source ? "The assistant sends your input and an excerpt of the selected source to the model."
                : "The assistant sends your input and excerpts from the referenced task to the model.")}</p>
            </div>
            {draftError && <p role="alert" className="text-sm text-destructive">{t(draftError)}</p>}
            {suggestion && <div className="space-y-2 border-t pt-3">
              <h3 className="text-sm font-medium">{t("Suggested draft")}</h3>
              {suggestion.taskExcerptShortened && <p className="text-xs text-muted-foreground">{t("The draft uses an excerpt of the task.")}</p>}
              {suggestion.sourceExcerptShortened && <p className="text-xs text-muted-foreground">{t("The draft uses an excerpt of the selected source.")}</p>}
              <div className="max-h-60 space-y-1 overflow-auto rounded-md bg-muted/50 p-3 text-sm">
                <p className="break-words font-medium">{suggestion.title}</p>
                <p className="whitespace-pre-wrap break-words">{suggestion.summary}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => {
                  setTitle(suggestion.title);
                  setSummary(suggestion.summary);
                  setDraftCredit(suggestion.draftCredit);
                  setSuggestion(undefined);
                }}>{t("Apply draft")}</Button>
                <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => setSuggestion(undefined)}>{t("Dismiss")}</Button>
              </div>
            </div>}
          </section>
          <fieldset className="min-w-0 space-y-2 border-t pt-3" disabled={busy} aria-label={t("Sources")}>
            <h3 className="text-sm font-medium">{t("Sources")}</h3>
            {source ? <p className="break-words rounded-md border p-2 text-xs">
              <span className="text-muted-foreground">{t(source.anchor.kind === "message" ? "Answer" : NOTE_SOURCE_LABELS[source.anchor.kind])} · </span>
              {source.anchor.kind === "file" ? source.anchor.path : source.title}
            </p> : sourceTask ? <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" className="mt-0.5 size-4 shrink-0 accent-primary" checked={includeTask}
                onChange={(event) => {
                  setIncludeTask(event.target.checked);
                  setSuggestion(undefined);
                }} />
              <span className="min-w-0">
                {t("Reference current task")}
                <span className="mt-0.5 block break-words text-xs text-muted-foreground">{sourceTask.title}</span>
              </span>
            </label> : <p className="text-xs text-muted-foreground">{t("No active task to reference")}</p>}
          </fieldset>
          {error && <p role="alert" className="text-sm text-destructive">{t(error)}</p>}
          <div className="flex flex-wrap gap-2">
            <Button type="submit" size="sm" disabled={busy || !title.trim()}>{t("Save note page")}</Button>
            <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={onCancel}>{t("Cancel")}</Button>
          </div>
        </form>
      </div>
    </section>
  );
}

function NotePageDetail({ id, projectId, onOpenSource, onBack, onSaved, initialPage, focusSources }: NotesProps & {
  id: string;
  initialPage?: NotePage;
  focusSources?: boolean;
  onBack: () => void;
  onSaved: () => void;
}) {
  const t = useT();
  const locale = useLocale();
  const [page, setPage] = useState(initialPage);
  const [revisionNumber, setRevisionNumber] = useState<number>();
  const [editing, setEditing] = useState<NoteContent>();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  const sourcesRef = useRef<HTMLElement>(null);
  const loadedId = page?.id;

  useEffect(() => {
    if (initialPage && reload === 0) return;
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await apiFetch("/notes/" + encodeURIComponent(id), { signal: controller.signal }, projectId);
        if (!response.ok) throw new Error("Note request failed");
        const data = await response.json() as NotePage;
        if (!controller.signal.aborted) {
          setPage(data);
          setError("");
        }
      } catch {
        if (!controller.signal.aborted) setError("Could not load the note page.");
      }
    })();
    return () => controller.abort();
  }, [id, initialPage, projectId, reload]);

  useEffect(() => {
    if (!focusSources || !loadedId) return;
    sourcesRef.current?.focus({ preventScroll: true });
    sourcesRef.current?.scrollIntoView?.({ block: "nearest" });
  }, [focusSources, loadedId]);

  const latest = page?.revisions.at(-1);
  const revision = page?.revisions.find((item) => item.version === revisionNumber) ?? latest;
  const definition = page && NOTE_TYPES[page.type];

  async function save(action: "edit" | "review") {
    if (!latest || pending) return;
    setPending(true);
    setError("");
    try {
      const response = await apiFetch("/notes/" + encodeURIComponent(id), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, expectedVersion: latest.version, ...(action === "edit" ? editing : undefined) }),
      }, projectId);
      if (response.status === 409) {
        setError("This note has a newer revision. Copy any edits before reloading.");
        return;
      }
      if (!response.ok) throw new Error("Save failed");
      setPage(await response.json() as NotePage);
      setRevisionNumber(undefined);
      setEditing(undefined);
      onSaved();
    } catch {
      setError("Could not save the note page.");
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="flex min-h-0 flex-1 flex-col">
      <header className="border-b px-3 py-2">
        <Button type="button" variant="ghost" size="sm" disabled={pending} onClick={onBack}><ArrowLeftIcon aria-hidden="true" />{t("Notes")}</Button>
      </header>
      <div className="min-h-0 flex-1 overflow-auto p-4">
        {error && <div role="alert" className="mb-3 flex flex-wrap items-center gap-2 text-sm text-destructive">
          {t(error)}
          <Button type="button" variant="outline" size="sm" onClick={() => { setEditing(undefined); setRevisionNumber(undefined); setReload((value) => value + 1); }}>{t("Reload")}</Button>
        </div>}
        {!page || !revision || !definition ? (!error && <p role="status" className="text-sm">{t("Loading notes…")}</p>) : (
          <article className="space-y-4">
            <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
              <span>{definition.group && `${t(definition.group)} · `}{t(definition.label)}</span>
              <span>{t(NOTE_STATUS_LABELS[revision.status])}</span>
              <span>{t(page.organizer)}</span>
              {revision.draftCredit && <span title={revision.draftCredit.skill.sha256}>
                {t("Drafted with {expert}", { expert: t(revision.draftCredit.expert) })} · {revision.draftCredit.skill.name}
              </span>}
            </div>
            {editing ? <form className="space-y-3" onSubmit={(event) => { event.preventDefault(); void save("edit"); }}>
              <label className="block space-y-1 text-sm">{t("Note title")}
                <Input required disabled={pending} value={editing.title} maxLength={300} onChange={(event) => setEditing({ ...editing, title: event.target.value })} />
              </label>
              <label className="block space-y-1 text-sm">{t("Current summary")}
                <Textarea rows={6} disabled={pending} value={editing.summary} maxLength={32000} onChange={(event) => setEditing({ ...editing, summary: event.target.value })} />
              </label>
              {Object.entries(definition.fields).map(([key, label]) => <label className="block space-y-1 text-sm" key={key}>{t(label)}
                <Textarea rows={2} disabled={pending} maxLength={4000} value={editing.fields[key] ?? ""} onChange={(event) => setEditing({ ...editing, fields: { ...editing.fields, [key]: event.target.value } })} />
              </label>)}
              <div className="flex gap-2">
                <Button type="submit" size="sm" disabled={pending || !editing.title.trim()}>{t("Save revision")}</Button>
                <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={() => setEditing(undefined)}>{t("Cancel")}</Button>
              </div>
            </form> : <>
              <h2 className="break-words text-lg font-semibold">{revision.title}</h2>
              <section className="space-y-2">
                <h3 className="text-sm font-medium">{t("Current summary")}</h3>
                {revision.summary ? <MessageResponse className="break-words text-sm">{revision.summary}</MessageResponse>
                  : <p className="text-xs text-muted-foreground">{t("No summary yet")}</p>}
                {Object.values(revision.fields).some(Boolean) && <dl className="space-y-2 text-sm">
                  {Object.entries(definition.fields).filter(([key]) => revision.fields[key]).map(([key, label]) => <div key={key}>
                    <dt className="font-medium">{t(label)}</dt>
                    <dd className="whitespace-pre-wrap break-words text-muted-foreground">{revision.fields[key]}</dd>
                  </div>)}
                </dl>}
              </section>
            </>}
            <section ref={sourcesRef} tabIndex={-1} aria-label={t("Sources")} className="space-y-2 border-t pt-3">
              <h3 className="text-sm font-medium">{t("Sources")}</h3>
              {page.sources.length === 0 ? <p className="text-xs text-muted-foreground">{t("No sources yet")}</p> : <ul className="space-y-2">
                {page.sources.map((source) => <li key={source.id} className="space-y-1 rounded-md border p-2">
                  <div className="flex items-start justify-between gap-2">
                    <span className="min-w-0 break-words text-xs"><span className="text-muted-foreground">{t(NOTE_SOURCE_LABELS[source.kind])} · </span>{source.label}</span>
                    <Button className="shrink-0" size="xs" type="button" variant="ghost" onClick={() => onOpenSource(source)}>
                      <ArrowUpRightIcon aria-hidden="true" />{t(source.kind === "file" ? "Open current file" : source.kind === "task" ? "Open source task" : "Open source")}
                    </Button>
                  </div>
                  {source.excerpt && <p className="whitespace-pre-wrap break-words text-xs text-muted-foreground">{source.excerpt}</p>}
                  {source.kind === "file" && source.sha256 && <p className="break-all font-mono text-xs text-muted-foreground">SHA-256 {source.sha256}</p>}
                </li>)}
              </ul>}
            </section>
            {!editing && <div className="flex flex-wrap items-center gap-2 border-t pt-3">
              {page.revisions.length > 1 && <select className={selectClass} aria-label={t("Revision")} value={revision.version}
                onChange={(event) => setRevisionNumber(Number(event.target.value))}>
                {[...page.revisions].reverse().map((item) => <option key={item.version} value={item.version}>
                  {t("Revision {number}", { number: item.version })} · {new Date(item.savedAt).toLocaleString(locale)}
                </option>)}
              </select>}
              {revision === latest && <>
                <Button size="sm" type="button" variant="outline" disabled={pending} onClick={() => setEditing({
                  title: revision.title, summary: revision.summary, fields: revision.fields,
                })}>{t("Edit note page")}</Button>
                {revision.status === "pending" && <Button size="sm" type="button" disabled={pending} onClick={() => void save("review")}>{t("Mark as reviewed")}</Button>}
              </>}
            </div>}
          </article>
        )}
      </div>
    </section>
  );
}
