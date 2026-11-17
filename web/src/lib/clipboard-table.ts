import { parseDelimitedText, serializeDelimitedText } from "./delimited-text";

export const MAX_PASTED_TABLES = 3;
export const MAX_TABLE_CHARACTERS = 2 * 1024 * 1024;
export const MAX_TABLE_CELLS = 100_000;
const MAX_COLUMNS = 200;
const MAX_ROWS = 10_000;
export interface PastedTable {
  id: string;
  rows: string[][];
  firstRowHeader: boolean;
  /** Reuse a successful upload after a rejected/failed message send. */
  uploadedPath?: string;
}
export class ClipboardTableError extends Error {}
function tooLarge(): never { throw new ClipboardTableError("Table too large"); }
function checkRows(rows: string[][]): string[][] {
  const columns = Math.max(0, ...rows.map((row) => row.length));
  if (rows.length > MAX_ROWS || columns > MAX_COLUMNS || rows.length * columns > MAX_TABLE_CELLS) tooLarge();
  return rows.map((row) => Array.from({ length: columns }, (_, index) => row[index] ?? ""));
}
function cellText(cell: Element): string {
  const copy = cell.cloneNode(true) as Element;
  copy.querySelectorAll("script,style,table").forEach((node) => node.remove());
  copy.querySelectorAll("br").forEach((node) => node.replaceWith("\n"));
  return copy.textContent ?? "";
}
function htmlTable(html: string): string[][] | null {
  if (!/<table[\s>]/i.test(html)) return null;
  if (html.length > MAX_TABLE_CHARACTERS * 2) tooLarge();
  // Parse in a detached document; never attach copied markup or use innerHTML in the UI.
  const table = new DOMParser().parseFromString(html, "text/html").querySelector("table");
  if (!table) return null;
  const rows: string[][] = [];
  const tr = Array.from(table.querySelectorAll("tr")).filter((row) => row.closest("table") === table);
  if (tr.length > MAX_ROWS) tooLarge();
  for (const [ri, row] of tr.entries()) {
    rows[ri] ??= [];
    let column = 0;
    for (const cell of Array.from(row.children).filter((node) => /^(TD|TH)$/.test(node.tagName))) {
      while (rows[ri][column] !== undefined) column++;
      const width = Math.max(1, Number.parseInt(cell.getAttribute("colspan") ?? "1", 10) || 1);
      const height = Math.max(1, Number.parseInt(cell.getAttribute("rowspan") ?? "1", 10) || 1);
      if (column + width > MAX_COLUMNS || ri + height > MAX_ROWS || (ri + height) * (column + width) > MAX_TABLE_CELLS) tooLarge();
      for (let r = ri; r < ri + height; r++) {
        rows[r] ??= [];
        for (let c = column; c < column + width; c++) {
          // A malformed overlapping span cannot safely represent a rectangle.
          if (rows[r][c] !== undefined) return null;
          rows[r][c] = r === ri && c === column ? cellText(cell) : "";
        }
      }
      column += width;
    }
  }
  return checkRows(rows);
}
/** HTML preserves embedded line breaks; TSV is the fallback when no table markup exists. */
export function parseClipboardTable(html: string, text: string): string[][] | null {
  if (text.length > MAX_TABLE_CHARACTERS && (/<table[\s>]/i.test(html) || text.includes("\t"))) tooLarge();
  let rows = htmlTable(html);
  if (!rows && text.includes("\t")) {
    try {
      const parsed = parseDelimitedText(text, "\t", { strict: true, maxCells: MAX_TABLE_CELLS });
      if (parsed.length && parsed[0].length > 1 && parsed.every((row) => row.length === parsed[0].length)) rows = checkRows(parsed);
    } catch (error) {
      if (error instanceof ClipboardTableError || (error as Error).message === "Table too large") tooLarge();
      return null;
    }
  }
  if (!rows?.some((row) => row.some((value) => value.trim()))) return null;
  if (rows.reduce((size, row) => size + row.reduce((n, value) => n + value.length, 0), 0) > MAX_TABLE_CHARACTERS) tooLarge();
  return rows;
}
export const tableFilename = (table: PastedTable) => `pasted-table-${table.id}.csv`;
export function tableCsv(table: PastedTable): string {
  const rows = table.firstRowHeader ? table.rows : [table.rows[0].map((_, i) => `column_${i + 1}`), ...table.rows];
  return serializeDelimitedText(rows);
}
/** Validate optional persisted drafts without changing any cell values. */
export function normalizePastedTables(value: unknown): PastedTable[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, MAX_PASTED_TABLES).flatMap((table) => {
    if (!table || typeof table !== "object" || !/^[a-zA-Z0-9-]{1,64}$/.test(table.id) ||
      !Array.isArray(table.rows) || !table.rows.length || table.rows.length > MAX_ROWS) return [];
    let count = 0, length = 0;
    for (const row of table.rows) {
      if (!Array.isArray(row) || !row.length || row.length > MAX_COLUMNS || row.length !== table.rows[0].length) return [];
      for (const cell of row) {
        if (typeof cell !== "string" || ++count > MAX_TABLE_CELLS || (length += cell.length) > MAX_TABLE_CHARACTERS) return [];
      }
    }
    return [{ id: table.id, rows: table.rows, firstRowHeader: table.firstRowHeader !== false,
      ...(typeof table.uploadedPath === "string" && table.uploadedPath.length < 2048 ? { uploadedPath: table.uploadedPath } : {}) }];
  });
}
export async function uploadPastedTables(tables: PastedTable[], upload: (files: File[]) => Promise<string[]>, remember: (id: string, path: string) => void): Promise<string[]> {
  const paths: string[] = [];
  for (const table of tables) {
    if (table.uploadedPath) { paths.push(table.uploadedPath); continue; }
    const uploaded = await upload([new File([tableCsv(table)], tableFilename(table), { type: "text/csv;charset=utf-8" })]);
    if (uploaded.length !== 1) throw new Error("Table upload failed");
    remember(table.id, uploaded[0]);
    paths.push(uploaded[0]);
  }
  return paths;
}
