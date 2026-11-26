"use client";
import { useEffect, useState } from "react";
import { CheckIcon, CopyIcon, GitBranchIcon, LoaderCircleIcon, NotebookPenIcon, ThumbsDownIcon, ThumbsUpIcon } from "lucide-react";
import { toast } from "sonner";
import { useT } from "@/components/i18n-provider";
import { MessageAction } from "@/components/ai-elements/message";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { apiFetch } from "@/lib/projects";
import { suggestedChatTitle } from "@/lib/chat-title";
import type { NoteCreationSource } from "@/lib/note-pages";
import { notifyTaskResponsesChanged, type AnswerFeedback, type TaskResponse } from "@/lib/use-task-responses";

export type OpenTask = (sessionId: string, title: string, entryId?: string) => void;
export function AnswerActions({ projectId, sessionId, response, canFork, copied, onCopy, onOpenTask, onCreateNote }: {
  projectId: string; sessionId: string | null; response?: TaskResponse; canFork: boolean;
  copied: boolean; onCopy: () => void; onOpenTask?: OpenTask;
  onCreateNote?: (source: NoteCreationSource) => void;
}) {
  const t = useT();
  const [busy, setBusy] = useState<"vote" | "fork" | null>(null);
  const [feedback, setFeedback] = useState(response?.feedback ?? null);
  useEffect(() => { setFeedback(response?.feedback ?? null); }, [response?.entryId, response?.feedback]);
  const vote = async (choice: Exclude<AnswerFeedback, null>) => {
    if (!response || !sessionId || busy) return;
    setBusy("vote");
    const previous = feedback;
    const next = feedback === choice ? null : choice;
    setFeedback(next);
    try {
      const res = await apiFetch(`/sessions/${encodeURIComponent(sessionId)}/responses/${encodeURIComponent(response.entryId)}/feedback`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ feedback: next }),
      }, projectId);
      if (!res.ok) throw new Error();
      notifyTaskResponsesChanged(projectId);
    } catch { setFeedback(previous); toast.error(t("Could not save feedback. Please try again.")); }
    finally { setBusy(null); }
  };
  const fork = async () => {
    if (!response || !sessionId || busy || !canFork) return;
    setBusy("fork");
    try {
      const res = await apiFetch(`/sessions/${encodeURIComponent(sessionId)}/responses/${encodeURIComponent(response.entryId)}/fork`, { method: "POST" }, projectId);
      if (!res.ok) throw new Error();
      const task = await res.json() as { id: string; name: string };
      notifyTaskResponsesChanged(projectId);
      window.dispatchEvent(new Event("kady:tasks-changed"));
      onOpenTask?.(task.id, task.name);
    } catch { toast.error(t("Could not create the follow-up task. Please try again when the task is idle.")); }
    finally { setBusy(null); }
  };
  const disabled = !response || busy !== null;
  const forkControl = (
    <MessageAction tooltip={t("New task from here")} disabled={disabled || !canFork} onClick={() => void fork()}>
      {busy === "fork" ? <LoaderCircleIcon aria-hidden="true" className="size-4 animate-spin" />
        : <GitBranchIcon aria-hidden="true" className="size-4" />}
    </MessageAction>
  );
  return <>
    <MessageAction tooltip={t("Like")} aria-pressed={feedback === "up"} disabled={disabled}
      className={feedback === "up" ? "bg-primary/10 text-primary" : undefined} onClick={() => void vote("up")}>
      <ThumbsUpIcon className="size-4" />
    </MessageAction>
    <MessageAction tooltip={t("Dislike")} aria-pressed={feedback === "down"} disabled={disabled}
      className={feedback === "down" ? "bg-primary/10 text-primary" : undefined} onClick={() => void vote("down")}>
      <ThumbsDownIcon className="size-4" />
    </MessageAction>
    <MessageAction tooltip={t("Copy")} onClick={onCopy}>
      {copied ? <CheckIcon className="size-4" /> : <CopyIcon className="size-4" />}
    </MessageAction>
    {onOpenTask && <>
      <span className="mx-1 h-4 border-l" aria-hidden />
      {response?.children.length ? <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button type="button" className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground">
            <GitBranchIcon className="size-4" />{t("Follow-up tasks")}{" "}
            <span className="rounded-full bg-muted px-1.5 tabular-nums">{response.children.length}</span>
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="max-h-72 w-72 overflow-y-auto">
          <DropdownMenuLabel>{t("Tasks from this answer")}</DropdownMenuLabel>
          {response.children.map((task) => <DropdownMenuItem key={task.id} onSelect={() => onOpenTask(task.id, task.name)}>
            <GitBranchIcon className="size-3.5 shrink-0" /><span className="truncate">{task.name}</span>
            <span className="ml-auto text-xs text-muted-foreground">{t("Open")}</span>
          </DropdownMenuItem>)}
          <DropdownMenuSeparator />
          <DropdownMenuItem disabled={busy !== null || !canFork} onSelect={() => void fork()}><GitBranchIcon className="size-3.5" />{t("New task")}</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu> : forkControl}
    </>}
    {response && sessionId && onCreateNote && <Button type="button" variant="ghost" size="sm"
      className="px-2 text-xs font-normal has-[>svg]:px-2"
      onClick={() => onCreateNote({ title: suggestedChatTitle(response.content) ?? t("Answer"),
        anchor: { kind: "message", sessionId, entryId: response.entryId } })}>
      <NotebookPenIcon aria-hidden="true" className="size-4" />{t("Create note from this answer")}
    </Button>}
  </>;
}
