"use client";
import { useState } from "react";
import { FileSpreadsheetIcon, XIcon } from "lucide-react";
import { useT } from "@/components/i18n-provider";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { tableFilename, type PastedTable } from "@/lib/clipboard-table";

export function PastedTables({ tables, disabled, onChange }: {
  tables: PastedTable[]; disabled?: boolean; onChange: (tables: PastedTable[]) => void;
}) {
  const t = useT();
  const [activeId, setActiveId] = useState<string | null>(null);
  const active = tables.find((table) => table.id === activeId);
  const dataRows = active ? active.rows.slice(active.firstRowHeader ? 1 : 0) : [];
  const headers = active ? active.rows[0].map((value, index) => active.firstRowHeader ? value : t("Column {number}", { number: index + 1 })) : [];
  if (!tables.length) return null;
  return <>
    <div className="flex w-full flex-wrap gap-1.5 px-3 pt-2.5" aria-label={t("Pasted tables")}>
      {tables.map((table) => <div key={table.id} className="group flex min-w-0 max-w-full items-center gap-1.5 rounded-md border border-border/70 bg-muted/60 px-2 py-1 text-[11px] font-medium text-foreground/80">
        <button type="button" className="flex min-w-0 items-center gap-1.5 text-left" onClick={() => setActiveId(table.id)}>
          <FileSpreadsheetIcon className="size-3 shrink-0 text-emerald-600" />
          <span className="shrink-0">{t("Pasted table")}</span>
          <span className="min-w-0 truncate font-normal text-muted-foreground">{t("{rows} data rows × {columns} columns", { rows: table.rows.length - (table.firstRowHeader ? 1 : 0), columns: table.rows[0].length })}</span>
        </button>
        <button type="button" disabled={disabled} aria-label={t("Remove pasted table")}
          className="shrink-0 rounded p-0.5 text-current/60 opacity-60 transition-all hover:bg-destructive/10 hover:!text-destructive group-hover:opacity-100 disabled:opacity-40"
          onClick={() => onChange(tables.filter((item) => item.id !== table.id))}><XIcon className="size-2.5" /></button>
      </div>)}
    </div>
    <Dialog open={Boolean(active)} onOpenChange={(open) => { if (!open) setActiveId(null); }}>
      <DialogContent className="flex max-h-[85dvh] min-w-0 flex-col overflow-hidden sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>{t("Pasted table")}</DialogTitle>
          <DialogDescription>{active && tableFilename(active)}</DialogDescription>
        </DialogHeader>
        {active && <>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={active.firstRowHeader} disabled={disabled}
              onChange={(event) => onChange(tables.map((table) => table.id === active.id ? { ...table, firstRowHeader: event.target.checked, uploadedPath: undefined } : table))} />
            {t("Use first row as column names")}
          </label>
          <p className="text-xs text-muted-foreground">{t("Saved as CSV when sent. Cell text is preserved; formulas are not calculated.")}</p>
          <div className="min-h-0 overflow-auto rounded-md border">
            <table className="w-full border-collapse text-left text-xs">
              <thead className="sticky top-0 bg-muted"><tr>{headers.map((header, i) => <th key={i} className="min-w-28 max-w-80 whitespace-pre-wrap border-b px-3 py-2 align-top font-medium">{header}</th>)}</tr></thead>
              <tbody>{dataRows.slice(0, 50).map((row, ri) => <tr key={ri} className="border-b last:border-b-0">{row.map((cell, ci) => <td key={ci} className="min-w-28 max-w-80 whitespace-pre-wrap break-words px-3 py-1.5 align-top">{cell}</td>)}</tr>)}</tbody>
            </table>
          </div>
          <p className="text-xs text-muted-foreground">{t("Preview shows up to 50 rows. All {count} data rows will be saved.", { count: dataRows.length })}</p>
        </>}
        <div className="flex justify-end"><Button type="button" variant="outline" onClick={() => setActiveId(null)}>{t("Close")}</Button></div>
      </DialogContent>
    </Dialog>
  </>;
}
