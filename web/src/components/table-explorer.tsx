"use client";
import { useDeferredValue, useMemo, useRef, useState, type ReactNode } from "react";
import { ChevronDownIcon, ChevronLeftIcon, ChevronRightIcon, CopyIcon, DownloadIcon, SearchIcon } from "lucide-react";
import { TableDistribution } from "./table-distribution";
import { useInlineTableCells } from "./use-inline-table-cells";
import { useT } from "@/components/i18n-provider";
import { Button } from "@/components/ui/button";
import { columnProfile, filterSortTable, parseExplorerTable, TABLE_PAGE_SIZE, tableCsv, tableDelimiter, updateDelimitedTable, type ExplorerTable } from "@/lib/table-explorer";
import type { TableSaveResult } from "@/lib/use-sandbox";
import { cn } from "@/lib/utils";

export interface PreviewScope { total: number | null; columns: number; limited: boolean; cellLimit?: number }
export function TableExplorer({ table, original, name = "data.csv", scope, sourceTypes, renderCell, fileActions }: {
  table: ExplorerTable; original?: string; name?: string; scope?: PreviewScope; sourceTypes?: string[];
  renderCell?: (row: number, column: number, value: string | null) => ReactNode;
  fileActions?: ReactNode;
}) {
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
  const editable = renderCell !== undefined;
  const spreadsheet = fileActions !== undefined;
  const sourceIndexes = useMemo(() => editable ? new Map(table.rows.map((row, index) => [row, index])) : null, [table, editable]);
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
  const dimensions = t(scope ? "Preview: {rows} rows · {columns} columns" : "{rows} rows · {columns} columns", { rows: table.rows.length.toLocaleString(), columns: table.columns.length });
  const exportLabel = t(scope ? "Export filtered preview" : "Export filtered");
  const copyLabel = t(original === undefined ? "Copy preview CSV" : "Copy original");
  return <div className={cn("flex h-full min-h-0 flex-col text-xs", !spreadsheet && "gap-2.5 p-3 sm:p-4")}>
    <div className={cn("flex shrink-0 flex-wrap items-center gap-2 border-b", spreadsheet ? "bg-background px-2.5 py-1.5" : "pb-3")}>
      {!spreadsheet && <span className="font-medium">{dimensions}</span>}
      <div role="group" aria-label={t("Explorer view")} className={cn("flex gap-1", spreadsheet && "shrink-0 rounded-md bg-muted/50 p-0.5")}>
        {([['table', 'Table'], ['schema', 'Schema'], ['distribution', 'Distribution']] as const).map(([id, label]) => <Button key={id} type="button" size="xs"
          variant={spreadsheet ? "ghost" : "outline"} className={cn(view === id && (spreadsheet ? "bg-background shadow-xs" : "bg-muted"))}
          aria-pressed={view === id} onClick={() => setView(id)}>{t(label)}</Button>)}
      </div>
      <div className={cn("flex max-w-full flex-wrap items-center gap-1", spreadsheet && "ml-auto")}>
        <Button type="button" variant={spreadsheet ? "ghost" : "outline"} size={spreadsheet ? "icon-xs" : "xs"}
          title={exportLabel} aria-label={exportLabel} onClick={download}>{spreadsheet ? <DownloadIcon aria-hidden /> : exportLabel}</Button>
        <Button type="button" variant={spreadsheet ? "ghost" : "outline"} size={spreadsheet ? "icon-xs" : "xs"}
          title={copyLabel} aria-label={copyLabel} onClick={async () => {
            try { await navigator.clipboard.writeText(original ?? tableCsv(table.columns, table.rows)); setMessage(t(original === undefined ? "Preview CSV copied" : "Original file copied")); }
            catch { setMessage(t("Copy failed. Use Download instead.")); }
          }}>{spreadsheet ? <CopyIcon aria-hidden /> : copyLabel}</Button>
      </div>
      <div className={cn("relative flex-1", spreadsheet ? "min-w-24" : "min-w-32")}>
        {spreadsheet && <SearchIcon aria-hidden className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" />}
        <input type="search" aria-label={t(scope ? "Search preview rows" : "Search all rows")} placeholder={t("Filter every column…")} value={query} onChange={event => { setQuery(event.target.value); goToPage(0); }} className={cn("h-7 w-full rounded-md border bg-background px-2", spreadsheet && "pl-7")} />
      </div>
      {fileActions}
      {(!spreadsheet || view !== "table") && <p className="w-full text-muted-foreground">{scope ? t("Search, statistics and export use only this preview. Column types are inferred; identifiers may be categories.") : t("All loaded rows are included in search, statistics and export. Column types are inferred; identifiers may be categories.")}
        {scope && <> {scope.total === null ? t("Total rows not scanned.") : t("Source: {rows} rows · {columns} columns", { rows: scope.total.toLocaleString(), columns: scope.columns })}
          {scope.limited && <> {t("Rows or columns are omitted from this preview.")}</>}
          {scope.cellLimit && <> {t("Long cell values are limited to {count} characters.", { count: scope.cellLimit })}</>}
        </>}</p>}
      {message && <span role="status">{message}</span>}
    </div>
    <div ref={viewport} className={cn("min-h-0 flex-1 overflow-auto", !spreadsheet && "rounded-lg border")} aria-busy={query !== search}>
      {view === "table" && <>
        <table className="min-w-full table-fixed border-collapse text-xs leading-4" style={{ width: widths.reduce((a, b) => a + b, 0) }}>
          <colgroup>{widths.map((width, i) => <col key={i} style={{ width }} />)}</colgroup>
          <thead><tr>{table.columns.map((label, i) => <th key={i} scope="col" aria-sort={sort?.column === i ? sort.desc ? "descending" : "ascending" : "none"} className={cn("sticky top-0 z-10 border-b bg-muted text-left align-top", spreadsheet && "border-r border-border/65 last:border-r-0")}>
            <button type="button" title={label} className="min-h-8 w-full whitespace-normal px-2.5 py-1.5 text-left font-semibold [overflow-wrap:anywhere]" onClick={() => { setSort({ column: i, desc: sort?.column === i && !sort.desc }); goToPage(0); }}>{label}{sort?.column === i ? sort.desc ? " ↓" : " ↑" : ""}</button>
          </th>)}</tr></thead>
          <tbody>{rows.slice(start, start + pageSize).map((row, ri) => <tr key={sourceIndexes?.get(row) ?? start + ri} className={cn("border-b", spreadsheet ? "border-border/65" : "border-muted/50 hover:bg-muted/30")}>
            {table.columns.map((_, ci) => <td key={ci} className={cn("align-top", spreadsheet ? "border-r border-border/65 p-0 last:border-r-0" : "px-2 py-1")}>
              {(sourceIndexes && renderCell?.(sourceIndexes.get(row)!, ci, row[ci])) ??
                <div className={cn(spreadsheet && "flex min-h-8 items-center px-2.5 py-1.5")}><div title={row[ci] ?? t("Missing value")} className="line-clamp-2 whitespace-pre-wrap [overflow-wrap:anywhere]">{row[ci] === null ? <span className="text-muted-foreground">—</span> : row[ci]}</div></div>}
            </td>)}
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
    <div className={cn("flex shrink-0 flex-wrap items-center gap-2 border-t text-muted-foreground", spreadsheet ? "bg-muted/20 px-2.5 py-1.5" : "pt-2.5")} aria-live="polite">
      {spreadsheet && !search ? dimensions : t("{count} matching rows", { count: rows.length.toLocaleString() })}
      {spreadsheet && scope?.limited && <span>{t("Rows or columns are omitted from this preview.")}</span>}
      {spreadsheet && editable && view === "table" && !search && <span className="hidden border-l pl-2 sm:inline">{t("Double-click a cell to edit")}</span>}
      {view === "table" && <>
        <label className="ml-auto flex items-center gap-1.5">{t("Rows per page")}
          <span className="relative">
            <select aria-label={t("Rows per page")} value={pageSize} onChange={event => { setPageSize(Number(event.target.value)); goToPage(0); }} className="h-7 appearance-none rounded-md border bg-background pl-2 pr-8 text-foreground">
              {[10, 25, 50, 100, 250].map(size => <option key={size} value={size}>{size}</option>)}
            </select>
            <ChevronDownIcon className="pointer-events-none absolute right-2 top-1/2 size-3 -translate-y-1/2" aria-hidden />
          </span>
        </label>
        <span>{t("Showing {from}–{to}", { from: rows.length ? start + 1 : 0, to: Math.min(start + pageSize, rows.length) })}</span>
        <button type="button" className={`${button} flex size-7 items-center justify-center !p-0`} aria-label={t("Previous")} title={t("Previous")} disabled={current === 0} onClick={() => goToPage(current - 1)}><ChevronLeftIcon className="size-3.5" aria-hidden /></button>
        <span>{t("Page {page} of {pages}", { page: current + 1, pages })}</span>
        <button type="button" className={`${button} flex size-7 items-center justify-center !p-0`} aria-label={t("Next")} title={t("Next")} disabled={current + 1 >= pages} onClick={() => goToPage(current + 1)}><ChevronRightIcon className="size-3.5" aria-hidden /></button>
      </>}
    </div>
  </div>;
}
export interface InlineTableEditing {
  revision?: string;
  onSave: (content: string, revision: string) => Promise<TableSaveResult>;
  onDirtyChange: (dirty: boolean) => void;
}

export function TableFileViewer({ content, name, sourceView, editing, unavailable }: {
  content: string; name: string; sourceView?: ReactNode; editing?: InlineTableEditing; unavailable?: ReactNode;
}) {
  const t = useT();
  const [source, setSource] = useState(false);
  const delimiter = tableDelimiter(name);
  const editor = useInlineTableCells({
    snapshot: content,
    revision: editing?.revision,
    onDirtyChange: editing?.onDirtyChange,
    onSave: async ({ snapshot, revision, cells }) => {
      if (!editing || !delimiter) return "error";
      return editing.onSave(updateDelimitedTable(snapshot, delimiter, cells), revision);
    },
  });
  const base = editor.draft?.snapshot ?? content;
  const format = name.split(".").pop()?.toLowerCase() ?? "csv";
  const parsed = useMemo(() => { try { return { table: parseExplorerTable(base, format), error: null }; } catch (e) { return { table: null, error: (e as Error).message }; } }, [base, format]);

  // Non-tabular or invalid JSON belongs to the ordinary source viewer, without
  // table-specific chrome. Object arrays retain the table/source toggle.
  if (format === "json" && parsed.error) {
    return sourceView ?? <pre className="h-full overflow-auto whitespace-pre p-3 text-xs">{content}</pre>;
  }
  if (unavailable && !editor.draft) return unavailable;
  const error = base.startsWith("[Error:") ? base : parsed.error;
  const table = parsed.table;
  const renderCell = (editor.draft?.revision ?? editing?.revision) && delimiter && table
    ? (row: number, column: number, value: string | null) => editor.renderCell(row, column, value,
      t("Row {row}, column {column}", { row: row + 1, column: table.columns[column] }))
    : undefined;
  const spreadsheet = Boolean(delimiter && !error && table);
  const actions = <div className="ml-auto flex shrink-0 items-center gap-1">
    <Button type="button" variant="ghost" size="xs" onClick={() => setSource(!source)}>{t(source ? "Table" : "Source")}</Button>
    {renderCell && editor.actions}
  </div>;
  return <div className="flex h-full min-h-0 flex-col overflow-hidden">
    {(!spreadsheet || source) && <div className="flex shrink-0 items-center gap-2 border-b px-2.5 py-1.5">
      <span className="mr-auto text-xs font-medium">{t("Table explorer")}</span>
      {actions}
    </div>}
    {editor.error && <p role="alert" className="shrink-0 border-b px-2.5 py-1.5 text-xs text-destructive">{t(editor.error)}</p>}
    {error && !source && <p role="alert" className="break-words p-3 text-xs text-muted-foreground">{t("Could not display this file as a table.")} {t(error)} {t("Use Source to inspect the original text or Download to access the complete file.")}</p>}
    {source && <div className="min-h-0 flex-1 overflow-auto">{sourceView ?? <pre className="whitespace-pre p-3 text-xs">{content}</pre>}</div>}
    {!error && table && <div className={source ? "hidden" : "min-h-0 flex-1"}>
      <TableExplorer table={table} original={base} name={name} renderCell={renderCell} fileActions={spreadsheet ? actions : undefined} />
    </div>}
  </div>;
}
