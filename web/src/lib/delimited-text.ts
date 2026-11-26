interface CellRange { start: number; end: number }

/** Delimited text with quoted fields, escaped quotes and embedded line breaks. */
export function parseDelimitedText(text: string, delimiter: string, options: {
  strict?: boolean; skipEmptyLines?: boolean; maxCells?: number;
  onRow?: (row: number, ranges: readonly CellRange[]) => void;
} = {}): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], cell = "", quoted = false, closed = false, cells = 0, rowHasSyntax = false;
  const start = text.startsWith("\uFEFF") ? 1 : 0;
  let cellStart = start;
  let ranges: CellRange[] = [];
  const addCell = (end: number) => {
    if (++cells > (options.maxCells ?? Infinity)) throw new Error("Table too large");
    if (options.onRow) ranges.push({ start: cellStart, end });
    cellStart = end + 1;
    row.push(cell); cell = ""; closed = false;
  };
  const addRow = (end: number) => {
    addCell(end);
    if (!options.skipEmptyLines || rowHasSyntax || row.some((value) => value.trim())) {
      options.onRow?.(rows.length, ranges);
      rows.push(row);
    }
    row = []; ranges = []; rowHasSyntax = false;
  };
  for (let i = start; i < text.length; i++) {
    const char = text[i];
    if (char === "\r" || char === "\n") {
      if (quoted) cell += "\n";
      else addRow(i);
      if (char === "\r" && text[i + 1] === "\n") i++;
      if (!quoted) cellStart = i + 1;
      continue;
    }
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (char === '"') { quoted = false; closed = true; }
      else cell += char;
    } else if (char === delimiter) { rowHasSyntax = true; addCell(i); }
    else if (char === '"' && cell === "" && !closed) { quoted = true; rowHasSyntax = true; }
    else {
      if (closed && options.strict) throw new Error("Invalid quoted field");
      cell += char;
    }
  }
  if (quoted && options.strict) throw new Error("Unclosed quoted field");
  // A final newline terminates a record; it does not add an extra empty record.
  if (row.length || cell || text.endsWith(delimiter) || closed) addRow(text.length);
  return rows;
}
export function serializeDelimitedText(rows: readonly (readonly string[])[], delimiter = ","): string {
  return rows.map((row) => row.map((value) => serializeDelimitedCell(value, delimiter)).join(delimiter)).join("\r\n");
}

export function serializeDelimitedCell(value: string, delimiter: string, quote = false): string {
  return quote || value.includes(delimiter) || /["\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}
