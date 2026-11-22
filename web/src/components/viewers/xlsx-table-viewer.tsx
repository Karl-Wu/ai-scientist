"use client";

import { lazy, Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ChevronDownIcon, RefreshCwIcon } from "lucide-react";
import { useT } from "@/components/i18n-provider";
import { Button } from "@/components/ui/button";
import { useInlineTableCells } from "@/components/use-inline-table-cells";
import { apiFetch } from "@/lib/projects";
import type { ViewerProps } from "@/lib/viewers/registry";
import DataTable, { type TableSummary } from "./data-table";

const ArrayDataViewer = lazy(() => import("./arraydata-viewer"));

interface WorksheetTable extends TableSummary {
  selected: string;
  collections: string[];
  readOnly: boolean;
  revision: string;
  protectedCells: string[];
  protectedRanges: [top: number, left: number, bottom: number, right: number][];
}

function cellAddress(row: number, column: number): string {
  let letters = "";
  for (let n = column + 1; n > 0; n = Math.floor((n - 1) / 26)) {
    letters = String.fromCharCode(65 + (n - 1) % 26) + letters;
  }
  return letters + String(row + 2); // Worksheet row 1 is used for column labels.
}

export default function XlsxTableViewer({ path, name, projectId, generation, officeLink, onDirtyChange, onSavingChange }: ViewerProps & {
  generation: number;
  officeLink: ReactNode;
}) {
  const t = useT();
  const [summary, setSummary] = useState<WorksheetTable | null>(null);
  const [sheet, setSheet] = useState("");
  const [retry, setRetry] = useState(0);
  const [loading, setLoading] = useState(true);
  const [failure, setFailure] = useState("");
  const [fallback, setFallback] = useState(false);
  const pending = useRef<AbortController | null>(null);
  const endpoint = "/sandbox/office/xlsx-table?path=" + encodeURIComponent(path);
  const editor = useInlineTableCells({
    snapshot: summary,
    revision: summary?.revision,
    onDirtyChange,
    onSavingChange,
    onSave: async ({ snapshot, revision, cells }) => {
      if (!snapshot) return "error";
      const changes = Array.from(cells, ([row, values]) =>
        Array.from(values, ([column, value]) => ({ ref: cellAddress(row, column), value }))).flat();
      const response = await apiFetch(endpoint, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", "If-Match": revision },
        body: JSON.stringify({ sheet: snapshot.selected, changes }),
      }, projectId);
      if (response.status === 409) return "conflict";
      if (response.status === 413) return "too-large";
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || "Could not save the table. Please try again.");
      pending.current?.abort();
      setSummary({ ...data.table, revision: data.revision });
      setLoading(false);
      setFailure("");
      return "saved";
    },
  });
  useEffect(() => {
    const controller = new AbortController();
    pending.current = controller;
    setLoading(true);
    setFailure("");
    setFallback(false);
    const selected = sheet ? "&sheet=" + encodeURIComponent(sheet) : "";
    void apiFetch(endpoint + selected, { signal: controller.signal }, projectId)
      .then(async (response) => {
        if (controller.signal.aborted) return;
        if ([404, 413, 422, 503].includes(response.status)) {
          setFallback(true);
          return;
        }
        const data = await response.json();
        if (!response.ok) throw new Error(data.detail || "Could not preview workbook");
        if (!controller.signal.aborted) setSummary(data);
      })
      .catch((error) => { if (!controller.signal.aborted) setFailure(String(error.message)); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [endpoint, generation, projectId, retry, sheet]);

  const table = editor.draft?.snapshot ?? summary;
  const protectedCells = useMemo(() => new Set(table?.protectedCells), [table]);
  const actions = <div className="ml-auto flex flex-wrap items-center gap-1">
    <Button type="button" variant="ghost" size="icon-xs" onClick={() => setRetry(n => n + 1)} disabled={loading || editor.dirty || editor.saving}
      aria-label={t("Refresh Office preview")} title={t("Refresh Office preview")}><RefreshCwIcon aria-hidden /></Button>
    {officeLink}
    {table && !table.readOnly && !fallback && editor.actions}
  </div>;
  if (fallback && !editor.draft) {
    return <Suspense fallback={<p className="p-4 text-xs">{t("Loading workbook…")}</p>}>
      <ArrayDataViewer key={retry + ":" + generation} path={path} name={name} projectId={projectId} content={null}
        toolbarActions={<><span className="text-xs text-muted-foreground">{t("Read only")}</span>{actions}</>} compact />
    </Suspense>;
  }
  return <div className="flex h-full min-h-0 flex-col overflow-hidden" aria-busy={loading}>
    {table && <div className="flex shrink-0 items-center gap-2 border-b px-2.5 py-1.5 text-xs">
      <label className="flex min-w-0 items-center gap-2">
        <span className="text-muted-foreground">{t("Sheet")}</span>
        <span className="relative min-w-0">
          <select className="h-7 max-w-full appearance-none truncate rounded-md border bg-background pl-2 pr-7"
            value={sheet || table.selected} disabled={loading || editor.dirty || editor.saving} onChange={(event) => {
              setLoading(true);
              setSheet(event.target.value);
            }}>
            {table.collections.map(name => <option key={name} value={name}>{name}</option>)}
          </select>
          <ChevronDownIcon aria-hidden className="pointer-events-none absolute top-1/2 right-2 size-3 -translate-y-1/2 text-muted-foreground" />
        </span>
      </label>
      {table.readOnly && <span className="text-muted-foreground">{t("Read only")}</span>}
    </div>}
    {(editor.error || failure) && <p role="alert" className="shrink-0 border-b px-2.5 py-1.5 text-xs text-destructive">{t(editor.error || failure)}</p>}
    {table ? <div className="min-h-0 flex-1">
      <DataTable key={table.selected} summary={table} fileActions={actions}
        renderCell={table.readOnly || ((loading || failure) && !editor.draft) ? undefined : (row, column, value) => {
          const address = cellAddress(row, column);
          const r = row + 2, c = column + 1;
          if (protectedCells.has(address) || table.protectedRanges.some(([top, left, bottom, right]) =>
            r >= top && r <= bottom && c >= left && c <= right)) {
            return <div title={t("Open this cell in Office to edit.")} className="flex min-h-8 items-center px-2.5 py-1.5">
              <span className="line-clamp-2 whitespace-pre-wrap [overflow-wrap:anywhere]">{value ?? "—"}</span>
            </div>;
          }
          return editor.renderCell(row, column, value, t("Cell {address}", { address }));
        }} />
    </div> : <>
      <div className="flex shrink-0 border-b p-2">{actions}</div>
      {loading && <p role="status" className="p-4 text-xs">{t("Loading workbook…")}</p>}
    </>}
  </div>;
}
