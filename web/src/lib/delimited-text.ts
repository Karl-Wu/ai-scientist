/** Delimited text with quoted fields, escaped quotes and embedded line breaks. */
export function parseDelimitedText(text: string, delimiter: string, options: {
  strict?: boolean; skipEmptyLines?: boolean; maxCells?: number;
} = {}): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], cell = "", quoted = false, closed = false, cells = 0, rowHasSyntax = false;
  const addCell = () => {
    if (++cells > (options.maxCells ?? Infinity)) throw new Error("Table too large");
    row.push(cell); cell = ""; closed = false;
  };
  const addRow = () => {
    addCell();
    if (!options.skipEmptyLines || rowHasSyntax || row.some((value) => value.trim())) rows.push(row);
    row = []; rowHasSyntax = false;
  };
  const input = text.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  for (let i = 0; i < input.length; i++) {
    const char = input[i];
    if (quoted) {
      if (char === '"' && input[i + 1] === '"') { cell += '"'; i++; }
      else if (char === '"') { quoted = false; closed = true; }
      else cell += char;
    } else if (char === delimiter) { rowHasSyntax = true; addCell(); }
    else if (char === "\n") addRow();
    else if (char === '"' && cell === "" && !closed) { quoted = true; rowHasSyntax = true; }
    else {
      if (closed && options.strict) throw new Error("Invalid quoted field");
      cell += char;
    }
  }
  if (quoted && options.strict) throw new Error("Unclosed quoted field");
  // A final newline terminates a record; it does not add an extra empty record.
  if (row.length || cell || input.endsWith(delimiter) || closed) addRow();
  return rows;
}
export function serializeDelimitedText(rows: readonly (readonly string[])[], delimiter = ","): string {
  return rows.map((row) => row.map((value) =>
    value.includes(delimiter) || /["\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value,
  ).join(delimiter)).join("\r\n");
}
