"use client";

import { GaugeIcon, ScissorsIcon, SlidersHorizontalIcon } from "lucide-react";

import { useLocale, useT } from "@/components/i18n-provider";
import { InfoTooltip } from "@/components/ui/info-tooltip";
import { cn, formatCompactTokens } from "@/lib/utils";
import type { ContextUsage } from "@/lib/use-agent";
import { openSettings } from "@/lib/settings-nav";

export function ContextUsageIndicator({
  usage,
  onCompact,
  compactDisabled = false,
}: {
  usage: ContextUsage | null;
  /** When provided, a "Compact now" action sits next to the gauge. */
  onCompact?: () => void;
  /** True while a run streams (Pi's compact() would abort it). */
  compactDisabled?: boolean;
}) {
  const t = useT();
  const locale = useLocale();
  if (!usage) return null;

  const known = usage.tokens !== null && usage.percent !== null;
  const tokens = usage.tokens ?? 0;
  const percent = usage.percent ?? 0;
  const fill = Math.min(100, Math.max(0, percent));
  const critical = known && percent > 90;
  const warning = known && percent > 70;
  const value = known ? `${Math.round(percent)}%` : "?%";
  const percentText = percent.toLocaleString(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const ariaLabel = known
    ? t("Model context {percent} percent, {used} of {total} tokens", {
      percent: percentText, used: tokens.toLocaleString(locale), total: usage.contextWindow.toLocaleString(locale),
    })
    : t("Model context usage awaiting provider measurement, {total} token window", { total: usage.contextWindow.toLocaleString(locale) });

  const gauge = (
    <InfoTooltip
      content={
        <>
          <b>{t("Model context")}</b>
          <br />
          {known
            ? t("{used} of {total} tokens ({percent}%)", {
              used: formatCompactTokens(tokens), total: formatCompactTokens(usage.contextWindow), percent: percentText,
            })
            : t("Awaiting provider measurement · {total} token window", { total: formatCompactTokens(usage.contextWindow) })}
          <br />
          {known
            ? t("Pi estimates how much of the selected model's context window this conversation currently uses.")
            : t("Available after the first model response and temporarily unavailable after compaction.")}
        </>
      }
    >
      <span
        role="status"
        aria-label={ariaLabel}
        className={cn(
          "inline-flex h-7 shrink-0 cursor-help items-center gap-1.5 rounded-md px-2 font-mono text-[11px] tabular-nums text-muted-foreground",
          critical && "bg-destructive/10 text-destructive",
          warning && !critical && "bg-amber-500/10 text-amber-700 dark:text-amber-400",
        )}
      >
        <GaugeIcon className="size-3.5 shrink-0" aria-hidden />
        <span>{value}</span>
        <span className="h-1 w-6 overflow-hidden rounded-full bg-muted" aria-hidden>
          <span
            className={cn(
              "block h-full rounded-full transition-[width]",
              critical ? "bg-destructive" : warning ? "bg-amber-500" : "bg-primary",
            )}
            style={{ width: `${fill}%` }}
          />
        </span>
      </span>
    </InfoTooltip>
  );

  if (!onCompact) return gauge;
  return (
    <span className="inline-flex items-center gap-0.5">
      {gauge}
      <InfoTooltip
        content={
          <>
            <b>{t("Compact now")}</b>
            <br />
            {t("Summarize older messages to free context. AI Scientist keeps a state block (plan, notebook entries, result ids, environment) ahead of the summary.")}
            {compactDisabled && <>{" "}{t("Available once the current run finishes.")}</>}
          </>
        }
      >
        <button
          type="button"
          onClick={onCompact}
          disabled={compactDisabled}
          aria-label={t("Compact context now")}
          className="inline-flex h-7 items-center rounded-md px-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
        >
          <ScissorsIcon className="size-3.5" aria-hidden />
        </button>
      </InfoTooltip>
      <InfoTooltip
        content={
          <>
            <b>{t("Compaction settings")}</b>
            <br />
            {t("Automatic compaction and how much recent context it keeps, for every chat in this project.")}
          </>
        }
      >
        <button
          type="button"
          onClick={() => openSettings({ tab: "project", section: "context" })}
          aria-label={t("Compaction settings")}
          className="inline-flex h-7 items-center rounded-md px-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <SlidersHorizontalIcon className="size-3.5" aria-hidden />
        </button>
      </InfoTooltip>
    </span>
  );
}
