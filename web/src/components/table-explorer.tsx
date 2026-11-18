"use client";
import { useDeferredValue, useMemo, useRef, useState } from "react";
import { TableDistribution } from "./table-distribution";
import { useT } from "@/components/i18n-provider";
import { columnProfile, filterSortTable, parseExplorerTable, TABLE_PAGE_SIZE, tableCsv, type ExplorerTable } from "@/lib/table-explorer";

export interface PreviewScope { total: number | null; columns: number; limited: boolean; cellLimit?: number }
export function TableExplorer({ table, original, name = "data.csv", scope, sourceTypes }: { table: ExplorerTable; original?: string; name?: string; scope?: PreviewScope; sourceTypes?: string[] }) {
  const t = useT();
  const [query, setQuery] = useState("");
  const search = useDeferredValue(query);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(TABLE_PAGE_SIZE);
  const viewport = useRef<HTMLDivElement>(null);
  const goToPage = (next: number) => { setPage(next); if (viewport.current) viewport.current.scrollTop = 0; };
  const [sort, setSort] = useState<{ column: number; desc: boolean } | null>(null);
  const [view, setView] = useState<"table" | "schema" | "distribution">("table");
  const [message, setMessage] = useState("");
  const profiles = useMemo(() => table.columns.map((_, i) => columnProfile(table.rows, i)), [table]);
  const rows = useMemo(() => filterSortTable(table, search, sort, profiles.map(p => p.type)), [table, search, sort, profiles]);
  const widths = useMemo(() => table.columns.map((label, i) => {
    const estimate = (text: string) => Array.from(text).reduce((n, c) => n + (/[^\x00-\xff]/.test(c) ? 12 : 7), 0);
    return Math.max(80, Math.min(140, estimate(label) + 16), Math.min(240, Math.max(0, ...table.rows.slice(0, 100).map(row => estimate(row[i] ?? "") + 16))));
  }), [table]);
  const pages = Math.max(1, Math.ceil(rows.length / pageSize)), current = Math.min(page, pages - 1), start = current * pageSize;
  const button = "rounded-md border px-2 py-1 text-xs hover:bg-muted disabled:opacity-40";
  const download = () => {
    const url = URL.createObjectURL(new Blob([tableCsv(table.columns, rows)], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a"); link.href = url; link.download = name.replace(/\.[^.]+$/, "") + "-filtered.csv"; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return <div className="flex h-full min-h-0 flex-col gap-2.5 p-3 text-xs sm:p-4">
    <div className="flex shrink-0 flex-wrap items-center gap-2 border-b pb-3">
      <span className="font-medium">{t(scope ? "Preview: {rows} rows · {columns} columns" : "{rows} rows · {columns} columns", { rows: table.rows.length.toLocaleString(), columns: table.columns.length })}</span>
      <div role="group" aria-label={t("Explorer view")} className="flex gap-1">
        {([['table', 'Table'], ['schema', 'Schema'], ['distribution', 'Distribution']] as const).map(([id, label]) => <button key={id} type="button" className={`${button} ${view === id ? "bg-muted" : ""}`} aria-pressed={view === id} onClick={() => setView(id)}>{t(label)}</button>)}
      </div>
      <input type="search" aria-label={t(scope ? "Search preview rows" : "Search all rows")} placeholder={t("Filter every column…")} value={query} onChange={event => { setQuery(event.target.value); goToPage(0); }} className="h-7 min-w-32 flex-1 rounded-md border bg-background px-2" />
      <button type="button" className={button} onClick={download}>{t(scope ? "Export filtered preview" : "Export filtered")}</button>
      <button type="button" className={button} onClick={async () => { try { await navigator.clipboard.writeText(original ?? tableCsv(table.columns, table.rows)); setMessage(t(original === undefined ? "Preview CSV copied" : "Original file copied")); } catch { setMessage(t("Copy failed. Use Download instead.")); } }}>{t(original === undefined ? "Copy preview CSV" : "Copy original")}</button>
      <p className="w-full text-muted-foreground">{scope ? t("Search, statistics and export use only this preview. Column types are inferred; identifiers may be categories.") : t("All loaded rows are included in search, statistics and export. Column types are inferred; identifiers may be categories.")}
        {scope && <> {scope.total === null ? t("Total rows not scanned.") : t("Source: {rows} rows · {columns} columns", { rows: scope.total.toLocaleString(), columns: scope.columns })}
          {scope.limited && <> {t("Rows or columns are omitted from this preview.")}</>}
          {scope.cellLimit && <> {t("Long cell values are limited to {count} characters.", { count: scope.cellLimit })}</>}
        </>}</p>
      {message && <span role="status">{message}</span>}
    </div>
    <div className="flex shrink-0 flex-wrap items-center gap-2 text-muted-foreground" aria-live="polite">
      {t("{count} matching rows", { count: rows.length.toLocaleString() })}
      {view === "table" && <>
        <label className="ml-auto flex items-center gap-1.5">{t("Rows per page")}
          <select aria-label={t("Rows per page")} value={pageSize} onChange={event => { setPageSize(Number(event.target.value)); goToPage(0); }} className="h-7 rounded-md border bg-background pl-2 pr-6 text-foreground">
            {[10, 25, 50, 100, 250].map(size => <option key={size} value={size}>{size}</option>)}
          </select>
        </label>
        <span>{t("Showing {from}–{to}", { from: rows.length ? start + 1 : 0, to: Math.min(start + pageSize, rows.length) })}</span>
        <button type="button" className={button} disabled={current === 0} onClick={() => goToPage(current - 1)}>{t("Previous")}</button>
        <span>{t("Page {page} of {pages}", { page: current + 1, pages })}</span>
        <button type="button" className={button} disabled={current + 1 >= pages} onClick={() => goToPage(current + 1)}>{t("Next")}</button>
      </>}
    </div>
    <div ref={viewport} className="min-h-0 flex-1 overflow-auto rounded-lg border" aria-busy={query !== search}>
      {view === "table" && <>
        <table className="min-w-full table-fixed border-collapse text-xs leading-4" style={{ width: widths.reduce((a, b) => a + b, 0) }}>
          <colgroup>{widths.map((width, i) => <col key={i} style={{ width }} />)}</colgroup>
          <thead><tr>{table.columns.map((label, i) => <th key={i} scope="col" aria-sort={sort?.column === i ? sort.desc ? "descending" : "ascending" : "none"} className="sticky top-0 z-10 border-b bg-muted text-left align-top">
            <button type="button" className="w-full whitespace-normal px-2 py-1.5 text-left font-semibold [overflow-wrap:anywhere]" onClick={() => { setSort({ column: i, desc: sort?.column === i && !sort.desc }); goToPage(0); }}>{label}{sort?.column === i ? sort.desc ? " ↓" : " ↑" : ""}</button>
          </th>)}</tr></thead>
          <tbody>{rows.slice(start, start + pageSize).map((row, ri) => <tr key={start + ri} className="border-b border-muted/50 hover:bg-muted/30">
            {table.columns.map((_, ci) => <td key={ci} className="px-2 py-1 align-top"><div title={row[ci] ?? t("Missing value")} className="line-clamp-2 whitespace-pre-wrap [overflow-wrap:anywhere]">{row[ci] === null ? <span className="text-muted-foreground">—</span> : row[ci]}</div></td>)}
          </tr>)}</tbody>
        </table>
        {!rows.length && <p className="p-4 text-muted-foreground">{t("No matching rows.")}</p>}
      </>}
      {view === "schema" && <div className="p-3">
        <p className="mb-2 text-muted-foreground">{t(scope ? "Schema statistics use preview rows only. Missing means null, absent or empty text; zero and false are values." : "Schema statistics use the complete loaded file. Missing means null, absent or empty text; zero and false are values.")}</p>
        <table className="w-full border-collapse text-left"><thead><tr>{["Column", ...(sourceTypes ? ["Source type"] : []), "Inferred type", "Missing", "Distinct"].map(label => <th key={label} className="border-b px-2 py-2">{t(label)}</th>)}</tr></thead>
          <tbody>{table.columns.map((label, i) => <tr key={i} className="border-b border-muted"><td className="break-all px-2 py-2">{label}</td>{sourceTypes && <td className="break-all px-2 py-2">{sourceTypes[i]}</td>}<td className="px-2 py-2">{t(profiles[i].type === "number" ? "Number" : profiles[i].type === "boolean" ? "Boolean" : profiles[i].type === "date" ? "Date" : "Text")}</td><td className="px-2 py-2">{profiles[i].missing}</td><td className="px-2 py-2">{profiles[i].distinct}</td></tr>)}</tbody>
        </table>
      </div>}
      {view === "distribution" && <TableDistribution table={table} rows={rows} types={profiles.map(profile => profile.type)} />}
    </div>
  </div>;
}
export function TableFileViewer({ content, name, sourceView }: { content: string; name: string; sourceView?: React.ReactNode }) {
  const t = useT();
  const [source, setSource] = useState(false);
  const format = name.split(".").pop()?.toLowerCase() ?? "csv";
  const parsed = useMemo(() => { try { return { table: parseExplorerTable(content, format), error: null }; } catch (e) { return { table: null, error: (e as Error).message }; } }, [content, format]);
  const unsupportedJson = format === "json" && parsed.error?.startsWith("Expected a JSON array");
  const showSource = source || unsupportedJson;
  const error = content.startsWith("[Error:") ? content : parsed.error;
  return <div className="flex h-full min-h-0 flex-col overflow-hidden">
    <div className="flex shrink-0 items-center justify-between gap-2 border-b px-3 py-2 sm:px-4">
      <span className="text-xs font-medium">{t("Table explorer")}</span>
      <button type="button" className="rounded px-2 py-1 text-xs hover:bg-muted disabled:opacity-50" disabled={!!unsupportedJson} onClick={() => setSource(!source)}>{t(unsupportedJson ? "Source" : showSource ? "Table" : "Source")}</button>
    </div>
    {error && !showSource && <p role="alert" className="break-words p-3 text-xs text-muted-foreground">{t("Could not display this file as a table.")} {t(error)} {t("Use Source to inspect the original text or Download to access the complete file.")}</p>}
    {showSource ? <div className="min-h-0 flex-1 overflow-auto">{sourceView ?? <pre className="whitespace-pre p-3 text-xs">{content}</pre>}</div> : !error && parsed.table && <TableExplorer table={parsed.table} original={content} name={name} />}
  </div>;
}
