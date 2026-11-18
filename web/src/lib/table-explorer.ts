import { parseDelimitedText, serializeDelimitedText } from "./delimited-text";
export interface ExplorerTable { columns: string[]; rows: (string | null)[][] }
export type ColumnType = "number" | "boolean" | "date" | "text";
export const TABLE_PAGE_SIZE = 100;
export function tableNumber(value: string | null): number | null {
  if (value === null || !/^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(value.trim()) || /^[+-]?0\d/.test(value.trim())) return null;
  const n = Number(value);
  return Number.isFinite(n) && (!Number.isInteger(n) || Number.isSafeInteger(n)) ? n : null;
}
// Scan value boundaries without converting JSON numbers to JS numbers (IDs may exceed 2^53).
function jsonValueEnd(text: string, start: number): number {
  let depth = 0, quoted = false, escaped = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (quoted) { if (escaped) escaped = false; else if (c === "\\") escaped = true; else if (c === '"') { quoted = false; if (!depth) return i + 1; } continue; }
    if (c === '"') quoted = true;
    else if (c === "[" || c === "{") depth++;
    else if (c === "]" || c === "}") { if (!depth) return i; if (--depth === 0) return i + 1; }
    else if (!depth && (c === "," || /\s/.test(c))) return i;
  }
  return text.length;
}
function objectCells(text: string): Map<string, string | null> {
  const parsed = JSON.parse(text);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Expected JSON objects in each row.");
  const cells = new Map<string, string | null>();
  let i = 1;
  const skip = () => { while (/\s/.test(text[i] ?? "") && i < text.length) i++; };
  while (i < text.length) {
    skip(); if (text[i] === "}") break;
    const end = jsonValueEnd(text, i), key = JSON.parse(text.slice(i, end));
    i = end; skip(); i++; skip();
    const valueEnd = jsonValueEnd(text, i), raw = text.slice(i, valueEnd).trim();
    cells.set(key, raw === "null" ? null : raw.startsWith('"') ? JSON.parse(raw) : raw);
    i = valueEnd; skip(); if (text[i] === ",") i++;
  }
  return cells;
}
export function parseExplorerTable(content: string, format: string): ExplorerTable {
  const text = ["csv", "tsv"].includes(format) ? content.replace(/^\uFEFF/, "") : content.replace(/^\uFEFF/, "").trim();
  if (format === "csv" || format === "tsv") {
    const parsed = parseDelimitedText(text, format === "csv" ? "," : "\t", { strict: true, skipEmptyLines: true, maxCells: 1_000_000 });
    const width = parsed.reduce((n, row) => Math.max(n, row.length), 0);
    if (width > 1000 || width * parsed.length > 1_000_000) throw new Error("Table has too many columns. Use Download to access the complete file.");
    return { columns: Array.from({ length: width }, (_, i) => parsed[0]?.[i] || `Column ${i + 1}`), rows: parsed.slice(1).map(row => Array.from({ length: width }, (_, i) => row[i] ?? null)) };
  }
  const records: Map<string, string | null>[] = [];
  if (format === "json") {
    if (!Array.isArray(JSON.parse(text))) throw new Error("Expected a JSON array of objects. Use Source to view this file.");
    let i = 1;
    while (i < text.length) {
      while (/\s/.test(text[i] ?? "") && i < text.length) i++;
      if (text[i] === "]") break;
      const end = jsonValueEnd(text, i); records.push(objectCells(text.slice(i, end))); i = end;
      while (/\s/.test(text[i] ?? "") && i < text.length) i++;
      if (text[i] === ",") i++;
    }
  } else {
    for (const [i, line] of text.split(/\r?\n/).entries()) {
      if (!line.trim()) continue;
      try { records.push(objectCells(line.trim())); } catch { throw new Error(`Invalid JSON object at line ${i + 1}.`); }
    }
  }
  const columns = [...new Set(records.flatMap(row => [...row.keys()]))];
  if (columns.length > 1000 || columns.length * records.length > 1_000_000) throw new Error("Table is too large to explore. Use Download to access the complete file.");
  return { columns, rows: records.map(row => columns.map(key => row.get(key) ?? null)) };
}
export function columnProfile(rows: ExplorerTable["rows"], index: number) {
  let missing = 0, numeric = true, boolean = true, date = true;
  const distinct = new Set<string>();
  for (const row of rows) {
    const value = row[index];
    if (value === null || value.trim() === "") { missing++; continue; }
    distinct.add(value); numeric &&= tableNumber(value) !== null; boolean &&= /^(true|false)$/i.test(value.trim()); date &&= isoCalendarDate(value) !== null;
  }
  const type: ColumnType = distinct.size && numeric ? "number" : distinct.size && boolean ? "boolean" : distinct.size && date ? "date" : "text";
  return { type, missing, distinct: distinct.size };
}
export function filterSortTable(table: ExplorerTable, query: string, sort: { column: number; desc: boolean } | null, types: ColumnType[]) {
  const rows = table.rows.filter(row => row.some(value => (value ?? "").toLowerCase().includes(query.trim().toLowerCase())));
  if (sort) rows.sort((a, b) => {
    const av = a[sort.column], bv = b[sort.column];
    const am = av === null || av.trim() === "", bm = bv === null || bv.trim() === "";
    if (am || bm) return am === bm ? 0 : am ? 1 : -1;
    const delta = types[sort.column] === "number" ? tableNumber(av)! - tableNumber(bv)! : av!.localeCompare(bv!);
    return sort.desc ? -delta : delta;
  });
  return rows;
}
export function tableCsv(columns: string[], rows: ExplorerTable["rows"]) { return serializeDelimitedText([columns, ...rows.map(row => row.map(value => value ?? ""))]); }
export function distribution(rows: ExplorerTable["rows"], column: number) {
  const values = rows.flatMap(row => { const n = tableNumber(row[column]); return n === null ? [] : [n]; });
  if (!values.length) return null;
  let min = Infinity, max = -Infinity, mean = 0;
  values.forEach((v, i) => { min = Math.min(min, v); max = Math.max(max, v); mean = mean * (i / (i + 1)) + v / (i + 1); });
  const count = min === max ? 1 : 10, bins = Array.from({ length: count }, () => 0);
  // Scaling avoids overflow for finite measurements near Number.MAX_VALUE.
  const scale = Math.max(Math.abs(min), Math.abs(max), 1), span = max / scale - min / scale;
  values.forEach(v => { const bin = count === 1 ? 0 : Math.min(count - 1, Math.floor((v / scale - min / scale) / span * count)); bins[bin]++; });
  return { min, max, mean, count: values.length, bins };
}

/** Strict ISO dates/timestamps only; bucket by the calendar date written in the source. */
export function isoCalendarDate(value: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}):(?:(\d{2})(?:\.\d{1,9})?)(?:Z|[+-](\d{2}):(\d{2}))?)?$/.exec(value.trim());
  if (!match) return null;
  const [, y, m, d, h, min, sec, zh, zm] = match;
  const year = Number(y), month = Number(m), day = Number(d);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > days[month - 1] ||
      (h !== undefined && (Number(h) > 23 || Number(min) > 59 || Number(sec) > 59)) ||
      (zh !== undefined && (Number(zh) > 23 || Number(zm) > 59))) return null;
  return `${y}-${m}-${d}`;
}
export interface FrequencyItem { label: string; count: number; other?: boolean }
export function categoryDistribution(rows: ExplorerTable["rows"], column: number, boolean = false, limit = 20) {
  const counts = new Map<string, number>();
  let missing = 0;
  for (const row of rows) {
    const value = row[column];
    if (value === null || value.trim() === "") { missing++; continue; }
    const label = boolean ? value.trim().toLowerCase() : value;
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  const ordered: FrequencyItem[] = [...counts].map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
  const items = ordered.slice(0, limit);
  if (ordered.length > limit) items.push({ label: "", count: ordered.slice(limit).reduce((n, item) => n + item.count, 0), other: true });
  return { items, missing, distinct: counts.size, total: rows.length };
}
export type DateGrouping = "day" | "month" | "year";
export function dateDistribution(rows: ExplorerTable["rows"], column: number, grouping: DateGrouping) {
  const counts = new Map<string, number>();
  let missing = 0, invalid = 0;
  for (const row of rows) {
    const value = row[column];
    if (value === null || value.trim() === "") { missing++; continue; }
    const date = isoCalendarDate(value);
    if (!date) { invalid++; continue; }
    const label = date.slice(0, grouping === "year" ? 4 : grouping === "month" ? 7 : 10);
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  return { items: [...counts].sort(([a], [b]) => a.localeCompare(b)).map(([label, count]) => ({ label, count })), missing, invalid, total: rows.length };
}
