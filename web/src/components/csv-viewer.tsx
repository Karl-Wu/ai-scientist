"use client";
import { parseDelimitedText } from "@/lib/delimited-text";
import { TABLE_PAGE_SIZE } from "@/lib/table-explorer";
import { TableFileViewer } from "./table-explorer";
export const CSV_PAGE_SIZE = TABLE_PAGE_SIZE;
export function parseCsv(text: string): string[][] { return parseDelimitedText(text, ",", { skipEmptyLines: true }); }
export function CsvViewer({ content }: { content: string }) { return <TableFileViewer content={content} name="data.csv" />; }
