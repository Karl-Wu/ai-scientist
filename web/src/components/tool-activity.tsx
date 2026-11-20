"use client";

import { useLocale, useT } from "@/components/i18n-provider";

import {
  BookOpenIcon,
  CheckIcon,
  ChevronRightIcon,
  ClockIcon,
  FileEditIcon,
  FileIcon,
  FilePlusIcon,
  FolderTreeIcon,
  HelpCircleIcon,
  ImagePlusIcon,
  SearchIcon,
  ServerCogIcon,
  TerminalIcon,
  UsersIcon,
  WandSparklesIcon,
  WrenchIcon,
  XIcon,
} from "lucide-react";
import { memo } from "react";

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Spinner } from "@/components/ui/spinner";
import { ToolResultImages } from "@/components/scientific-result-card";
import { modalJobIdFromActivity, openModalJob } from "@/lib/modal-jobs";
import { skillNameFromRead } from "@/lib/skill-invocation";
import type { ActivityItem } from "@/lib/use-agent";
import { cn } from "@/lib/utils";
import { workflowScriptAgents } from "@/lib/workflow-script";

function ToolIcon({ toolName }: { toolName?: string }) {
  const className = "size-3.5 shrink-0 text-muted-foreground";
  switch (toolName) {
    case "bash":
      return <TerminalIcon className={className} />;
    case "read":
      return <FileIcon className={className} />;
    case "write":
      return <FilePlusIcon className={className} />;
    case "edit":
      return <FileEditIcon className={className} />;
    case "grep":
    case "find":
      return <SearchIcon className={className} />;
    case "ls":
      return <FolderTreeIcon className={className} />;
    case "subagent":
    case "bg_wait":
    case "subagent_wait":
      return <UsersIcon className={className} />;
    case "generate_image":
      return <ImagePlusIcon className={className} />;
    default:
      return <WrenchIcon className={className} />;
  }
}

function subagentNames(
  args: Record<string, unknown>,
  result: string | undefined,
  replyScript: string | undefined,
): string[] {
  const names: string[] = [];
  const add = (value: unknown) => {
    if (typeof value === "string" && value.trim() && !names.includes(value.trim())) {
      names.push(value.trim());
    }
  };

  add(args.agent);
  if (Array.isArray(args.tasks)) {
    for (const task of args.tasks) {
      if (task && typeof task === "object") {
        add((task as Record<string, unknown>).agent);
      }
    }
  }
  // Children are declared in a workflow script as `runs.run(key, { agent:
  // "name", task })`; read the literals. Since pi-subagents 0.74 the script is
  // the block of the reply that called `workflow: true`; earlier sessions
  // passed it as the `workflowScript` argument.
  if (typeof args.workflowScript === "string") workflowScriptAgents(args.workflowScript).forEach(add);
  if ((args.workflow === true || args.workflow === "true") && replyScript) workflowScriptAgents(replyScript).forEach(add);
  // pi-subagents' own named workflows take their children as data (0.77+).
  if (args.workflow === "review") add("reviewer");
  const workflowArgs = args.args as { tasks?: unknown } | undefined;
  if (args.workflow === "parallel" && Array.isArray(workflowArgs?.tasks)) {
    for (const task of workflowArgs.tasks) {
      if (task && typeof task === "object") add((task as Record<string, unknown>).agent);
    }
  }

  if (result) {
    const asyncNames = /^Async (?:parallel|single): \[([^\]]+)\]/m.exec(result)?.[1];
    if (asyncNames) asyncNames.split("+").forEach(add);
    // pi-subagents ≥0.65 receipt: "Async single run (agent) …"
    const asyncSingle = /^Async single run \(([A-Za-z0-9][A-Za-z0-9._-]*)\)/m.exec(result)?.[1];
    if (asyncSingle) add(asyncSingle);
    for (const match of result.matchAll(
      /^(?:Step \d+|Agent \d+\/\d+):\s+([A-Za-z0-9][A-Za-z0-9._-]*)/gm,
    )) {
      add(match[1]);
    }
  }

  return names;
}

/** What a `subagent` call runs when no specialist name is known yet. */
function workflowSummary(workflow: unknown): string | null {
  if (workflow === true) return "workflow script";
  if (typeof workflow !== "string" || !workflow.trim()) return null;
  // A value with a path separator is a script file; anything else names an
  // extension-registered workflow resource.
  return /[\\/]/.test(workflow) ? `workflow ${workflow}` : `workflow “${workflow}”`;
}

const MAX_PROMPT_SUMMARY = 140;

/** One-line human summary of a tool call's arguments. */
function summarize(
  toolName: string | undefined,
  args: unknown,
  result?: string,
  replyScript?: string,
): string {
  if (args && typeof args === "object") {
    const a = args as Record<string, unknown>;
    const firstLine = (v: unknown) =>
      typeof v === "string" ? v.split("\n")[0] : "";
    if (toolName === "bash" && typeof a.command === "string")
      return firstLine(a.command);
    // Before the generic path lookup: `path` is where the image is saved, the
    // prompt is what the user wants to recognize.
    if (toolName === "generate_image" && typeof a.prompt === "string") {
      const prompt = firstLine(a.prompt).trim();
      return prompt.length > MAX_PROMPT_SUMMARY ? `${prompt.slice(0, MAX_PROMPT_SUMMARY - 1)}…` : prompt;
    }
    const pathish = a.path ?? a.file_path ?? a.filePath ?? a.pattern ?? a.query;
    if (typeof pathish === "string") return pathish;
    if (toolName === "subagent") {
      const agents = subagentNames(a, result, replyScript);
      if (agents.length > 0) {
        const task =
          agents.length === 1 && Array.isArray(a.tasks) && a.tasks.length === 1
            ? (a.tasks[0] as Record<string, unknown> | undefined)?.task
            : a.task ?? a.prompt ?? a.description;
        const detail = firstLine(task);
        return `${agents.join(" + ")}${detail ? `: ${detail}` : ""}`;
      }
      if (a.action === "list") return "list agents";
      if (a.action === "status") return "check subagent status";
      if (a.action === "interrupt") return "interrupt subagent";
      return firstLine(a.task ?? a.prompt ?? a.description) || workflowSummary(a.workflow) || "subtask";
    }
    if (toolName === "bg_wait" || toolName === "subagent_wait") {
      return "wait for subagents";
    }
    const keys = Object.keys(a);
    if (keys.length) return firstLine(a[keys[0]]) || keys.join(", ");
  }
  return typeof args === "string" ? args.split("\n")[0] : "";
}

function StatusDot({ status }: { status: ActivityItem["status"] }) {
  const t = useT();
  if (status === "running") return <Spinner aria-label={t("Running")} className="size-3 shrink-0" />;
  const label = t(status === "error" ? "Failed" : status === "unknown" ? "Status unknown" : "Completed");
  const Icon = status === "error" ? XIcon : status === "unknown" ? HelpCircleIcon : CheckIcon;
  return (
    <span role="img" aria-label={label} title={label} className="inline-flex shrink-0">
      <Icon aria-hidden="true" className={cn("size-3.5", {
        "text-destructive": status === "error",
        "text-muted-foreground": status === "unknown",
        "text-emerald-600 dark:text-emerald-400": status === "complete",
      })} />
    </span>
  );
}

function toolStartTime(startedAt: number | undefined): Date | null {
  const time = startedAt === undefined ? null : new Date(startedAt);
  return time && Number.isFinite(time.getTime()) ? time : null;
}

function ToolStartedAt({ time }: { time: Date }) {
  const locale = useLocale();
  const t = useT();
  return <span title={time.toLocaleString(locale)}>{t("Started {time}", { time: time.toLocaleTimeString(locale) })}</span>;
}

function formatToolDuration(durationMs: number | undefined, locale: string): string | null {
  if (durationMs === undefined || !Number.isFinite(durationMs) || durationMs < 0) return null;
  const unit = durationMs < 1000 ? "millisecond" : durationMs < 60_000 ? "second" : "minute";
  const value = durationMs / (unit === "millisecond" ? 1 : unit === "second" ? 1000 : 60_000);
  return new Intl.NumberFormat(locale, { style: "unit", unit, maximumFractionDigits: 1 }).format(value);
}

export function ToolTiming({ item, className }: { item: ActivityItem; className?: string }) {
  const locale = useLocale();
  const t = useT();
  const time = toolStartTime(item.startedAt);
  const duration = formatToolDuration(item.durationMs, locale);
  const unknownStatus = item.status === "unknown";
  if (!time && !duration && !unknownStatus) return null;
  return (
    <span className={cn("flex flex-wrap items-baseline gap-x-2 text-[11px] tabular-nums text-muted-foreground", className)}>
      {time && <ToolStartedAt time={time} />}
      {duration && <span>{duration}</span>}
      {unknownStatus && <span>{t("Status unknown")}</span>}
    </span>
  );
}

function fullArgs(args: unknown): string {
  if (args == null) return "";
  if (typeof args === "object") {
    const a = args as Record<string, unknown>;
    // For bash, the command alone is the most useful, verbatim payload.
    if (typeof a.command === "string" && Object.keys(a).length === 1)
      return a.command;
    try {
      return JSON.stringify(args, null, 2);
    } catch {
      return String(args);
    }
  }
  return String(args);
}

function ToolCallPreview({ item }: { item: ActivityItem }) {
  // A read of a SKILL.md is Pi's skill activation — surface the skill's name
  // instead of a generic file read (the path stays visible under Input). The
  // server resolves the frontmatter name; the path-derived name is a fallback.
  const skill = item.skillName ?? skillNameFromRead(item.toolName, item.args);
  const name = skill ? "skill" : (item.toolName ?? item.label);
  const summary = skill ?? summarize(item.toolName, item.args, item.result, item.replyWorkflowScript);
  return (
    <>
      {skill ? <WandSparklesIcon className="size-3.5 shrink-0 text-muted-foreground" /> : <ToolIcon toolName={item.toolName} />}
      <span className="flex min-w-0 flex-1 items-baseline gap-2">
        <span className={cn("min-w-0 shrink-0 truncate font-medium text-foreground", summary ? "max-w-[50%]" : "max-w-full")}>{name}</span>
        {summary && <span className="min-w-0 truncate font-mono text-muted-foreground">{summary}</span>}
      </span>
    </>
  );
}

const ToolCard = memo(function ToolCard({ item, inlineImages }: { item: ActivityItem; inlineImages: boolean }) {
  const t = useT();
  const locale = useLocale();
  const args = fullArgs(item.args);
  const time = toolStartTime(item.startedAt);
  const duration = formatToolDuration(item.durationMs, locale);
  const hasDetail = Boolean(
    time || args ||
      item.result ||
      (!inlineImages && (item.resultImages?.length || item.resultImagesTruncated)),
  );

  return (
    <Collapsible data-tool-call-id={item.id}>
      <CollapsibleTrigger
        disabled={!hasDetail}
        className={cn(
          "group flex min-h-8 w-full items-center gap-2.5 rounded-md border bg-muted/30 px-3 py-1.5 text-left text-xs text-muted-foreground transition-colors enabled:hover:bg-muted/60",
          item.status === "error" && "border-destructive/30 bg-destructive/5 enabled:hover:bg-destructive/10",
        )}
      >
        <ToolCallPreview item={item} />
        {duration && (
          <span className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap tabular-nums" title={t("Duration")}>
            <ClockIcon aria-hidden="true" className="size-3.5" />
            {duration}
          </span>
        )}
        <StatusDot status={item.status} />
        <ChevronRightIcon aria-hidden="true" className={cn("size-3 shrink-0 transition-transform group-data-[state=open]:rotate-90", !hasDetail && "invisible")} />
      </CollapsibleTrigger>
      {hasDetail && (
        <CollapsibleContent>
          <div className="mt-1 space-y-1.5 rounded-md border bg-background p-2">
            {time && <div className="text-[11px] tabular-nums text-muted-foreground"><ToolStartedAt time={time} /></div>}
            {args && (
              <div>
                <div className="mb-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  {item.toolName === "bash" ? "Command" : "Input"}
                </div>
                <pre className="max-h-60 overflow-auto rounded bg-muted/50 p-2 font-mono text-[11px] leading-relaxed text-foreground whitespace-pre-wrap break-words">
                  {args}
                </pre>
              </div>
            )}
            {item.result && (
              <div>
                <div className="mb-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  {item.status === "error" ? t("Error") : "Output"}
                </div>
                <pre
                  className={cn(
                    "max-h-72 overflow-auto rounded bg-muted/50 p-2 font-mono text-[11px] leading-relaxed whitespace-pre-wrap break-words",
                    item.status === "error" ? "text-destructive" : "text-foreground",
                  )}
                >
                  {item.result}
                </pre>
              </div>
            )}
            {!inlineImages && (
              <ToolResultImages
                images={item.resultImages ?? []}
                truncated={item.resultImagesTruncated}
              />
            )}
          </div>
        </CollapsibleContent>
      )}
    </Collapsible>
  );
});

/** Compact pointer from Modal tool activity to its durable Compute record. */
export function ModalJobChip({
  item,
  onView,
}: {
  item: ActivityItem;
  onView?: (jobId?: string) => void;
}) {
  const jobId = modalJobIdFromActivity(item);
  const toolLabel = (item.toolName ?? "modal")
    .replace(/^modal_/, "")
    .replace(/_/g, " ");
  const view = () => {
    if (onView) onView(jobId ?? undefined);
    else openModalJob(jobId);
  };
  return (
    <div
      data-tool-call-id={item.id}
      className={cn(
        "my-1 flex w-full items-center gap-2 rounded-md border border-violet-500/25 bg-violet-500/5 px-2.5 py-1.5 text-xs",
        item.status === "error" && "border-destructive/40 bg-destructive/5",
      )}
    >
      <ServerCogIcon className="size-3.5 shrink-0 text-violet-500" />
      <span className="font-medium capitalize text-foreground">Modal · {toolLabel}</span>
      {jobId ? (
        <code className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground">
          {jobId}
        </code>
      ) : (
        <span className="min-w-0 flex-1 truncate text-muted-foreground">
          {item.status === "running" ? "Submitting durable compute…" : "Durable compute activity"}
        </span>
      )}
      <StatusDot status={item.status} />
      <button
        type="button"
        onClick={view}
        className="shrink-0 text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
      >
        {jobId ? "View job" : "Open Compute"}
      </button>
    </div>
  );
}

/**
 * Compact chip for a `notebook` tool call: the entry itself renders in the
 * Journal panel, so the transcript shows a one-line pointer with an
 * optional jump ("View in journal"). item.id === the notebook entry id.
 */
export function NotebookEntryChip({
  item,
  onView,
}: {
  item: ActivityItem;
  onView?: (entryId: string) => void;
}) {
  const t = useT();
  const args = (item.args ?? {}) as Record<string, unknown>;
  const typeLabel =
    typeof args.type === "string"
      ? args.type.charAt(0).toUpperCase() + args.type.slice(1)
      : "Entry";
  const title = typeof args.title === "string" ? args.title : "";
  return (
    <div
      data-tool-call-id={item.id}
      className="my-1 flex w-full items-center gap-2 rounded-md border border-blue-200 bg-blue-50 dark:border-blue-500/30 dark:bg-blue-500/10 px-2.5 py-1.5 text-xs"
    >
      <BookOpenIcon className="size-3.5 shrink-0 text-amber-500" />
      <span className="font-medium text-foreground">{t("Journal")} · {t(typeLabel)}</span>
      {title && (
        <span className="min-w-0 flex-1 truncate text-muted-foreground">{title}</span>
      )}
      <StatusDot status={item.status} />
      {onView && (
        <button
          type="button"
          onClick={() => onView(item.id)}
          className="shrink-0 text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
        >
          {t("View in journal")}</button>
      )}
    </div>
  );
}

/** A single disclosure for consecutive tool calls within the transcript. */
export function ToolActivityList({
  activities,
  current = false,
}: {
  activities: ActivityItem[];
  current?: boolean;
}) {
  const t = useT();
  const latest = activities.at(-1);
  if (!latest) return null;
  const running = activities.some((item) => item.status === "running");
  const failed = activities.filter((item) => item.status === "error").length;
  const unknown = activities.filter((item) => item.status === "unknown").length;
  const inlineImages = activities.length === 1 && latest.toolName === "generate_image";

  return (
    <div className="my-1 space-y-1">
      <Collapsible>
        <CollapsibleTrigger className="group flex w-full items-center gap-2 rounded-md border bg-muted/30 px-2.5 py-1.5 text-left text-xs text-muted-foreground transition-colors hover:bg-muted/60">
          <ChevronRightIcon aria-hidden="true" className="size-3 shrink-0 transition-transform group-data-[state=open]:rotate-90" />
          {current ? (
            <ToolCallPreview item={latest} />
          ) : (
            <>
              <WrenchIcon aria-hidden="true" className="size-3.5 shrink-0" />
              <span className="min-w-0 flex-1 truncate font-medium">
                {t(activities.length === 1 ? "Ran 1 tool call" : "Ran {count} tool calls", { count: activities.length })}
                {failed > 0 && <span className="text-destructive"> · {t("{count} failed", { count: failed })}</span>}
                {unknown > 0 && ` · ${t("{count} of unknown status", { count: unknown })}`}
              </span>
            </>
          )}
          {running ? <Spinner aria-label={t("Tool calls running")} className="size-3 shrink-0" /> : current && <StatusDot status={latest.status} />}
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="mt-1 space-y-1 border-l-2 border-muted pl-2">
            {activities.map((item) => <ToolCard key={item.id} item={item} inlineImages={inlineImages} />)}
          </div>
        </CollapsibleContent>
      </Collapsible>
      {inlineImages && <ToolResultImages images={latest.resultImages ?? []} truncated={latest.resultImagesTruncated} />}
    </div>
  );
}
