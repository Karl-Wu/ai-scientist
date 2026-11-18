"use client";
import { useMemo } from "react";
import { TableExplorer } from "../table-explorer";

export interface TableSummary {
  format: string;
  kind: "table";
  file_size: number;
  num_rows: number | null;
  num_columns: number;
  columns: { name: string; dtype: string }[];
  head: (string | number | boolean | null)[][];
  rows_truncated?: boolean;
  columns_truncated?: boolean;
  collections?: string[];
  collection_labels?: Record<string, string>;
  selected?: string;
  collections_truncated?: boolean;
  cell_limit?: number;
  note?: string;
  preview_error?: string;
}

/** Empty cells and booleans are not quantitative measurements. */
export function numericCell(value: unknown): number | null {
  if (typeof value !== "number" && typeof value !== "string") return null;
  if (typeof value === "string" && (!value.trim() || !/^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(value.trim()))) return null;
  const n = Number(value);
  if (!Number.isFinite(n) || (Number.isInteger(n) && !Number.isSafeInteger(n))) return null;
  return n;
}

export default function DataTable({ summary }: { summary: TableSummary }) {
  const table = useMemo(() => ({ columns: summary.columns.map(column => column.name),
    rows: summary.head.map(row => summary.columns.map((_, i) => row[i] === null || row[i] === undefined ? null : String(row[i]))) }), [summary]);
  if (summary.preview_error) return <p role="alert" className="break-words p-4 text-xs text-muted-foreground">{summary.preview_error}</p>;
  return <TableExplorer table={table} name={`preview.${summary.format}`} sourceTypes={summary.columns.map(column => column.dtype)}
    scope={{ total: summary.num_rows, columns: summary.num_columns,
      limited: !!summary.rows_truncated || !!summary.columns_truncated || (summary.num_rows !== null && summary.num_rows > summary.head.length), cellLimit: summary.cell_limit }} />;
}
