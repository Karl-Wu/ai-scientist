"use client";

import { useT } from "@/components/i18n-provider";
import type { NoteDraftProgress } from "@/lib/note-pages";

const stepLabels = {
  preparing: "Preparing note material…",
  organizing: "Organizing notes · round {round}",
  searching: "Searching task records",
  reading: "Reading task records",
  source: "Reading the selected source",
  table: "Checking the source table",
  skill: "Reading a skill",
  validating: "Validating note candidates",
} satisfies Record<NoteDraftProgress["step"], string>;

export function NoteDraftProcess({ steps, running = false }: { steps: NoteDraftProgress[]; running?: boolean }) {
  const t = useT();
  const latest = steps.at(-1);
  if (!latest) return null;
  const label = (step: NoteDraftProgress) => t(stepLabels[step.step], { round: step.round ?? 1 });

  return <div className="space-y-1 text-xs text-muted-foreground">
    {running && <p role="status">
      <span className="font-medium text-foreground">{label(latest)}</span>
      {latest.records && <> · {t("Read {read} of {total} task records", latest.records)}</>}
    </p>}
    <details>
      <summary className="w-fit cursor-pointer">{t("Drafting process")}</summary>
      <ol className="mt-1 max-h-40 list-decimal space-y-1 overflow-y-auto pl-5">
        {steps.map((step, index) => <li key={index}>{label(step)}</li>)}
      </ol>
    </details>
  </div>;
}
