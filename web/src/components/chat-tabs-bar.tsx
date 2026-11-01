"use client";

import {
  DownloadIcon,
  FileTextIcon,
  LoaderCircleIcon,
  MoreHorizontalIcon,
  PencilIcon,
  PlusIcon,
  TerminalIcon,
  Trash2Icon,
  WorkflowIcon,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { InfoTooltip } from "@/components/ui/info-tooltip";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { apiFetch } from "@/lib/projects";
import { cn } from "@/lib/utils";
import { commandPreview } from "@/lib/command-blocks";

export interface ChatTabDescriptor {
  id: string;
  title: string;
  isStreaming: boolean;
  userMessageCount: number;
  sessionId?: string | null;
}

export interface ChatTabsBarProps {
  projectId: string;
  width?: number;
  tabs: ChatTabDescriptor[];
  activeTabId: string;
  view: "chat" | "workflows";
  maxTabs: number;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  onNew: () => void;
  onRename: (id: string, title: string) => void;
  onSelectWorkflows: () => void;
  /** Reopen a stored session (from the History menu) into a tab. */
  onOpenSession: (sessionId: string, title: string) => void;
  /** Session id of the active tab, for reproducibility export. */
  activeSessionId?: string | null;
  /** Whether the active tab has any messages worth exporting. */
  canExport?: boolean;
}

interface SessionListItem {
  id: string;
  name: string | null;
  created: string | number;
  modified: string | number;
  messageCount: number;
  firstMessage?: string | null;
}

function sessionTitle(s: SessionListItem): string {
  const raw = (s.name ?? commandPreview(s.firstMessage ?? "")).replace(/\s+/g, " ").trim();
  if (!raw) return "Untitled chat";
  return raw.length > 60 ? raw.slice(0, 60) + "…" : raw;
}

function relativeTime(value: string | number): string {
  const then = new Date(value).getTime();
  if (!Number.isFinite(then)) return "";
  const mins = Math.round((Date.now() - then) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return days < 7 ? `${days}d ago` : new Date(then).toLocaleDateString();
}

/** Unified list of open tabs and saved conversations, ordered by recent activity. */
function RecentChatsList({
  projectId,
  tabs,
  activeTabId,
  onSelectTab,
  onCloseTab,
  onNewTab,
  onRenameTab,
  onOpenSession,
}: {
  projectId: string;
  tabs: ChatTabDescriptor[];
  activeTabId: string;
  onSelectTab: (id: string) => void;
  onCloseTab: (id: string) => void;
  onNewTab: () => void;
  onRenameTab: (id: string, title: string) => void;
  onOpenSession: (sessionId: string, title: string) => void;
}) {
  const [sessions, setSessions] = useState<SessionListItem[] | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftTitle, setDraftTitle] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const { confirm, dialog } = useConfirm();
  const openSessionIds = tabs.flatMap((tab) => tab.sessionId ? [tab.sessionId] : []);
  const openSessionKey = openSessionIds.join("\u0000");

  useEffect(() => {
    if (editingId && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editingId]);

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      apiFetch("/sessions", {}, projectId)
        .then((r) => (r.ok ? r.json() : []))
        .then((list: SessionListItem[]) => {
          if (cancelled) return;
          const sorted = [...list]
            .filter((s) => s.messageCount > 0)
            .sort(
              (a, b) =>
                new Date(b.modified).getTime() - new Date(a.modified).getTime(),
            );
          setSessions(sorted);
        })
        .catch(() => {
          if (!cancelled) setSessions([]);
        });
    };
    load();
    const interval = window.setInterval(load, 30_000);
    window.addEventListener("focus", load);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
      window.removeEventListener("focus", load);
    };
  }, [openSessionKey, projectId]);

  const openBySessionId = new Map(
    tabs.flatMap((tab) => tab.sessionId ? [[tab.sessionId, tab] as const] : []),
  );
  const saved = sessions ?? [];
  const savedIds = new Set(saved.map((session) => session.id));
  const unpersistedTabs = [...tabs]
    .filter((tab) => !tab.sessionId || !savedIds.has(tab.sessionId))
    .reverse();
  const recentSessions = saved.map((session) => ({
    session,
    tab: openBySessionId.get(session.id),
  }));
  const startRename = (tab: ChatTabDescriptor) => {
    setEditingId(tab.id);
    setDraftTitle(tab.title);
  };
  const commitRename = () => {
    if (!editingId) return;
    const next = draftTitle.trim();
    if (next) onRenameTab(editingId, next);
    setEditingId(null);
    setDraftTitle("");
  };
  const deleteTab = async (tab: ChatTabDescriptor) => {
    const ok = await confirm({
      title: `Delete “${tab.title}”?`,
      description: "This removes the chat from the open chats list.",
      confirmLabel: "Delete",
      destructive: true,
    });
    if (!ok) return;
    if (tabs.length === 1) onNewTab();
    onCloseTab(tab.id);
  };

  return (
    <section className="mt-3 min-w-0" aria-label="Recent chats">
      {dialog}
      <h2 className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        Recent
      </h2>
      {sessions === null && tabs.length === 0 ? (
        <div className="px-2 py-2 text-[11px] text-muted-foreground">Loading chats…</div>
      ) : unpersistedTabs.length === 0 && recentSessions.length === 0 ? (
        <div className="px-2 py-2 text-[11px] leading-relaxed text-muted-foreground">
          No chats yet.
        </div>
      ) : (
        <div className="flex flex-col gap-0.5">
          {unpersistedTabs.map((tab) => {
            const isEditing = editingId === tab.id;
            const isActive = tab.id === activeTabId;
            return (
              <div
                key={tab.id}
                className={cn(
                  "group flex min-w-0 items-center gap-1 rounded-md px-2 py-1.5 text-xs transition-colors",
                  isActive
                    ? "bg-muted text-foreground"
                    : "text-muted-foreground hover:bg-muted/70 hover:text-foreground",
                )}
              >
                <button
                  type="button"
                  onClick={() => onSelectTab(tab.id)}
                  onDoubleClick={() => startRename(tab)}
                  title={`${tab.title} — double-click to rename`}
                  className="flex min-w-0 flex-1 items-center gap-1 text-left"
                >
                  {tab.isStreaming && <LoaderCircleIcon className="size-3 shrink-0 animate-spin text-primary" />}
                  {isEditing ? (
                    <input
                      ref={inputRef}
                      value={draftTitle}
                      onChange={(event) => setDraftTitle(event.target.value)}
                      onBlur={commitRename}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") commitRename();
                        if (event.key === "Escape") {
                          setEditingId(null);
                          setDraftTitle("");
                        }
                        event.stopPropagation();
                      }}
                      onClick={(event) => event.stopPropagation()}
                      className="min-w-0 flex-1 bg-transparent text-xs outline-none"
                      maxLength={40}
                    />
                  ) : (
                    <span className="truncate">{tab.title}</span>
                  )}
                </button>
                {!isEditing && (
                  <>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button
                          type="button"
                          aria-label={`Chat actions for ${tab.title}`}
                          title="Chat actions"
                          className="shrink-0 rounded p-1 text-muted-foreground transition-colors hover:bg-muted-foreground/10 hover:text-foreground"
                        >
                          <MoreHorizontalIcon className="size-3.5" />
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" side="right" className="min-w-36">
                        <DropdownMenuItem onSelect={() => startRename(tab)}>
                          <PencilIcon className="size-3.5" />
                          Rename
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          variant="destructive"
                          onSelect={() => void deleteTab(tab)}
                        >
                          <Trash2Icon className="size-3.5" />
                          Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </>
                )}
              </div>
            );
          })}
          {recentSessions.map(({ session, tab }) => {
            const title = sessionTitle(session);
            const rowTitle = tab?.title ?? title;
            return (
              <div
                key={session.id}
                className={cn(
                  "group flex w-full min-w-0 items-start gap-1 rounded-md px-2 py-1.5 text-xs transition-colors",
                  tab?.id === activeTabId
                    ? "bg-muted text-foreground"
                    : "text-muted-foreground hover:bg-muted/70 hover:text-foreground",
                )}
              >
                <button
                  type="button"
                  title={`${rowTitle} · ${relativeTime(session.modified)}`}
                  onClick={() => tab ? onSelectTab(tab.id) : onOpenSession(session.id, title)}
                  onDoubleClick={() => tab && startRename(tab)}
                  className="flex min-w-0 flex-1 items-start gap-1 text-left"
                >
                  {editingId === tab?.id && tab ? (
                    <input
                      ref={inputRef}
                      value={draftTitle}
                      onChange={(event) => setDraftTitle(event.target.value)}
                      onBlur={commitRename}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") commitRename();
                        if (event.key === "Escape") {
                          setEditingId(null);
                          setDraftTitle("");
                        }
                        event.stopPropagation();
                      }}
                      onClick={(event) => event.stopPropagation()}
                      className="min-w-0 flex-1 bg-transparent text-xs outline-none"
                      maxLength={40}
                    />
                  ) : (
                    <span className="flex min-w-0 flex-col">
                      <span className="truncate">{rowTitle}</span>
                      <span className="text-[10px] text-muted-foreground/75">
                        {relativeTime(session.modified)}
                      </span>
                    </span>
                  )}
                </button>
                {tab && editingId !== tab.id && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button
                        type="button"
                        aria-label={`Chat actions for ${rowTitle}`}
                        title="Chat actions"
                        className="shrink-0 rounded p-1 text-muted-foreground transition-colors hover:bg-muted-foreground/10 hover:text-foreground"
                      >
                        <MoreHorizontalIcon className="size-3.5" />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" side="right" className="min-w-36">
                      <DropdownMenuItem onSelect={() => startRename(tab)}>
                        <PencilIcon className="size-3.5" />
                        Rename
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        variant="destructive"
                        onSelect={() => void deleteTab(tab)}
                      >
                        <Trash2Icon className="size-3.5" />
                        Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

/** Fetch an export and trigger a browser download (X-Project-Id via apiFetch). */
async function downloadExport(
  projectId: string,
  sessionId: string,
  format: "sh" | "md",
) {
  try {
    const res = await apiFetch(
      `/sessions/${encodeURIComponent(sessionId)}/export?format=${format}`,
      {},
      projectId,
    );
    if (!res.ok) return;
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `session-${sessionId}.${format}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  } catch {
    // best-effort download; nothing actionable to surface
  }
}

function ExportMenu({
  projectId,
  sessionId,
  orientation = "horizontal",
}: {
  projectId: string;
  sessionId: string;
  orientation?: "horizontal" | "vertical";
}) {
  const vertical = orientation === "vertical";
  return (
    <DropdownMenu>
      <InfoTooltip
        content={
          <>
            <b>Export session</b>
            <br />
            Download a reproducible record of this chat — a runnable shell
            script of every command the agent ran, or a full lab notebook.
          </>
        }
      >
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label="Export session"
            className={cn(
              "flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground",
              vertical && "w-full justify-start",
            )}
          >
            <DownloadIcon className="size-3.5" />
            Export
          </button>
        </DropdownMenuTrigger>
      </InfoTooltip>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuLabel>Reproducibility export</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => downloadExport(projectId, sessionId, "sh")}>
          <TerminalIcon className="size-4" />
          <div className="flex flex-col">
            <span>Shell script (.sh)</span>
            <span className="text-[11px] text-muted-foreground">
              Every command, in order
            </span>
          </div>
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => downloadExport(projectId, sessionId, "md")}>
          <FileTextIcon className="size-4" />
          <div className="flex flex-col">
            <span>Lab notebook (.md)</span>
            <span className="text-[11px] text-muted-foreground">
              Prompts, commands & outputs
            </span>
          </div>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function ChatTabsBar({
  projectId,
  width = 136,
  tabs,
  activeTabId,
  view,
  maxTabs,
  onSelect,
  onClose,
  onNew,
  onRename,
  onSelectWorkflows,
  onOpenSession,
  activeSessionId,
  canExport = false,
}: ChatTabsBarProps) {
  const atLimit = tabs.length >= maxTabs;

  return (
    <div
      className="flex h-full shrink-0 flex-col border-r border-border bg-muted/10 p-2 lg:border-r-0"
      style={{ width }}
    >
      <InfoTooltip
        content={
          atLimit ? (
            <>
              <b>Tab limit reached</b>
              <br />
              You can have up to {maxTabs} chat tabs running at once. Close
              one to open a new one.
            </>
          ) : (
            <>
              <b>New chat</b>
              <br />
              Open another chat in this project.
            </>
          )
        }
      >
        <button
          onClick={onNew}
          type="button"
          disabled={atLimit}
          aria-label="New chat tab"
          className="flex h-9 shrink-0 items-center gap-2 rounded-md bg-primary px-2.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-40"
        >
          <PlusIcon className="size-3.5" />
          <span>New chat</span>
        </button>
      </InfoTooltip>
      <div className="mt-2 min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-hidden">
        <RecentChatsList
          projectId={projectId}
          tabs={tabs}
          activeTabId={activeTabId}
          onSelectTab={onSelect}
          onCloseTab={onClose}
          onNewTab={onNew}
          onRenameTab={onRename}
          onOpenSession={onOpenSession}
        />
      </div>

      <div className="mt-auto flex shrink-0 flex-col gap-1 border-t pt-2">
        {view === "chat" && canExport && activeSessionId && (
          <ExportMenu
            projectId={projectId}
            sessionId={activeSessionId}
            orientation="vertical"
          />
        )}
        <InfoTooltip
          content={
            <>
              <b>Workflows</b>
              <br />
              Pre-built scientific pipelines (e.g. RNA-seq, literature
              review). Pick a template, attach inputs, and launch — they
              run in the active chat tab.
            </>
          }
        >
          <button
            onClick={onSelectWorkflows}
            type="button"
            className={cn(
              "flex w-full items-center justify-start gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors",
              view === "workflows"
                ? "bg-muted text-foreground"
                : "text-muted-foreground hover:text-foreground hover:bg-muted/50",
            )}
          >
            <WorkflowIcon className="size-3.5" />
            Workflows
          </button>
        </InfoTooltip>
      </div>
    </div>
  );
}
