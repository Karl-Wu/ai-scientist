"use client";

import { useDeferredValue, useMemo, useState } from "react";
import { parseDelimitedText } from "@/lib/delimited-text";

export const CSV_PAGE_SIZE = 250;

export function parseCsv(text: string): string[][] {
  return parseDelimitedText(text, ",", { skipEmptyLines: true });
}

/** Pagination bounds the DOM without sacrificing full-data search or copying. */
export function CsvViewer({ content }: { content: string }) {
  const rows = useMemo(() => parseCsv(content), [content]);
  const [query, setQuery] = useState("");
  const search = useDeferredValue(query.trim().toLowerCase());
  const [page, setPage] = useState(0);
  const [copyState, setCopyState] = useState("");
  const body = useMemo(() => rows.slice(1), [rows]);
  const columnWidths = useMemo(() => (rows[0] ?? []).map((header, index) => {
    // Estimate from a bounded sample so long descriptions cannot dominate the layout.
    const textWidth = (value: string) => Array.from(value).reduce((width, char) => width + (/[^\x00-\xff]/.test(char) ? 12 : 7), 0);
    const values = body.slice(0, 100).map((row) => row[index] ?? "");
    const contentWidth = Math.max(0, ...values.map((value) => textWidth(value)));
    return Math.max(80, Math.min(140, textWidth(header) + 16), Math.min(240, contentWidth + 16));
  }), [rows, body]);
  const matches = useMemo(() => search
    ? body.filter((row) => row.some((cell) => cell.toLowerCase().includes(search)))
    : body, [body, search]);
  const pages = Math.max(1, Math.ceil(matches.length / CSV_PAGE_SIZE));
  const currentPage = Math.min(page, pages - 1);
  const start = currentPage * CSV_PAGE_SIZE;
  const displayed = matches.slice(start, start + CSV_PAGE_SIZE);
  if (rows.length === 0) return null;
  return (
    <div className="flex h-full flex-col">
      {(body.length > CSV_PAGE_SIZE || query.length > 0) && (
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b p-2 text-xs">
          <input
            type="search" aria-label="Search all CSV rows" placeholder="Search all rows…"
            className="min-w-32 flex-1 rounded border bg-background px-2 py-1"
            value={query} onChange={(event) => { setQuery(event.target.value); setPage(0); }}
          />
          <span aria-live="polite">{matches.length ? start + 1 : 0}–{Math.min(start + CSV_PAGE_SIZE, matches.length)} of {matches.length.toLocaleString()} rows</span>
          <button className="rounded border px-2 py-1 disabled:opacity-40" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>Previous</button>
          <span>Page {currentPage + 1} of {pages}</span>
          <button className="rounded border px-2 py-1 disabled:opacity-40" disabled={currentPage + 1 >= pages} onClick={() => setPage(currentPage + 1)}>Next</button>
          <button className="rounded border px-2 py-1" onClick={async () => {
            try { await navigator.clipboard.writeText(content); setCopyState("Full CSV copied"); }
            catch { setCopyState("Copy failed — use Download instead"); }
          }}>Copy full CSV</button>
          {copyState && <span role="status">{copyState}</span>}
          <p className="w-full text-muted-foreground">Search includes every row. Browser Find searches only the current page; Download and Copy include the full file.</p>
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-auto" aria-busy={query.trim().toLowerCase() !== search}>
        <table className="min-w-full table-fixed border-collapse text-xs leading-4" style={{ width: columnWidths.reduce((sum, width) => sum + width, 0) }}>
          <colgroup>{columnWidths.map((width, i) => <col key={i} style={{ width }} />)}</colgroup>
          <thead><tr>{rows[0].map((cell, i) => <th scope="col" key={i} className="sticky top-0 z-10 whitespace-normal border-b bg-muted px-2 py-1.5 text-left align-top font-semibold [overflow-wrap:anywhere]">{cell}</th>)}</tr></thead>
          <tbody>{displayed.map((row, ri) => (
            <tr key={start + ri} className="border-b border-muted/50 hover:bg-muted/30">
              {row.map((cell, ci) => <td key={ci} className="px-2 py-1 align-top text-muted-foreground">
                <div title={cell} className="line-clamp-2 whitespace-pre-wrap [overflow-wrap:anywhere]">{cell}</div>
              </td>)}
            </tr>
          ))}</tbody>
        </table>
        {!matches.length && <p className="p-4 text-sm text-muted-foreground">No matching rows.</p>}
      </div>
    </div>
  );
}
