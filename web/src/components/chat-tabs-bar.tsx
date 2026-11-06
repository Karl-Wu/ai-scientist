"use client";

import { relativeTime } from "@/lib/locale-time";
import { useT, useLocale } from "@/components/i18n-provider";

import {
  DownloadIcon,
  FileTextIcon,
  LoaderCircleIcon,
  MoreHorizontalIcon,
  PencilIcon,
  PlusIcon,
  TerminalIcon,
  Trash2Icon,
} from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";

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
import { resolveChatTitle } from "@/lib/chat-title";

const CHAT_ACTIONS_CLASS =
  "absolute right-1.5 top-1.5 z-10 rounded bg-background/95 p-1 text-muted-foreground opacity-0 pointer-events-none transition-[opacity,color,background-color] " +
  "group-hover/chat-row:opacity-100 group-hover/chat-row:pointer-events-auto " +
  "group-focus-within/chat-row:opacity-100 group-focus-within/chat-row:pointer-events-auto " +
  "data-[state=open]:opacity-100 data-[state=open]:pointer-events-auto " +
  "hover:bg-muted-foreground/10 hover:text-foreground " +
  "[@media(hover:none)]:opacity-100 [@media(hover:none)]:pointer-events-auto";

export interface ChatTabDescriptor {
  id: string;
  title: string;
  titleIsCustom?: boolean;
  isStreaming: boolean;
  userMessageCount: number;
  sessionId?: string | null;
}

export interface ChatTabsBarProps {
  projectId: string;
  width?: number;
  workspaceNavigation?: ReactNode;
  tabs: ChatTabDescriptor[];
  activeTabId: string;
  maxTabs: number;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  onNew: () => void;
  onRename: (id: string, title: string) => void;
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

function sessionTitle(s: SessionListItem, untitled: string): string {
  const raw = (s.name ?? commandPreview(s.firstMessage ?? "")).replace(/\s+/g, " ").trim();
  if (!raw) return untitled;
  return raw.length > 60 ? raw.slice(0, 60) + "…" : raw;
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
  const t = useT();
  const locale = useLocale();
  const [sessions, setSessions] = useState<SessionListItem[] | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftTitle, setDraftTitle] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const deletedSessions = useRef(new Set<string>());
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const { confirm, dialog } = useConfirm();
  const openSessionKey = tabs.map((tab) => `${tab.sessionId ?? tab.id}:${tab.userMessageCount}:${tab.isStreaming}`).join("\u0000");

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
            .filter((s) => s.messageCount > 0 && !deletedSessions.current.has(`${projectId}:${s.id}`))
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
  const deleteChat = async (title: string, tab?: ChatTabDescriptor, sessionId = tab?.sessionId) => {
    if (tab?.isStreaming || deletingId) return;
    const ok = await confirm({
      title: t("Delete “{name}”?", { name: title }),
      description: t("Remove this conversation and its chat history from Recent chats. Project files, notebook entries and cost records are kept."),
      confirmLabel: t("Delete"),
      destructive: true,
    });
    if (!ok) return;
    const deletionKey = sessionId ?? tab?.id ?? title;
    setDeletingId(deletionKey);
    try {
      if (sessionId) {
        const response = await apiFetch(`/sessions/${encodeURIComponent(sessionId)}`, { method: "DELETE" }, projectId);
        if (!response.ok && response.status !== 404) {
          const body = await response.json().catch(() => null);
          throw new Error(body?.detail ?? "Could not delete chat. Please try again.");
        }
        deletedSessions.current.add(`${projectId}:${sessionId}`);
        setSessions((current) => current?.filter((session) => session.id !== sessionId) ?? current);
      }
      if (tab) {
        if (tabs.length === 1) onNewTab();
        onCloseTab(tab.id);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("Could not delete chat. Please try again."));
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <section className="mt-3 min-w-0" aria-label={t("Recent chats")}>
      {dialog}
      <h2 className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        {t("Sessions")}</h2>
      {sessions === null && tabs.length === 0 ? (
        <div className="px-2 py-2 text-[11px] text-muted-foreground">{t("Loading chats…")}</div>
      ) : unpersistedTabs.length === 0 && recentSessions.length === 0 ? (
        <div className="px-2 py-2 text-[11px] leading-relaxed text-muted-foreground">
          {t("No chats yet.")}</div>
      ) : (
        <div className="flex flex-col gap-0.5">
          {unpersistedTabs.map((tab) => {
            const isEditing = editingId === tab.id;
            const isActive = tab.id === activeTabId;
            return (
              <div
                key={tab.id}
                className={cn(
                  "group/chat-row relative flex min-w-0 items-center gap-1 rounded-md px-2 py-1.5 text-xs transition-colors",
                  isActive
                    ? "bg-muted text-foreground"
                    : "text-muted-foreground hover:bg-muted/70 hover:text-foreground",
                )}
              >
                <button
                  type="button"
                  onClick={() => onSelectTab(tab.id)}
                  onDoubleClick={() => startRename(tab)}
                  title={t("{title} — double-click to rename", { title: tab.title })}
                  className="flex w-full min-w-0 flex-1 items-center gap-1 text-left group-hover/chat-row:pr-6 group-focus-within/chat-row:pr-6 [@media(hover:none)]:pr-6"
                >
                  {tab.isStreaming && <LoaderCircleIcon role="status" aria-label={t("Chat is running")} aria-hidden={false} className="size-3 shrink-0 animate-spin text-primary" />}
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
                    <span className="min-w-0 flex-1 truncate">{tab.title}</span>
                  )}
                </button>
                {!isEditing && (
                  <>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button
                          type="button"
                          aria-label={t("Chat actions for {title}", { title: tab.title })}
                          title={t("Chat actions")}
                          className={CHAT_ACTIONS_CLASS}
                        >
                          <MoreHorizontalIcon className="size-3.5" />
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" side="right" className="min-w-36">
                        <DropdownMenuItem onSelect={() => startRename(tab)}>
                          <PencilIcon className="size-3.5" />
                          {t("Rename")}</DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          variant="destructive"
                          disabled={tab.isStreaming || deletingId !== null}
                          onSelect={() => void deleteChat(tab.title, tab)}
                        >
                          <Trash2Icon className="size-3.5" />
                          {t("Delete")}</DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </>
                )}
              </div>
            );
          })}
          {recentSessions.map(({ session, tab }) => {
            const title = sessionTitle(session, t("Untitled chat"));
            const rowTitle = tab ? resolveChatTitle(tab.title, title, tab.titleIsCustom) : title;
            return (
              <div
                key={session.id}
                className={cn(
                  "group/chat-row relative flex w-full min-w-0 items-start gap-1 rounded-md px-2 py-1.5 text-xs transition-colors",
                  tab?.id === activeTabId
                    ? "bg-muted text-foreground"
                    : "text-muted-foreground hover:bg-muted/70 hover:text-foreground",
                )}
              >
                <button
                  type="button"
                  title={`${rowTitle} · ${tab?.isStreaming ? t("Running") : relativeTime(session.modified, locale)}`}
                  onClick={() => tab ? onSelectTab(tab.id) : onOpenSession(session.id, title)}
                  onDoubleClick={() => tab && startRename(tab)}
                  className="flex w-full min-w-0 flex-1 items-start gap-1 text-left group-hover/chat-row:pr-6 group-focus-within/chat-row:pr-6 [@media(hover:none)]:pr-6"
                >
                  {tab?.isStreaming && (
                    <LoaderCircleIcon role="status" aria-label={t("Chat is running")} aria-hidden={false} className="mt-0.5 size-3 shrink-0 animate-spin text-primary" />
                  )}
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
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate">{rowTitle}</span>
                      <span className="text-[10px] text-muted-foreground/75">
                        {relativeTime(session.modified, locale)}
                      </span>
                    </span>
                  )}
                </button>
                {(!tab || editingId !== tab.id) && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button
                        type="button"
                        aria-label={t("Chat actions for {title}", { title: rowTitle })}
                        title={t("Chat actions")}
                        className={CHAT_ACTIONS_CLASS}
                      >
                        <MoreHorizontalIcon className="size-3.5" />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" side="right" className="min-w-36">
                      {tab && (
                        <>
                          <DropdownMenuItem onSelect={() => startRename(tab)}>
                            <PencilIcon className="size-3.5" />
                            {t("Rename")}</DropdownMenuItem>
                          <DropdownMenuSeparator />
                        </>
                      )}
                      <DropdownMenuItem
                        variant="destructive"
                        disabled={tab?.isStreaming || deletingId !== null}
                        onSelect={() => void deleteChat(rowTitle, tab, session.id)}
                      >
                        <Trash2Icon className="size-3.5" />
                        {t("Delete")}</DropdownMenuItem>
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
  const t = useT();
  const vertical = orientation === "vertical";
  return (
    <DropdownMenu>
      <InfoTooltip
        content={
          <>
            <b>{t("Export session")}</b>
            <br />
            {t("Download a reproducible record of this chat — a runnable shell script of every command the agent ran, or a full lab notebook.")}</>
        }
      >
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label={t("Export session")}
            className={cn(
              "flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground",
              vertical && "w-full justify-start",
            )}
          >
            <DownloadIcon className="size-3.5" />
            {t("Export")}</button>
        </DropdownMenuTrigger>
      </InfoTooltip>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuLabel>{t("Reproducibility export")}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => downloadExport(projectId, sessionId, "sh")}>
          <TerminalIcon className="size-4" />
          <div className="flex flex-col">
            <span>{t("Shell script (.sh)")}</span>
            <span className="text-[11px] text-muted-foreground">
              {t("Every command, in order")}</span>
          </div>
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => downloadExport(projectId, sessionId, "md")}>
          <FileTextIcon className="size-4" />
          <div className="flex flex-col">
            <span>{t("Lab notebook (.md)")}</span>
            <span className="text-[11px] text-muted-foreground">
              {t("Prompts, commands & outputs")}</span>
          </div>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function ChatTabsBar({
  projectId,
  width = 136,
  workspaceNavigation,
  tabs,
  activeTabId,
  maxTabs,
  onSelect,
  onClose,
  onNew,
  onRename,
  onOpenSession,
  activeSessionId,
  canExport = false,
}: ChatTabsBarProps) {
  const t = useT();
  const atLimit = tabs.length >= maxTabs;

  return (
    <div
      className="flex h-full shrink-0 flex-col border-r border-border bg-muted/20 p-2 lg:border-r-0"
      style={{ width }}
    >
      <InfoTooltip
        content={
          atLimit ? (
            <>
              <b>{t("Tab limit reached")}</b>
              <br />
              You can have up to {maxTabs} chat tabs running at once. Close
              one to open a new one.
            </>
          ) : (
            <>
              <b>{t("New chat")}</b>
              <br />
              {t("Open another chat in this project.")}</>
          )
        }
      >
        <button
          onClick={onNew}
          type="button"
          disabled={atLimit}
          aria-label={t("New chat tab")}
          className="flex h-9 shrink-0 items-center gap-2 rounded-lg bg-muted px-2.5 text-xs font-medium text-foreground transition-colors hover:bg-muted/80 disabled:opacity-40"
        >
          <PlusIcon className="size-3.5" />
          <span>{t("New chat")}</span>
        </button>
      </InfoTooltip>
      <div className="mt-2 min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-hidden">
        {workspaceNavigation && (
          <section className="mb-5 mt-3 min-w-0" aria-label={t("Workspace")}>
            <h2 className="px-2 pb-2 text-[10px] font-medium text-muted-foreground">{t("Workspace")}</h2>
            {workspaceNavigation}
          </section>
        )}
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

      {canExport && activeSessionId && (
        <div className="mt-auto flex shrink-0 flex-col border-t pt-2">
          <ExportMenu
            projectId={projectId}
            sessionId={activeSessionId}
            orientation="vertical"
          />
        </div>
      )}
    </div>
  );
}
