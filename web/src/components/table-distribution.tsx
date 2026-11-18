"use client";
import { useMemo, useState } from "react";
import { useT } from "@/components/i18n-provider";
import { categoryDistribution, dateDistribution, distribution, type ColumnType, type DateGrouping, type ExplorerTable, type FrequencyItem } from "@/lib/table-explorer";

export function TableDistribution({ table, rows, types }: { table: ExplorerTable; rows: ExplorerTable["rows"]; types: ColumnType[] }) {
  const t = useT();
  const [column, setColumn] = useState(0);
  const [grouping, setGrouping] = useState<DateGrouping>("month");
  const selected = column < table.columns.length ? column : 0;
  const [categorical, setCategorical] = useState(false);
  const inferredType = types[selected] ?? "text";
  const type = categorical ? "text" : inferredType;
  const frequencies = useMemo(() => type === "text" || type === "boolean" ? categoryDistribution(rows, selected, type === "boolean") : { items: [], missing: rows.filter(row => row[selected] === null || row[selected].trim() === "").length, distinct: 0, total: rows.length }, [rows, selected, type]);
  const dates = useMemo(() => type === "date" ? dateDistribution(rows, selected, grouping) : null, [rows, selected, grouping, type]);
  const stats = useMemo(() => type === "number" ? distribution(rows, selected) : null, [rows, selected, type]);
  const percent = (count: number) => `${(rows.length ? count / rows.length * 100 : 0).toFixed(1)}%`;
  const missing = frequencies.missing;
  const typeLabel = t(type === "number" ? "Number" : type === "boolean" ? "Boolean" : type === "date" ? "Date" : "Text / category");
  const items = dates?.items ?? frequencies.items;
  const renderFrequencies = (values: FrequencyItem[]) => {
    const max = values.reduce((n, item) => Math.max(n, item.count), 1);
    return <div role="img" aria-label={t(type === "date" ? "Date distribution" : "Value frequency")} className="space-y-2">
      {values.map((item, i) => <div key={i} className="grid grid-cols-[minmax(0,10rem)_minmax(0,1fr)_5rem] items-center gap-2">
        <span className="truncate" title={item.other ? t("Other values (combined)") : item.label}>{item.other ? t("Other values (combined)") : item.label}</span>
        <div className="h-5 rounded bg-muted"><div className="h-full rounded bg-blue-500/70" style={{ width: `${item.count / max * 100}%` }} /></div>
        <span className="text-right tabular-nums">{item.count} · {percent(item.count)}</span>
      </div>)}
    </div>;
  };
  return <div className="space-y-4 p-3">
    <div className="flex flex-wrap items-center gap-3">
      <label className="flex min-w-0 items-center gap-2">{t("Distribution column")}<select aria-label={t("Distribution column")} disabled={!table.columns.length} value={selected} onChange={event => { setColumn(Number(event.target.value)); setCategorical(false); }} className="max-w-64 rounded-md border bg-background py-1 pl-2 pr-6">{table.columns.map((name, i) => <option key={i} value={i}>{name}</option>)}</select></label>
      <span className="text-muted-foreground">{typeLabel}</span>
      {(inferredType === "number" || inferredType === "date") && <label className="flex items-center gap-2">{t("Display as")}<select aria-label={t("Display as")} value={categorical ? "category" : "auto"} onChange={event => setCategorical(event.target.value === "category")} className="rounded-md border bg-background py-1 pl-2 pr-6"><option value="auto">{t("Automatic")}</option><option value="category">{t("Value frequency")}</option></select></label>}
      {type === "date" && <label className="flex items-center gap-2">{t("Group dates by")}<select aria-label={t("Group dates by")} value={grouping} onChange={event => setGrouping(event.target.value as DateGrouping)} className="rounded-md border bg-background py-1 pl-2 pr-6">{([['day', 'Day'], ['month', 'Month'], ['year', 'Year']] as const).map(([id, label]) => <option key={id} value={id}>{t(label)}</option>)}</select></label>}
    </div>
    <p className="text-muted-foreground">{t("Distribution uses matching rows. Percentages include missing rows in the denominator.")}</p>
    <div className="flex flex-wrap gap-4">
      <div><span className="text-muted-foreground">{t("Matching rows")}</span><p className="mt-1 tabular-nums">{rows.length}</p></div>
      <div><span className="text-muted-foreground">{t("Missing values")}</span><p className="mt-1 tabular-nums">{missing} · {percent(missing)}</p></div>
      <div><span className="text-muted-foreground">{t("Nonmissing values")}</span><p className="mt-1 tabular-nums">{rows.length - missing} · {percent(rows.length - missing)}</p></div>
    </div>
    {type === "number" ? stats ? <>
      <div className="flex flex-wrap gap-4">{[["Count", stats.count], ["Minimum", stats.min], ["Mean", stats.mean], ["Maximum", stats.max]].map(([label, value]) => <div key={label}><span className="text-muted-foreground">{t(String(label))}</span><p className="mt-1 font-mono">{value}</p></div>)}</div>
      <div role="img" aria-label={t("Histogram")} className="space-y-1">
        {stats.bins.map((count, i) => { const scale = Math.max(Math.abs(stats.min), Math.abs(stats.max), 1); const edge = (n: number) => (stats.min / scale * (1 - n / stats.bins.length) + stats.max / scale * n / stats.bins.length) * scale; const range = `${edge(i).toPrecision(4)} – ${edge(i + 1).toPrecision(4)}`; return <div key={i} className="grid grid-cols-[10rem_1fr_3rem] items-center gap-2"><span className="truncate font-mono" title={range}>{range}</span><div className="h-5 rounded bg-muted"><div className="h-full rounded bg-blue-500/70" style={{ width: `${count / Math.max(...stats.bins) * 100}%` }} /></div><span>{count}</span></div>; })}
      </div>
    </> : <p>{t("No values available for this selection.")}</p> : <>
      {type === "text" && <p className="text-muted-foreground">{t("Top 20 values by frequency; remaining values are combined. Original cell text is preserved.")}</p>}
      {type === "date" && <p className="text-muted-foreground">{t("Only ISO dates are inferred. Dates are grouped as written, without timezone conversion. Periods without records are omitted.")}</p>}
      {dates && dates.items.length > 200 ? <p>{t("More than 200 date groups. Filter rows or choose a coarser date grouping.")}</p> : items.length ? renderFrequencies(items) : <p>{t("No values available for this selection.")}</p>}
    </>}
  </div>;
}
