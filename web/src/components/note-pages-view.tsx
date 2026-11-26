"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import {
  ArrowLeftIcon, ArrowRightLeftIcon, ArrowUpRightIcon, BookOpenIcon, ChartNoAxesColumnIncreasingIcon, ChevronDownIcon,
  ChevronRightIcon, ClipboardCheckIcon, FileTextIcon, FlaskConicalIcon, GitBranchIcon, LightbulbIcon, LinkIcon, ListFilterIcon,
  MessageSquareIcon, PlusIcon, SearchIcon, SignpostIcon, SparklesIcon, Table2Icon,
} from "lucide-react";
import { toast } from "sonner";
import { MessageResponse } from "@/components/ai-elements/message";
import { NoteCandidateReview } from "@/components/note-candidate-review";
import { NoteCompleteCuration } from "@/components/note-complete-curation";
import { NoteDraftProcess } from "@/components/note-draft-process";
import { SettingsLink } from "@/components/settings-link";
import { useLocale, useT } from "@/components/i18n-provider";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";
import {
  NOTE_DRAFT_STEP_LIMIT, NOTE_RECORD_FLAG_LABELS, NOTE_SOURCE_LABELS, NOTE_STATUS_LABELS, NOTE_TYPES, noteTypesIn,
  type NoteCandidateBatch, type NoteContent, type NoteCreationSource, type NoteDraftEvent, type NoteDraftProgress,
  type NoteListResult, type NotePage, type NoteRevision, type NoteSourceLink, type NoteSummary, type NoteTaskReference, type NoteType,
} from "@/lib/note-pages";
import { notifyNotePagesChanged, useNotePagesRevision } from "@/lib/note-events";
import { getAgentRoster, type AgentFile } from "@/lib/agents";
import { apiFetch } from "@/lib/projects";
import { useCapabilitiesRevision } from "@/lib/capability-events";
import { relativeTime } from "@/lib/locale-time";
import { consumeSse } from "@/lib/sse";
import { cn } from "@/lib/utils";

const selectClass = "h-8 max-w-full rounded-md border bg-background px-2 text-xs";
const filterSelectClass = `${selectClass} block w-full min-w-0 truncate`;
const noteListWidth = "mx-auto w-full max-w-xl @min-[54rem]/notes:max-w-5xl";
const noteReadingWidth = "mx-auto w-full max-w-2xl";

function newNoteKey() {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

interface NotesProps {
  projectId: string;
  onOpenSource: (source: NoteSourceLink) => void;
}

const sourceIcons = { task: LinkIcon, tool: LinkIcon, message: MessageSquareIcon, result: Table2Icon, file: FileTextIcon, pdfAnnotation: FileTextIcon };

const noteTypeAppearance = {
  note: { icon: FileTextIcon, text: "text-muted-foreground", fill: "border-border bg-muted" },
  hypothesis: { icon: LightbulbIcon, text: "text-amber-800 dark:text-amber-300", fill: "border-amber-600/25 bg-amber-500/10" },
  method: { icon: FlaskConicalIcon, text: "text-sky-800 dark:text-sky-300", fill: "border-sky-600/25 bg-sky-500/10" },
  observation: { icon: ChartNoAxesColumnIncreasingIcon, text: "text-emerald-800 dark:text-emerald-300", fill: "border-emerald-600/25 bg-emerald-500/10" },
  decision: { icon: SignpostIcon, text: "text-violet-800 dark:text-violet-300", fill: "border-violet-600/25 bg-violet-500/10" },
  mappingRule: { icon: ArrowRightLeftIcon, text: "text-blue-800 dark:text-blue-300", fill: "border-blue-600/25 bg-blue-500/10" },
  qualityCheck: { icon: ClipboardCheckIcon, text: "text-teal-800 dark:text-teal-300", fill: "border-teal-600/25 bg-teal-500/10" },
  processingDecision: { icon: GitBranchIcon, text: "text-fuchsia-800 dark:text-fuchsia-300", fill: "border-fuchsia-600/25 bg-fuchsia-500/10" },
} as const;

const typePillClass = "inline-flex min-w-0 items-center gap-1.5 rounded-full border text-xs font-medium";
const typeFilterClass = cn(typePillClass, "h-7 px-2.5 whitespace-nowrap transition-colors",
  "focus-visible:outline-2 focus-visible:outline-ring");
const scopeButtonClass = "rounded-md px-2.5 py-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring aria-pressed:bg-background aria-pressed:text-foreground aria-pressed:shadow-xs disabled:opacity-50";

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
  const { icon: TypeIcon, text: typeColor, fill: typeFill } = noteTypeAppearance[page.type];
  const typeLabel = t(NOTE_TYPES[page.type].label);
  const summary = page.excerpt
    .replace(/^[\t ]{0,3}(?:#{1,6}|>|[-+*]|\d+[.)])[\t ]+/gm, "")
    .replace(/!?\[([^\]\n]*)\]\([^\n)]*\)/g, "$1")
    .replace(/(\*\*|__|~~|`)(\S[^\n]*?)\1/g, "$2")
    .replace(/\s+/g, " ").trim();
  const description = [`${cardId}-type`, pendingReview && `${cardId}-status`, summary && `${cardId}-summary`, time && `${cardId}-time`].filter(Boolean).join(" ");

  return <li className="@container/note-card flex min-w-0 flex-col rounded-xl border bg-card text-card-foreground transition-colors hover:border-foreground/20">
    <button type="button" aria-label={page.title} aria-describedby={description}
      className="grid w-full min-w-0 gap-1 rounded-t-xl px-3 pb-1 pt-2.5 text-left focus-visible:outline-2 focus-visible:outline-ring"
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
    <div className={cn("mx-3 mt-auto grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2 gap-y-0.5 pb-2 text-xs text-muted-foreground",
      source && "@min-[20rem]/note-card:grid-cols-[auto_minmax(0,1fr)_auto]")}>
      <span id={`${cardId}-type`} className={cn(typePillClass, typeColor, typeFill, "col-start-1 row-start-1 w-fit max-w-full px-2 py-0.5")} title={typeLabel}>
        <TypeIcon aria-hidden="true" className="size-3 shrink-0" /><span className="truncate">{typeLabel}</span>
      </span>
      {time && <time id={`${cardId}-time`} dateTime={new Date(page.savedAt).toISOString()}
        className={cn("col-start-2 row-start-1 justify-self-end whitespace-nowrap tabular-nums", source && "@min-[20rem]/note-card:col-start-3")}
        title={t("Updated {date}", { date: new Date(page.savedAt).toLocaleString(locale) })}>{time}</time>}
      {source && SourceIcon && <div className="col-span-2 row-start-2 flex min-w-0 items-center gap-1 @min-[20rem]/note-card:col-span-1 @min-[20rem]/note-card:col-start-2 @min-[20rem]/note-card:row-start-1">
        <button type="button" onClick={() => onOpenSource(source)}
          className="flex min-h-6 min-w-0 items-center gap-1 rounded px-1 text-left text-blue-700 hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring dark:text-blue-300"
          title={"path" in source ? source.path : source.label}>
          <SourceIcon aria-hidden="true" className="size-3 shrink-0" />
          <span className="min-w-0 truncate">{sourceType} · {source.label}
            {source.kind === "pdfAnnotation" && <> · {t("Page {page}", { page: source.page })}</>}
          </span>
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
  const [unavailableCount, setUnavailableCount] = useState(0);
  const [tasks, setTasks] = useState<Record<string, string>>({});
  const [error, setError] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [query, setQuery] = useState("");
  const [selectedTypes, setSelectedTypes] = useState<NoteType[]>([]);
  const [currentOnly, setCurrentOnly] = useState(false);
  const [task, setTask] = useState("");
  const [organizer, setOrganizer] = useState("");
  const [selected, setSelected] = useState<{ id: string; initialPage?: NotePage; focusSources?: boolean }>();
  const [creating, setCreating] = useState<{ key: string; source?: NoteCreationSource }>();
  const handledCreation = useRef<NoteCreationSource | undefined>(undefined);
  const search = query.trim();
  const notesRevision = useNotePagesRevision(projectId);

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
        const data = await response.json() as NoteListResult;
        if (!controller.signal.aborted) {
          setPages(data.pages);
          setUnavailableCount(data.unavailableCount ?? 0);
          setError(false);
        }
      } catch {
        if (!controller.signal.aborted) setError(true);
      }
    })();
    return () => controller.abort();
  }, [projectId, refresh, notesRevision]);

  useEffect(() => {
    if (!search) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      void (async () => {
        const response = await apiFetch("/notes?" + new URLSearchParams({ q: search }), { signal: controller.signal }, projectId);
        if (!response.ok) throw new Error("Notes search failed");
        const data = await response.json() as NoteListResult;
        if (!controller.signal.aborted) {
          setError(false);
          setMatches(data.pages);
          setUnavailableCount(data.unavailableCount ?? 0);
        }
      })().catch(() => { if (!controller.signal.aborted) setError(true); });
    }, 150);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [projectId, refresh, notesRevision, search]);

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
  const organizers = [...new Set(pages?.map((page) => page.draftExpert ?? page.organizer))];
  const availableTypes = useMemo(() => noteTypesIn(pages), [pages]);
  const activeTypes = selectedTypes.filter((type) => availableTypes.includes(type));
  const currentTaskOnly = currentOnly && Boolean(currentTask);
  const activeTask = currentTaskOnly ? currentTask?.id : task;
  const filterCount = Number(Boolean(task)) + Number(Boolean(organizer));
  const scoped = (search ? matches : pages)?.filter((page) => (!activeTask || page.tasks.includes(activeTask))
    && (!organizer || (page.draftExpert ?? page.organizer) === organizer));
  const typeCounts = new Map<NoteType, number>();
  for (const page of scoped ?? []) typeCounts.set(page.type, (typeCounts.get(page.type) ?? 0) + 1);
  const visible = activeTypes.length ? scoped?.filter((page) => activeTypes.includes(page.type)) : scoped;
  const unfilteredCurrentTaskIsEmpty = currentTaskOnly && !search && !organizer && activeTypes.length === 0;

  if (creating) {
    return <NotePageCreate key={creating.key} projectId={projectId} currentTask={currentTask} model={model}
      source={creating.source} onOpenSource={onOpenSource} onCancel={() => setCreating(undefined)}
      onCreated={(page) => {
        setSelected({ id: page.id, initialPage: page });
        setCreating((current) => current?.key === creating.key ? undefined : current);
        setRefresh((value) => value + 1);
      }} />;
  }

  if (selected) {
    return <NotePageDetail key={selected.id} id={selected.id} projectId={projectId} onOpenSource={onOpenSource}
      initialPage={selected.initialPage} focusSources={selected.focusSources} onBack={() => setSelected(undefined)}
      onDeleted={() => {
        setPages((current) => current?.filter((page) => page.id !== selected.id));
        setMatches((current) => current?.filter((page) => page.id !== selected.id));
        setSelected(undefined);
      }}
      onSaved={() => setRefresh((value) => value + 1)} />;
  }

  return (
    <section className="@container/notes flex min-h-0 min-w-0 flex-1 flex-col" aria-label={t("Notes")}>
      <header className="border-b px-3 py-2.5 @min-[32rem]/notes:px-4">
        <div className={cn(noteListWidth, "space-y-2.5")}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <h2 className="flex items-center gap-2 text-sm font-semibold"><BookOpenIcon aria-hidden="true" className="size-4 text-amber-600" />{t("Notes")}</h2>
              {visible && <span className="text-xs text-muted-foreground">
                {visible.length === 1 ? t("1 page") : t("{count} pages", { count: visible.length })}
              </span>}
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <Button type="button" size="sm" variant="outline" onClick={() => setCreating({ key: newNoteKey() })}>
                <PlusIcon aria-hidden="true" />{t("New note page")}
              </Button>
            </div>
          </div>
          {Boolean(pages?.length) && <div className="relative min-w-0">
            <SearchIcon aria-hidden="true" className="pointer-events-none absolute start-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input className="h-8 min-w-0 ps-8" aria-label={t("Search note pages")} placeholder={t("Search note pages")} value={query} maxLength={300} onChange={(event) => { if (event.target.value.trim() !== search) setMatches(undefined); setError(false); setQuery(event.target.value); }} />
          </div>}
          {Boolean(pages?.length) && <div className="flex flex-wrap items-center gap-2">
            <div role="group" aria-label={t("Task scope")} className="inline-flex w-fit shrink-0 items-center rounded-lg border bg-muted/50 p-0.5">
              <button type="button" aria-pressed={currentTaskOnly} disabled={!currentTask} className={scopeButtonClass}
                onClick={() => { setCurrentOnly(true); setTask(""); }}>{t("Current task")}</button>
              <button type="button" aria-pressed={!currentTaskOnly && !task} className={scopeButtonClass}
                onClick={() => { setCurrentOnly(false); setTask(""); }}>{t("All tasks")}</button>
            </div>
            <div role="group" aria-label={t("Note type")} className="flex min-w-0 flex-wrap items-center gap-1.5">
              {availableTypes.map((id) => {
                const { icon: Icon, text, fill } = noteTypeAppearance[id];
                const pressed = activeTypes.includes(id);
                return <button key={id} type="button" aria-pressed={pressed}
                  className={cn(typeFilterClass, pressed ? cn(text, fill, "ring-1 ring-inset ring-current/20") : "border-border text-muted-foreground hover:bg-muted hover:text-foreground")}
                  onClick={() => setSelectedTypes((types) => types.includes(id) ? types.filter((type) => type !== id) : [...types, id])}>
                  <Icon aria-hidden="true" className={cn("size-3.5 shrink-0", text)} />
                  {t(NOTE_TYPES[id].label)}{" "}
                  {scoped && <span className="tabular-nums">{typeCounts.get(id) ?? 0}</span>}
                </button>;
              })}
            </div>
            <Popover>
              <PopoverTrigger asChild>
                <Button type="button" size="sm" variant={filterCount ? "secondary" : "ghost"} className="h-7 px-2 text-xs text-muted-foreground">
                  <ListFilterIcon aria-hidden="true" />{t("More filters")}{" "}
                  {filterCount > 0 && <span className="rounded-full bg-background px-1.5 text-xs tabular-nums">{filterCount}</span>}
                </Button>
              </PopoverTrigger>
              <PopoverContent aria-label={t("More filters")} align="end" className="grid max-w-[calc(100vw-1.5rem)] gap-3 p-3">
                {taskIds.length > 0 && <label className="block space-y-1 text-xs font-medium">{t("Source task")}
                  <select className={filterSelectClass} value={task} title={task ? tasks[task] ?? task : undefined}
                    onChange={(event) => { setCurrentOnly(false); setTask(event.target.value); }}>
                    <option value="">{t("Any source task")}</option>
                    {taskIds.map((id) => <option key={id} value={id}>{tasks[id] ?? id}</option>)}
                  </select>
                </label>}
                <label className="block space-y-1 text-xs font-medium">{t("Organizer")}
                  <select className={filterSelectClass} value={organizer} onChange={(event) => setOrganizer(event.target.value)}>
                    <option value="">{t("All organizers")}</option>
                    {organizers.map((id) => <option key={id} value={id}>{t(id)}</option>)}
                  </select>
                </label>
                {(filterCount > 0 || currentTaskOnly || activeTypes.length > 0) && <Button type="button" variant="ghost" size="sm" className="justify-self-end"
                  onClick={() => { setSelectedTypes([]); setCurrentOnly(false); setTask(""); setOrganizer(""); }}>{t("Clear filters")}</Button>}
              </PopoverContent>
            </Popover>
          </div>}
        </div>
      </header>
      <div className="min-h-0 flex-1 overflow-auto bg-muted/20 px-3 py-2.5 @min-[32rem]/notes:px-4">
        {!error && unavailableCount > 0 && <p role="status" className={cn(noteListWidth, "mb-2 text-xs text-muted-foreground")}>
          {unavailableCount === 1 ? t("1 note page could not be read.") : t("{count} note pages could not be read.", { count: unavailableCount })}
        </p>}
        {error ? <div className="flex items-center gap-2 text-sm" role="alert">
          {t("Could not load notes.")}<Button size="sm" variant="ghost" onClick={() => setRefresh((value) => value + 1)}>{t("Retry")}</Button>
        </div> : !pages ? <p role="status" className="text-sm text-muted-foreground">{t("Loading notes…")}</p>
          : !pages.length ? (unavailableCount === 0 && <p className="py-8 text-center text-sm text-muted-foreground">{t("No note pages yet")}</p>)
          : !visible ? <p role="status" className="text-sm text-muted-foreground">{t("Searching notes…")}</p>
          : !visible.length ? <p className="py-8 text-center text-sm text-muted-foreground">{t(unfilteredCurrentTaskIsEmpty ? "No notes for the current task" : "No matching note pages")}</p>
          : <ul className={cn(noteListWidth, "grid grid-cols-1 gap-2.5 @min-[54rem]/notes:grid-cols-2")}>
            {visible.map((page) => <NoteListCard key={page.id} page={page} onOpenSource={onOpenSource}
              onOpen={() => setSelected({ id: page.id })} onOpenSources={() => setSelected({ id: page.id, focusSources: true })} />)}
          </ul>}
      </div>
    </section>
  );
}

export function NotePageCreate({ projectId, currentTask, model, source, onOpenSource, onCancel, onCreated, dialog }: {
  projectId: string;
  currentTask?: NoteTaskReference;
  model?: string;
  source?: NoteCreationSource;
  onOpenSource?: NotesProps["onOpenSource"];
  onCancel: () => void;
  onCreated: (page: NotePage) => void;
  dialog?: { returnFocus: () => void };
}) {
  const t = useT();
  const locale = useLocale();
  const [sourceTask] = useState(() => source?.task ?? currentTask);
  const [title, setTitle] = useState(() => source?.title.trim().slice(0, 300) ?? "");
  const [summary, setSummary] = useState(() => source?.initialSummary ?? "");
  const [includeTask, setIncludeTask] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const attempt = useRef<{ content: string; requestId: string } | undefined>(undefined);
  const [drafting, setDrafting] = useState(false);
  const draftRequest = useRef<AbortController | null>(null);
  const [batch, setBatch] = useState<NoteCandidateBatch>();
  const [completeMode, setCompleteMode] = useState(false);
  const [batchTask, setBatchTask] = useState<NoteTaskReference>();
  const [curationSavedPages, setCurationSavedPages] = useState<NotePage[]>();
  const [draftError, setDraftError] = useState<string>();
  const [draftProgress, setDraftProgress] = useState<NoteDraftProgress[]>([]);
  const [expertChoice, setExpertChoice] = useState<string>();
  const [defaultExpert, setDefaultExpert] = useState<string | null>(null);
  const [experts, setExperts] = useState<AgentFile[]>([]);
  const [expertsLoading, setExpertsLoading] = useState(true);
  const [expertListError, setExpertListError] = useState(false);
  const capabilitiesRevision = useCapabilitiesRevision();
  const anchor = source?.anchor;
  const task = source?.task ?? (!anchor && includeTask ? sourceTask : undefined);
  const completeTask = task ?? (anchor?.kind === "message" && sourceTask?.id === anchor.sessionId ? sourceTask : undefined);
  const sourceLabel = anchor?.kind === "file" ? anchor.path : source?.title ?? task?.title;
  const selectedExpert = experts.find((option) => option.name === (expertChoice ?? defaultExpert));
  const configuredModel = selectedExpert?.noteDraftModel ?? selectedExpert?.model;
  const canDraft = !expertsLoading && selectedExpert && Boolean(summary.trim() || task || source);
  const busy = pending || drafting;

  useEffect(() => {
    const controller = new AbortController();
    setExpertsLoading(true);
    getAgentRoster(projectId, controller.signal).then(({ agents, noteDefaultExpert }) => {
      if (controller.signal.aborted) return;
      setExperts(agents.filter((agent) => agent.enabled && agent.canDraftNotes).sort((a, b) => a.name.localeCompare(b.name)));
      setDefaultExpert(noteDefaultExpert);
      setExpertListError(false);
    }).catch(() => {
      if (controller.signal.aborted) return;
      setExperts([]);
      setExpertListError(true);
    }).finally(() => {
      if (!controller.signal.aborted) setExpertsLoading(false);
    });
    return () => controller.abort();
  }, [projectId, capabilitiesRevision]);

  useEffect(() => () => draftRequest.current?.abort(), [projectId]);

  async function draftWithExpert() {
    if (busy || !canDraft || draftRequest.current) return;
    const controller = new AbortController();
    draftRequest.current = controller;
    setDrafting(true);
    setDraftError(undefined);
    setDraftProgress([{ step: "preparing" }]);
    function fail(status: number, detail?: unknown) {
      const messages: Record<number, string> = {
        400: "Write note text or select a source with saved content.",
        401: "Connect a model provider to draft a note.",
        402: "The project spend limit has been reached.",
        403: "The selected note source is unavailable.",
        404: "The selected note source is unavailable.",
        409: "The selected expert is unavailable for note drafting.",
        415: "Add a description to draft a note from this file.",
        422: "The selected expert model is unavailable.",
        503: "The model provider could not process this draft.",
        504: "Note drafting timed out.",
      };
      if (!controller.signal.aborted) setDraftError(status === 502 && detail === NOTE_DRAFT_STEP_LIMIT
        ? NOTE_DRAFT_STEP_LIMIT : messages[status] ?? "Could not generate a note draft.");
    }
    function review(next: NoteCandidateBatch) {
      if (!Array.isArray(next?.candidates) || !next.draftCredit?.expert) throw new Error("Invalid note candidates");
      if (!controller.signal.aborted) setBatch(next);
    }
    try {
      const response = await apiFetch("/notes/draft", {
        method: "POST",
        signal: controller.signal,
        headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
        body: JSON.stringify({ format: "candidates", title, summary, expert: selectedExpert.name,
          taskId: task?.id, source: anchor, model, locale }),
      }, projectId, "stream");
      if (controller.signal.aborted) return;
      if (!response.ok) {
        fail(response.status, response.status === 502 ? (await response.json().catch(() => null))?.detail : undefined);
      } else if (response.headers.get("Content-Type")?.includes("text/event-stream")) {
        let receivedTerminal = false;
        await consumeSse<NoteDraftEvent>(response, (event) => {
          if (controller.signal.aborted) return true;
          if (event?.type === "progress") {
            setDraftProgress((steps) => {
              const last = steps.at(-1);
              const next = event.progress;
              return last?.step === next.step && last.round === next.round
                ? [...steps.slice(0, -1), next] : [...steps, next];
            });
          } else if (event?.type === "result" || event?.type === "error") {
            receivedTerminal = true;
            if (event.type === "result") review(event.batch);
            else fail(event.status, event.detail);
            return true;
          }
        });
        if (!receivedTerminal) fail(500);
      } else {
        review(await response.json() as NoteCandidateBatch);
      }
    } catch {
      if (!controller.signal.aborted) setDraftError("Could not generate a note draft.");
    } finally {
      if (draftRequest.current === controller) {
        draftRequest.current = null;
        setDrafting(false);
      }
    }
  }

  async function save() {
    if (busy || !title.trim()) return;
    setPending(true);
    setError(undefined);
    try {
      const draft = { title: title.trim(), summary, task, source: anchor };
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

  const editor = (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col" aria-label={t("New note page")}>
      <header className="shrink-0 border-b px-4 py-2.5">
        {dialog ? <DialogTitle className={cn(noteReadingWidth, "flex h-8 items-center text-sm font-semibold")}>{t("New note page")}</DialogTitle>
          : <h2 className={cn(noteReadingWidth, "flex h-8 items-center text-sm font-semibold")}>{t("New note page")}</h2>}
      </header>
      {batch ? <NoteCandidateReview batch={batch} progress={batchTask ? [] : draftProgress} projectId={projectId}
        task={batchTask ?? task} source={batchTask ? undefined : anchor} sourceLabel={batchTask?.title ?? sourceLabel}
        savedPages={batchTask ? curationSavedPages : undefined}
        onOpenSource={onOpenSource} onBack={() => { setBatch(undefined); setBatchTask(undefined); setCurationSavedPages(undefined); }} onSavingChange={setPending} onDone={(pages) => {
          if (pages.length === 1) onCreated(pages[0]);
          else onCancel();
        }} /> : <form className="flex min-h-0 min-w-0 flex-1 flex-col" onSubmit={(event) => { event.preventDefault(); void save(); }}>
        <div className="min-h-0 flex-1 overflow-auto p-4">
          <div className={cn(noteReadingWidth, "space-y-4")}>
            <fieldset className="min-w-0 space-y-3" disabled={busy}>
              <label className="block space-y-1 text-sm">{t("Note title")}
                <Input required autoFocus maxLength={300} value={title} onChange={(event) => setTitle(event.target.value)} />
              </label>
              <label className="block space-y-1 text-sm">{t("Current summary")}
                <Textarea rows={6} maxLength={32000} placeholder={t("Markdown supported")} value={summary}
                  onChange={(event) => setSummary(event.target.value)} />
              </label>
            </fieldset>
            <section className="space-y-3 rounded-md border p-3" aria-label={t("Draft with an expert")}>
              <label className="block space-y-1 text-xs font-medium">{t("Note expert")}
                <span className="relative block">
                  <select className={cn(selectClass, "block w-full appearance-none truncate pr-8")}
                    disabled={busy || expertsLoading} value={selectedExpert?.name ?? ""} onChange={(event) => {
                      setExpertChoice(event.target.value);
                      setDraftError(undefined);
                      setDraftProgress([]);
                    }}>
                    <option value="">{t(expertsLoading ? "Loading…" : "Select an expert")}</option>
                    {experts.map((expert) => <option key={expert.name} value={expert.name}>{t(expert.name)}</option>)}
                  </select>
                  <ChevronDownIcon className="pointer-events-none absolute right-2 top-1/2 size-3 -translate-y-1/2 text-muted-foreground" aria-hidden />
                </span>
              </label>
              {expertListError && <p role="alert" className="text-xs text-muted-foreground">{t("Could not load experts.")}</p>}
              {selectedExpert && <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-xs text-muted-foreground">
                <span className="min-w-0 break-words">{configuredModel
                  ? t("Expert model: {model}", { model: configuredModel })
                  : model ? t("Using the task model: {model}", { model }) : t("Using the app default model")}</span>
                <SettingsLink tab="specialists" projectId={projectId} section="specialist-default-model">{t("Expert model settings")}</SettingsLink>
              </div>}
              {completeTask && <div className="flex flex-wrap gap-1" role="group" aria-label={t("Note drafting mode")}>
                <Button type="button" size="sm" variant={completeMode ? "ghost" : "secondary"} disabled={busy} aria-pressed={!completeMode}
                  onClick={() => setCompleteMode(false)}>{t("Quick draft")}</Button>
                <Button type="button" size="sm" variant={completeMode ? "secondary" : "ghost"} disabled={busy} aria-pressed={completeMode}
                  onClick={() => setCompleteMode(true)}>{t("Complete curation")}</Button>
              </div>}
              {completeMode && completeTask ? <NoteCompleteCuration key={projectId + "/" + completeTask.id} projectId={projectId} taskId={completeTask.id}
                expert={selectedExpert?.name} model={model} disabled={busy} onReview={(result, savedPages) => {
                  setBatchTask(completeTask);
                  setCurationSavedPages(savedPages);
                  setBatch(result);
                }} />
                : <><div className="flex flex-wrap items-center gap-2">
                <Button type="button" size="sm" variant="outline" disabled={busy || !canDraft} onClick={() => void draftWithExpert()}>
                  <SparklesIcon aria-hidden="true" />{t(drafting ? "Drafting note…" : "Draft with expert")}
                </Button>
                {drafting && <Button type="button" size="sm" variant="ghost" onClick={() => draftRequest.current?.abort()}>
                  {t("Cancel drafting")}
                </Button>}
              </div>
              <NoteDraftProcess steps={draftProgress} running={drafting} />
              {draftError && <p role="alert" className="text-sm text-destructive">{t(draftError)}</p>}
              </>}
            </section>
            <fieldset className="min-w-0 space-y-2 border-t pt-3" disabled={busy} aria-label={t("Sources")}>
              <h3 className="text-sm font-medium">{t("Sources")}</h3>
              {source ? <p className="break-words rounded-md border p-2 text-xs">
                <span className="text-muted-foreground">{t(!anchor ? "Task" : anchor.kind === "message" ? "Answer" : NOTE_SOURCE_LABELS[anchor.kind])} · </span>
                {sourceLabel}
              </p> : sourceTask ? <label className="flex items-start gap-2 text-sm">
                <input type="checkbox" className="mt-0.5 size-4 shrink-0 accent-primary" checked={includeTask}
                  onChange={(event) => {
                    setIncludeTask(event.target.checked);
                  }} />
                <span className="min-w-0">
                  {t("Reference current task")}
                  <span className="mt-0.5 block break-words text-xs text-muted-foreground">{sourceTask.title}</span>
                </span>
              </label> : <p className="text-xs text-muted-foreground">{t("No active task to reference")}</p>}
            </fieldset>
          </div>
        </div>
        <footer className="shrink-0 border-t bg-background px-4 py-2.5">
          <div className={cn(noteReadingWidth, "space-y-2")}>
            {error && <p role="alert" className="text-sm text-destructive">{t(error)}</p>}
            <div className="flex flex-wrap justify-end gap-2">
              <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={onCancel}>{t("Cancel")}</Button>
              <Button type="submit" size="sm" disabled={busy || !title.trim()}>{t("Save note page")}</Button>
            </div>
          </div>
        </footer>
      </form>}
    </section>
  );

  if (!dialog) return editor;
  return <Dialog open onOpenChange={(open) => { if (!open && !pending) onCancel(); }}>
    <DialogContent className="flex max-h-[calc(100dvh-2rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl"
      aria-describedby={undefined} showCloseButton={!pending}
      onInteractOutside={(event) => event.preventDefault()}
      onCloseAutoFocus={(event) => { event.preventDefault(); dialog.returnFocus(); }}>
      {editor}
    </DialogContent>
  </Dialog>;
}

function NoteRevisionSummary({ type, revision, label }: { type: NoteType; revision: NoteRevision; label: string }) {
  const t = useT();
  const fields = Object.entries(NOTE_TYPES[type].fields).filter(([key]) => revision.fields[key]);
  return <section className="space-y-2">
    <h3 className="text-sm font-medium">{t(label)}</h3>
    {revision.summary ? <MessageResponse className="break-words text-sm [&_:is(h1,h2)]:mt-4 [&_:is(h1,h2)]:mb-1.5 [&_:is(h1,h2)]:text-base [&_:is(h3,h4,h5,h6)]:mt-3 [&_:is(h3,h4,h5,h6)]:mb-1 [&_:is(h3,h4,h5,h6)]:text-sm [&_:is(ol,ul)]:ps-5">{revision.summary}</MessageResponse>
      : <p className="text-xs text-muted-foreground">{t("No summary yet")}</p>}
    {fields.length > 0 && <dl className="space-y-2 text-sm">
      {fields.map(([key, fieldLabel]) => <div key={key}>
        <dt className="font-medium">{t(fieldLabel)}</dt>
        <dd className="whitespace-pre-wrap break-words text-muted-foreground">{revision.fields[key]}</dd>
      </div>)}
    </dl>}
  </section>;
}

async function restoreNotePage(projectId: string, id: string, expectedDeletedAt: number): Promise<NotePage> {
  const response = await apiFetch("/notes/" + encodeURIComponent(id), {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "restore", expectedDeletedAt }),
  }, projectId);
  if (!response.ok) throw new Error("Restore failed");
  const page = await response.json() as NotePage;
  notifyNotePagesChanged(projectId);
  return page;
}

export function NoteReferenceDialog({ projectId, reference, onClose, returnFocus }: {
  projectId: string;
  reference: { id: string; version: number; title: string };
  onClose: () => void;
  returnFocus: HTMLButtonElement;
}) {
  const t = useT();
  const { id, version, title } = reference;
  const [page, setPage] = useState<NotePage>();
  const [loadError, setLoadError] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const notesRevision = useNotePagesRevision(projectId);
  const revision = page?.revisions.find((item) => item.version === version);

  useEffect(() => {
    const controller = new AbortController();
    void apiFetch("/notes/" + encodeURIComponent(id), { signal: controller.signal }, projectId)
      .then(async (response) => {
        if (!response.ok) throw new Error("Note request failed");
        const data = await response.json() as NotePage;
        if (!controller.signal.aborted) {
          setPage(data);
          setLoadError(!data.revisions.some((item) => item.version === version));
        }
      })
      .catch(() => { if (!controller.signal.aborted) setLoadError(true); });
    return () => controller.abort();
  }, [id, notesRevision, projectId, version]);

  async function restore() {
    if (page?.deletedAt === undefined || restoring) return;
    setRestoring(true);
    try {
      setPage(await restoreNotePage(projectId, id, page.deletedAt));
      toast.success(t("Note page restored."));
    } catch {
      toast.error(t("Could not restore the note page."));
    } finally {
      setRestoring(false);
    }
  }

  return <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
    <DialogContent aria-describedby={undefined} className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-2xl"
      onCloseAutoFocus={(event) => { event.preventDefault(); returnFocus.focus(); }}>
      <DialogTitle className="break-words pe-6 leading-snug">{revision?.title ?? title}</DialogTitle>
      {loadError ? <p role="alert" className="text-sm text-destructive">{t("This note page or revision is unavailable.")}</p>
        : page && revision ? <>
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span>{t("Revision {number}", { number: version })}</span>
            <span>{t(NOTE_STATUS_LABELS[revision.status])}</span>
            {page.deletedAt !== undefined && <span className="rounded bg-muted px-1.5 py-0.5">{t("Deleted")}</span>}
          </div>
          <NoteRevisionSummary type={page.type} revision={revision} label="Summary" />
          {page.deletedAt !== undefined && <Button type="button" size="sm" variant="outline" className="justify-self-start"
            disabled={restoring} onClick={() => void restore()}>{t("Restore note page")}</Button>}
        </> : <p role="status" className="text-sm text-muted-foreground">{t("Loading notes…")}</p>}
    </DialogContent>
  </Dialog>;
}

function NotePageDetail({ id, projectId, onOpenSource, onBack, onSaved, onDeleted, initialPage, focusSources }: NotesProps & {
  id: string;
  initialPage?: NotePage;
  focusSources?: boolean;
  onBack: () => void;
  onSaved: () => void;
  onDeleted: () => void;
}) {
  const t = useT();
  const locale = useLocale();
  const { confirm, dialog } = useConfirm();
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

  async function save(action: "edit" | "review" | "delete") {
    if (!latest || pending) return;
    if (action === "delete" && !await confirm({
      title: "Delete this note page?",
      description: "The note page will be hidden from the project notes. Historical conversations can still open the revisions they reference.",
      confirmLabel: "Delete",
      destructive: true,
    })) return;
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
      if (response.status === 410) {
        setEditing(undefined);
        setReload(value => value + 1);
        return;
      }
      if (!response.ok) throw new Error("Save failed");
      const saved = await response.json() as NotePage;
      if (action === "delete" && saved.deletedAt !== undefined) {
        const { deletedAt } = saved;
        const undoToast = toast.success(t("Note page deleted."), {
          duration: Infinity,
          closeButton: true,
          action: {
            label: t("Undo"),
            onClick: (event) => {
              event.preventDefault();
              void restoreNotePage(projectId, id, deletedAt).then(() => {
                toast.dismiss(undoToast);
                toast.success(t("Note page restored."));
              }).catch(() => toast.error(t("Could not restore the note page.")));
            },
          },
        });
        notifyNotePagesChanged(projectId);
        onDeleted();
        return;
      }
      setPage(saved);
      setRevisionNumber(undefined);
      setEditing(undefined);
      onSaved();
    } catch {
      setError(action === "delete" ? "Could not delete the note page." : "Could not save the note page.");
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col">
      {dialog}
      <header className="shrink-0 border-b px-4 py-2.5">
        <div className={noteReadingWidth}>
          <Button type="button" variant="ghost" size="sm" disabled={pending} onClick={onBack}><ArrowLeftIcon aria-hidden="true" />{t("Notes")}</Button>
        </div>
      </header>
      <div className="min-h-0 flex-1 overflow-auto p-4">
        {error && <div role="alert" className="mb-3 flex flex-wrap items-center gap-2 text-sm text-destructive">
          {t(error)}
          <Button type="button" variant="outline" size="sm" onClick={() => { setEditing(undefined); setRevisionNumber(undefined); setReload((value) => value + 1); }}>{t("Reload")}</Button>
        </div>}
        {!page || !revision || !definition ? (!error && <p role="status" className="text-sm">{t("Loading notes…")}</p>) : (
          <article className={cn(noteReadingWidth, "space-y-4")}>
            <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
              <span>{definition.group && `${t(definition.group)} · `}{t(definition.label)}</span>
              <span>{t(NOTE_STATUS_LABELS[revision.status])}</span>
              {page.deletedAt !== undefined && <span className="rounded bg-muted px-1.5 py-0.5">{t("Deleted")}</span>}
              <span>{t(page.organizer)}</span>
              {revision.draftCredit && <span>
                {t("Drafted with {expert}", { expert: t(revision.draftCredit.expert) })}
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
              <NoteRevisionSummary type={page.type} revision={revision} label="Current summary" />
            </>}
            <section ref={sourcesRef} tabIndex={-1} aria-label={t("Sources")} className="space-y-2 border-t pt-3">
              <h3 className="text-sm font-medium">{t("Sources")}</h3>
              {page.sources.length === 0 ? <p className="text-xs text-muted-foreground">{t("No sources yet")}</p> : <ul className="space-y-2">
                {page.sources.map((source) => <li key={source.id} className="space-y-1 rounded-md border p-2">
                  <div className="flex items-start justify-between gap-2">
                    <span className="min-w-0 break-words text-xs"><span className="text-muted-foreground">{t(NOTE_SOURCE_LABELS[source.kind])} · </span>{source.label}
                      {source.kind === "pdfAnnotation" && <> · {t("Page {page}", { page: source.page })}</>}
                    </span>
                    <Button className="shrink-0" size="xs" type="button" variant="ghost" onClick={() => onOpenSource(source)}>
                      <ArrowUpRightIcon aria-hidden="true" />{t(source.kind === "pdfAnnotation" ? "Open PDF annotation"
                        : source.kind === "file" ? "Open current file" : source.kind === "task" ? "Open source task" : "Open source")}
                    </Button>
                  </div>
                  {Boolean(source.recordFlags?.length) && <p className="text-xs text-muted-foreground">
                    {source.recordFlags?.map((flag) => t(NOTE_RECORD_FLAG_LABELS[flag])).join(" · ")}
                  </p>}
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
              {page.deletedAt === undefined && revision === latest && <>
                <Button size="sm" type="button" variant="outline" disabled={pending} onClick={() => setEditing({
                  title: revision.title, summary: revision.summary, fields: revision.fields,
                })}>{t("Edit note page")}</Button>
                {revision.status === "pending" && <Button size="sm" type="button" disabled={pending} onClick={() => void save("review")}>{t("Mark as reviewed")}</Button>}
                <Button size="sm" type="button" variant="ghost" className="ms-auto text-destructive"
                  disabled={pending} onClick={() => void save("delete")}>{t("Delete note page")}</Button>
              </>}
            </div>}
          </article>
        )}
      </div>
    </section>
  );
}
