"use client";

import { useT, useLocale } from "@/components/i18n-provider";
import { SubagentFleetPanel } from "./subagent-fleet-panel";

/**
 * Project "Tasks" tab: pi-subagents durable schedules (recurring or
 * one-shot specialist runs that fire from AI Scientist's resident session, even with
 * no chat tab open) and missions (durable records of delegated work).
 * Schedules are created conversationally ("run the QC pipeline every 6h");
 * this panel shows and controls them.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlarmClockIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  FlagIcon,
  Loader2Icon,
  PauseIcon,
  PlayIcon,
  RefreshCwIcon,
  Trash2Icon,
  ZapIcon,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/confirm-dialog";
import {
  closeMission,
  getMissions,
  getSchedules,
  scheduleAction,
  type MissionView,
  type ScheduleAction,
  type ScheduleView,
} from "@/lib/automation";
import { cn, formatUsd } from "@/lib/utils";
import { SettingsLink } from "@/components/settings-link";

const POLL_MS = 10_000;

const RUN_STATE_LABEL: Record<ScheduleView["runs"][number]["state"], string> = {
  running: "running",
  skipped: "skipped (overlap)",
  missed: "missed",
  completed: "completed",
  failed_launch: "failed to launch",
  failed_run: "failed",
};

/** pi-subagents redacts prompt-derived titles; name the run by its specialists instead. */
const REDACTED = "[prompt redacted]";
function missionLabel(m: MissionView): string {
  if (m.title && m.title !== REDACTED) return m.title;
  const agents = [...new Set(m.runs.map((r) => r.agent).filter((a): a is string => Boolean(a)))];
  return agents.length > 0 ? `${agents.join(", ")} run` : "Delegated run";
}

export function AutomationPanel({ projectId }: { projectId: string }) {
  const t = useT();
  const locale = useLocale();
  const [schedules, setSchedules] = useState<ScheduleView[]>([]);
  const [missions, setMissions] = useState<MissionView[]>([]);
  const [heldByBudget, setHeldByBudget] = useState<string[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const { confirm, dialog } = useConfirm();

  const refresh = useCallback(async () => {
    // Schedules and missions come from different stores; one failing must not
    // hide the other.
    const [s, m] = await Promise.allSettled([getSchedules(projectId), getMissions(projectId)]);
    if (s.status === "fulfilled") {
      setSchedules(s.value.schedules);
      setHeldByBudget(s.value.heldByBudget);
    }
    if (m.status === "fulfilled") setMissions(m.value);
    const failures = [s, m].flatMap((r) =>
      r.status === "rejected" ? [r.reason instanceof Error ? r.reason.message : String(r.reason)] : [],
    );
    setError(failures.length > 0 ? failures.join(" · ") : null);
    setLoaded(true);
  }, [projectId]);

  useEffect(() => {
    setLoaded(false);
    void refresh();
    const timer = setInterval(() => {
      if (!document.hidden) void refresh();
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [refresh]);

  const act = useCallback(
    async (schedule: ScheduleView, action: ScheduleAction) => {
      if (action === "delete") {
        const ok = await confirm({
          title: t('Delete schedule "{name}"?', { name: schedule.name }),
          description: t("Its definition and run history are removed. Runs already in progress finish normally."),
          confirmLabel: t("Delete"),
          destructive: true,
        });
        if (!ok) return;
      }
      setBusy(`${action}:${schedule.id}`);
      setError(null);
      setNotice(null);
      try {
        const result = await scheduleAction(schedule.id, action, projectId);
        setSchedules(result.schedules);
        // Only a manual fire has news worth reading (started, or skipped as an overlap).
        if (action === "run" && result.message) setNotice(result.message.split("\n")[0]);
      } catch (exc) {
        setError(exc instanceof Error ? exc.message : `Could not ${action} the schedule`);
      } finally {
        setBusy(null);
      }
    },
    [confirm, projectId, t],
  );

  const close = useCallback(
    async (mission: MissionView) => {
      const ok = await confirm({
        title: t('Close mission "{name}"?', { name: missionLabel(mission) }),
        description: t("Marks it cancelled. Linked runs are not stopped."),
        confirmLabel: t("Close mission"),
      });
      if (!ok) return;
      setBusy(`close:${mission.id}`);
      try {
        setMissions(await closeMission(mission.id, projectId));
      } catch (exc) {
        setError(exc instanceof Error ? exc.message : "Could not close the mission");
      } finally {
        setBusy(null);
      }
    },
    [confirm, projectId, t],
  );

  // "Run started" goes stale as soon as the row's own state catches up.
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), 10_000);
    return () => clearTimeout(timer);
  }, [notice]);

  function describeSchedule(trigger: ScheduleView["trigger"], paused: boolean) {
    const date = (value: string) => new Date(value).toLocaleString(locale);
    const next = trigger.nextRunAt && !paused ? ` · ${t("next {time}", { time: date(trigger.nextRunAt) })}` : "";
    if (trigger.kind === "interval") return t("every {interval}", { interval: trigger.every }) + next;
    if (trigger.kind === "calendar") return t("every {interval} at {time} {zone}", {
      interval: trigger.every + (trigger.on?.length ? ` (${trigger.on.join(", ")})` : ""),
      time: trigger.at, zone: trigger.timezone,
    }) + next;
    return t("once at {time}", { time: date(trigger.nextRunAt ?? trigger.at) });
  }

  const openMissions = useMemo(() => missions.filter((m) => !["completed", "failed", "cancelled"].includes(m.status)), [missions]);
  const closedMissions = useMemo(() => missions.filter((m) => ["completed", "failed", "cancelled"].includes(m.status)), [missions]);

  return (
    <div className="@container/tasks flex min-w-0 flex-1 flex-col gap-4 overflow-y-auto p-4" data-testid="automation-panel">
      {dialog}
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <h3 className="text-base font-semibold">{t("Tasks")}</h3>
          <p className="mt-1 max-w-3xl text-xs leading-relaxed text-muted-foreground">
            {t("Recurring and one-shot specialist runs, plus durable missions. Ask AI Scientist to create one (“re-run the QC report every 6 hours”); they fire from a resident session even with no chat open and pause automatically when the project spend limit is reached.")}</p>
        </div>
        <Button type="button" size="sm" variant="ghost" className="size-8 shrink-0 p-0 text-muted-foreground" title={t("Refresh tasks")} onClick={() => void refresh()} aria-label={t("Refresh tasks")}>
          <RefreshCwIcon className="size-3.5" />
        </Button>
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
      {notice && <p role="status" className="text-xs text-muted-foreground">{notice}</p>}
      {heldByBudget.length > 0 && (
        <p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs">
          {t(heldByBudget.length === 1 ? "{count} schedule is held because the project reached its spend limit." : "{count} schedules are held because the project reached its spend limit.", { count: heldByBudget.length })}{" "}
          <SettingsLink tab="project" section="budget">
            {t("Raise the limit in project settings")}</SettingsLink>{" "}
          {t("and they resume on their own.")}
        </p>
      )}

      <SubagentFleetPanel key={projectId} projectId={projectId} />
      <div className="grid min-w-0 grid-cols-1 items-start gap-4 @min-[48rem]/tasks:grid-cols-2">
        <section aria-label={t("Scheduled tasks")} className="flex min-w-0 flex-col gap-3 rounded-xl border p-4">
          <h4 className="flex items-center gap-2 text-sm font-medium">
            <AlarmClockIcon className="size-4 text-emerald-500" /> {t("Scheduled tasks")}</h4>
          <p className="-mt-1 text-xs leading-relaxed text-muted-foreground">{t("Tasks that run once at a set time or repeat on a schedule.")}</p>
          {!loaded ? (
            <p className="text-xs text-muted-foreground">{t("Loading…")}</p>
          ) : schedules.length === 0 ? (
            <p className="rounded-lg bg-muted/30 px-3 py-4 text-xs leading-relaxed text-muted-foreground">
              {t("No scheduled tasks yet. In a chat: “every night at 2am, have the data validator re-check user_data and log a notebook entry”.")}</p>
          ) : (
            schedules.map((s) => {
              const expanded = open[s.id] ?? false;
              const rowBusy = busy?.endsWith(`:${s.id}`) ?? false;
              return (
                <div key={s.id} className="rounded-lg border" data-schedule={s.id}>
                  <div className="flex items-center gap-2 px-3 py-2">
                    <button
                      type="button"
                      className="flex min-w-0 flex-1 items-center gap-2 text-left"
                      onClick={() => setOpen((o) => ({ ...o, [s.id]: !expanded }))}
                      aria-expanded={expanded}
                      aria-label={t(expanded ? "Collapse {name}" : "Expand {name}", { name: s.name })}
                    >
                      {expanded ? <ChevronDownIcon className="size-3.5 shrink-0" /> : <ChevronRightIcon className="size-3.5 shrink-0" />}
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-1.5 text-xs font-medium">
                          <span>{s.name}</span>
                          {s.heldByBudget ? (
                            <Badge variant="outline" className="h-5 text-[10px] text-amber-600">{t("Held: spend limit")}</Badge>
                          ) : s.paused ? (
                            <Badge variant="outline" className="h-5 text-[10px]">{t("Paused")}</Badge>
                          ) : s.activeRunId ? (
                            <Badge variant="secondary" className="h-5 text-[10px]">{t("Running")}</Badge>
                          ) : null}
                        </div>
                        <div className="truncate text-[11px] text-muted-foreground">
                          {describeSchedule(s.trigger, s.paused)}
                          {s.lastRun ? ` · ${t("last {state}", { state: t(RUN_STATE_LABEL[s.lastRun.state]) })}` : ""}
                          {s.spendUsd > 0 ? ` · ${t("{amount} spent", { amount: formatUsd(s.spendUsd) })}` : ""}
                        </div>
                      </div>
                    </button>
                    <Button type="button" size="sm" variant="ghost" className="h-7 w-7 p-0" aria-label={t("Run {name} now", { name: s.name })} title={s.heldByBudget ? t("Held until the spend limit is raised") : t("Run {name} now", { name: s.name })} disabled={rowBusy || s.heldByBudget} onClick={() => void act(s, "run")}>
                      {busy === `run:${s.id}` ? <Loader2Icon className="size-3.5 animate-spin" /> : <ZapIcon className="size-3.5" />}
                    </Button>
                    {s.paused ? (
                      <Button type="button" size="sm" variant="ghost" className="h-7 w-7 p-0" aria-label={t("Resume {name}", { name: s.name })} disabled={rowBusy || s.heldByBudget} onClick={() => void act(s, "resume")}>
                        <PlayIcon className="size-3.5" />
                      </Button>
                    ) : (
                      <Button type="button" size="sm" variant="ghost" className="h-7 w-7 p-0" aria-label={t("Pause {name}", { name: s.name })} disabled={rowBusy} onClick={() => void act(s, "pause")}>
                        <PauseIcon className="size-3.5" />
                      </Button>
                    )}
                    <Button type="button" size="sm" variant="ghost" className="h-7 w-7 p-0 text-destructive" aria-label={t("Delete {name}", { name: s.name })} disabled={rowBusy} onClick={() => void act(s, "delete")}>
                      <Trash2Icon className="size-3.5" />
                    </Button>
                  </div>
                  {expanded && (
                    <div className="border-t px-3 py-2 text-[11px]">
                      <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded bg-muted/40 p-2 font-mono text-[10px] leading-relaxed">{s.workflowScript}</pre>
                      <div className="mt-2 text-muted-foreground">
                        model: {s.model ?? "inherited from the project's latest chat model"}
                        {s.quiet ? " · quiet (successful fires don't wake AI Scientist)" : ""}
                        {" · "}catch-up: {s.catchUp}
                        {s.timeoutMs ? ` · timeout ${Math.round(s.timeoutMs / 60000)} min` : ""}
                        {s.baseRef ? ` · base ${s.baseRef}` : ""}
                        {s.missionId ? ` · mission ${s.missionId}` : ""}
                      </div>
                      {s.runs.length > 0 && (
                        <ul className="mt-2 flex flex-col gap-0.5">
                          {s.runs.map((r) => (
                            <li key={r.id} className={cn("flex flex-wrap items-center gap-x-2", r.state.startsWith("failed") && "text-destructive")}>
                              <span className="font-mono text-[10px] text-muted-foreground">{new Date(r.plannedAt).toLocaleString(locale)}</span>
                              <span>{t(RUN_STATE_LABEL[r.state])}</span>
                              <span className="text-muted-foreground">({r.dueReason})</span>
                              {r.error && <span className="w-full break-words">{r.error}</span>}
                              {r.summary && !r.error && (
                                <span className="w-full whitespace-pre-wrap break-words rounded bg-muted/40 px-2 py-1 text-[10px] text-foreground">{r.summary}</span>
                              )}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </section>

        <section aria-label={t("Missions")} className="flex min-w-0 flex-col gap-3 rounded-xl border p-4">
          <h4 className="flex items-center gap-2 text-sm font-medium">
            <FlagIcon className="size-4 text-blue-500" /> {t("Missions")}</h4>
          <p className="-mt-1 text-xs leading-relaxed text-muted-foreground">{t("Ongoing, multi-step tasks with saved progress, decisions, and results.")}</p>
          {loaded && missions.length === 0 && (
            <p className="rounded-lg bg-muted/30 px-3 py-4 text-xs leading-relaxed text-muted-foreground">
              {t("No missions recorded. Multi-step delegations AI Scientist runs create one automatically; they survive restarts and hold decisions, artifacts and receipts.")}</p>
          )}
          {[...openMissions, ...closedMissions].map((m) => (
            <div key={m.id} className={cn("rounded-lg border px-3 py-2", ["completed", "failed", "cancelled"].includes(m.status) && "opacity-70")} data-mission={m.id}>
              <div className="flex items-center gap-2">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5 text-xs font-medium">
                    <span>{missionLabel(m)}</span>
                    <Badge variant={m.status === "needs_decision" ? "destructive" : "outline"} className="h-5 text-[10px]">{t(m.status.replaceAll("_", " "))}</Badge>
                    {m.goal && <Badge variant="secondary" className="h-5 text-[10px]">goal · {m.goal.status}</Badge>}
                  </div>
                  {m.objective && m.objective !== REDACTED && <div className="truncate text-[11px] text-muted-foreground">{m.objective}</div>}
                  <div className="text-[10px] text-muted-foreground">
                    {t(m.runs.length === 1 ? "{count} run" : "{count} runs", { count: m.runs.length })}
                    {m.decisions.some((d) => d.status === "open") ? ` · ${t("{count} open decision(s)", { count: m.decisions.filter((d) => d.status === "open").length })}` : ""}
                    {m.usage?.tokens ? ` · ${m.usage.tokens.toLocaleString()} tokens` : ""}
                    {m.budget?.tokens ? ` / ${m.budget.tokens.toLocaleString()} budget` : ""}
                    {` · ${t("updated {time}", { time: new Date(m.updatedAt).toLocaleString(locale) })}`}
                  </div>
                </div>
                {!["completed", "failed", "cancelled"].includes(m.status) && (
                  <Button type="button" size="sm" variant="ghost" className="h-7 text-[11px]" aria-label={`Close mission ${missionLabel(m)}`} disabled={busy === `close:${m.id}`} onClick={() => void close(m)}>
                    {t("Close")}</Button>
                )}
              </div>
            </div>
          ))}
        </section>
      </div>
    </div>
  );
}
