"use client";

import { useLocale, useT } from "@/components/i18n-provider";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  BookOpenIcon,
  CheckIcon,
  LoaderIcon,
  MessagesSquareIcon,
  SearchIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { apiFetch } from "@/lib/projects";
import { NOTE_STATUS_LABELS, NOTE_TYPES, noteTypesIn, type NoteSummary, type NoteType } from "@/lib/note-pages";
import { relativeTime } from "@/lib/locale-time";
import { commandPreview } from "@/lib/command-blocks";
import {
  researchRefKey,
  type ResearchRef,
} from "@/lib/composer-context";

type Mode = "notes" | "chats";

interface Row {
  ref: ResearchRef;
  excerpt?: string;
  meta: string;
}

interface SessionListItem {
  id: string;
  name: string | null;
  modified: string | number;
  messageCount: number;
  firstMessage?: string | null;
}

function chatTitle(s: SessionListItem): string {
  const raw = (s.name ?? commandPreview(s.firstMessage ?? "")).replace(/\s+/g, " ").trim();
  return raw || "Untitled task";
}

async function fetchNotePages(projectId: string, search: string, signal: AbortSignal): Promise<NoteSummary[] | null> {
  try {
    const url = search ? `/notes?${new URLSearchParams({ q: search })}` : "/notes";
    const response = await apiFetch(url, { signal, cache: "no-store" }, projectId);
    if (!response.ok) return null;
    const { pages } = (await response.json()) as { pages: NoteSummary[] };
    return pages;
  } catch {
    return null;
  }
}

/** Pick project note revisions and earlier tasks as context for the next message. */
export function ResearchPickerBody({
  projectId,
  currentSessionId,
  selected,
  onChange,
  autoFocus = false,
}: {
  projectId: string;
  currentSessionId: string | null;
  selected: ResearchRef[];
  onChange: (refs: ResearchRef[]) => void;
  autoFocus?: boolean;
}) {
  const t = useT();
  const locale = useLocale();
  const [mode, setMode] = useState<Mode>("notes");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<NoteType | "all">("all");
  const [projectNotes, setProjectNotes] = useState<{ projectId: string; pages: NoteSummary[] | null }>();
  const [searchResults, setSearchResults] = useState<{ projectId: string; search: string; pages: NoteSummary[] | null }>();
  const [sessions, setSessions] = useState<SessionListItem[] | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const search = query.trim();

  const selectedByKey = useMemo(() => new Map(selected.map((ref) => [researchRefKey(ref), ref])), [selected]);

  useEffect(() => {
    if (!autoFocus) return;
    const t = setTimeout(() => inputRef.current?.focus(), 50);
    return () => clearTimeout(t);
  }, [autoFocus, mode]);

  useEffect(() => {
    if (mode !== "notes") return;
    const controller = new AbortController();
    void fetchNotePages(projectId, "", controller.signal).then((pages) => {
      if (!controller.signal.aborted) setProjectNotes({ projectId, pages });
    });
    return () => controller.abort();
  }, [mode, projectId]);

  useEffect(() => {
    if (mode !== "notes" || !search) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      const pages = await fetchNotePages(projectId, search, controller.signal);
      if (!controller.signal.aborted) setSearchResults({ projectId, search, pages });
    }, 150);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [mode, search, projectId]);

  useEffect(() => {
    if (mode !== "chats" || sessions !== null) return;
    let cancelled = false;
    apiFetch("/sessions", {}, projectId)
      .then((r) => (r.ok ? r.json() : []))
      .then((list: SessionListItem[]) => {
        if (!cancelled) setSessions(Array.isArray(list) ? list : []);
      })
      .catch(() => {
        if (!cancelled) setSessions([]);
      });
    return () => {
      cancelled = true;
    };
  }, [mode, projectId, sessions]);

  const chatRows = useMemo<Row[] | null>(() => {
    if (!sessions) return null;
    const q = query.trim().toLowerCase();
    return sessions
      .filter((s) => s.messageCount > 0 && s.id !== currentSessionId)
      .sort((a, b) => new Date(b.modified).getTime() - new Date(a.modified).getTime())
      .map((s) => ({ s, title: chatTitle(s) }))
      .filter(({ title }) => !q || title.toLowerCase().includes(q))
      .map(({ s, title }) => ({
        ref: { kind: "chat" as const, sessionId: s.id, title },
        meta: [relativeTime(new Date(s.modified).getTime(), locale), `${s.messageCount} messages`].filter(Boolean).join(" · "),
      }));
  }, [sessions, query, currentSessionId, locale]);

  const toggle = (ref: ResearchRef) => {
    const key = researchRefKey(ref);
    onChange(
      selectedByKey.has(key)
        ? selected.filter((r) => researchRefKey(r) !== key)
        : [...selected, ref],
    );
  };

  const allNotes = projectNotes?.projectId === projectId ? projectNotes.pages : undefined;
  const availableTypes = useMemo(() => noteTypesIn(allNotes ?? undefined), [allNotes]);
  const activeFilter = filter !== "all" && availableTypes.includes(filter) ? filter : "all";
  const matchingNotes = searchResults?.projectId === projectId && searchResults.search === search ? searchResults.pages : undefined;
  const currentNotes = search ? matchingNotes : allNotes;
  const noteRows = currentNotes?.filter((page) => activeFilter === "all" || page.type === activeFilter).map<Row>((page) => ({
    ref: { kind: "note", id: page.id, type: page.type, version: page.version, title: page.title },
    excerpt: page.excerpt.replace(/\s+/g, " "),
    meta: [page.status === "pending" ? t(NOTE_STATUS_LABELS.pending) : "", relativeTime(page.savedAt, locale)].filter(Boolean).join(" · "),
  }));
  const visible = mode === "notes" ? noteRows : chatRows;
  const error = mode === "notes" && currentNotes === null;
  const idleNotes = mode === "notes" && !search && activeFilter === "all";

  return (
    <>
      <div className="flex items-center gap-2 border-b px-3 py-2">
        <SearchIcon className="size-3.5 shrink-0 text-muted-foreground" />
        <input
          ref={inputRef}
          value={query}
          maxLength={300}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={
            mode === "notes"
              ? t("Search note pages")
              : t("Filter earlier tasks…")
          }
          aria-label={mode === "notes" ? t("Search note pages") : t("Filter earlier tasks")}
          className="min-w-0 flex-1 bg-transparent text-xs outline-none placeholder:text-muted-foreground"
        />
        <div className="flex shrink-0 rounded-md border p-0.5" role="radiogroup" aria-label={t("Context source")}>
          {(
            [
              { id: "notes", label: t("Notes"), icon: BookOpenIcon },
              { id: "chats", label: t("Tasks"), icon: MessagesSquareIcon },
            ] as const
          ).map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={mode === id}
              onClick={() => {
                if (id === mode) return;
                setMode(id);
                setQuery("");
              }}
              className={cn(
                "flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium transition-colors",
                mode === id
                  ? "bg-muted text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <Icon className="size-3" />
              {label}
            </button>
          ))}
        </div>
      </div>

      {mode === "notes" && availableTypes.length > 0 && (
        <div className="flex flex-wrap gap-1 border-b px-3 py-1.5">
          {(["all", ...availableTypes] as const).map((id) => (
            <button
              key={id}
              type="button"
              onClick={() => setFilter(id)}
              aria-pressed={activeFilter === id}
              className={cn(
                "rounded-full border px-2 py-0.5 text-[10px] font-medium transition-colors",
                activeFilter === id
                  ? "border-primary/40 bg-primary/10 text-foreground"
                  : "border-transparent text-muted-foreground hover:bg-muted/60 hover:text-foreground",
              )}
            >
              {t(id === "all" ? "All" : NOTE_TYPES[id].label)}
            </button>
          ))}
        </div>
      )}

      <div className="max-h-72 overflow-y-auto py-1">
        {idleNotes && noteRows && noteRows.length > 0 && (
          <div className="px-3 pt-1 pb-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground/70">
            {t("Recent note pages")}
          </div>
        )}
        {error ? (
          <div role="alert" className="px-3 py-6 text-center text-xs text-destructive">
            {t("Could not load notes.")}
          </div>
        ) : !visible ? (
          <div role="status" className="flex items-center justify-center gap-2 py-8 text-xs text-muted-foreground">
            <LoaderIcon className="size-3.5 animate-spin" /> {t("Loading…")}
          </div>
        ) : visible.length === 0 ? (
          <div className="px-6 py-8 text-center text-xs text-muted-foreground">
            {mode === "chats"
              ? query.trim()
                ? t("No matching tasks.")
                : t("No other tasks in this project yet.")
              : idleNotes
                ? t("No note pages yet")
                : t("No matching note pages")}
          </div>
        ) : (
          visible.map((row) => {
            const key = researchRefKey(row.ref);
            const picked = selectedByKey.get(key);
            const isSelected = Boolean(picked);
            const earlierRevision = picked?.kind === "note" && row.ref.kind === "note" && picked.version !== row.ref.version;
            return (
              <div
                key={key}
                role="checkbox"
                aria-checked={isSelected}
                tabIndex={0}
                onClick={() => toggle(row.ref)}
                onKeyDown={(e) => {
                  if (e.key === " " || e.key === "Enter") {
                    e.preventDefault();
                    toggle(row.ref);
                  }
                }}
                className={cn(
                  "flex cursor-pointer items-start gap-2.5 px-3 py-2 text-xs transition-colors hover:bg-muted/60 focus-visible:bg-muted/60 focus-visible:outline-none",
                  isSelected && "bg-muted/40",
                )}
              >
                <div
                  className={cn(
                    "mt-0.5 flex size-3.5 shrink-0 items-center justify-center rounded border transition-colors",
                    isSelected
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border bg-background",
                  )}
                >
                  {isSelected && <CheckIcon className="size-2.5" />}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 items-center gap-1.5">
                    {row.ref.kind === "note" && (
                      <span className="shrink-0 rounded bg-sky-500/10 px-1 py-px text-[9px] font-semibold uppercase tracking-wide text-sky-700 dark:text-sky-400">
                        {t(NOTE_TYPES[row.ref.type].label)}
                      </span>
                    )}
                    <span className="truncate font-medium text-foreground">{row.ref.title}</span>
                  </div>
                  {row.excerpt && (
                    <p className="mt-0.5 line-clamp-2 leading-relaxed text-muted-foreground/80">
                      {row.excerpt}
                    </p>
                  )}
                  {row.meta && (
                    <p className="mt-0.5 text-[10px] text-muted-foreground/70">{row.meta}</p>
                  )}
                  {earlierRevision && <p className="mt-0.5 text-[10px] text-muted-foreground">
                    {t("Selected revision {version}", { version: picked.version })}
                  </p>}
                </div>
              </div>
            );
          })
        )}
      </div>

      <div className="flex items-center justify-between gap-3 border-t px-3 py-1.5">
        <span className="text-[10px] text-muted-foreground">
          {mode === "notes"
            ? t("Selected notes are read as context for the next message.")
            : t("AI Scientist reads a compact snapshot of each picked task, taken when you send.")}
        </span>
        {selected.length > 0 && (
          <button
            type="button"
            onClick={() => onChange([])}
            className="whitespace-nowrap text-[10px] text-muted-foreground transition-colors hover:text-destructive"
          >
            {t("Clear selection ({count})", { count: selected.length })}
          </button>
        )}
      </div>
    </>
  );
}
