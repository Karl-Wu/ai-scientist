import { describe, expect, it, vi } from "vitest";
import { ClipboardTableError, MAX_TABLE_CHARACTERS, normalizePastedTables, parseClipboardTable, tableCsv, uploadPastedTables } from "./clipboard-table";
import { parseDelimitedText, serializeDelimitedText } from "./delimited-text";

describe("clipboard tables", () => {
  it("preserves Chinese, empty cells, leading zeros, long ids and quoted multiline values", () => {
    const input = '编号\t描述\t空列\r\n00123\t"中文第一行\n第二行，含逗号和""引号"""\t\r\n12345678901234567890\t2026-11-17\t\r\n';
    const rows = parseClipboardTable("", input)!;
    expect(rows).toEqual([["编号", "描述", "空列"], ["00123", '中文第一行\n第二行，含逗号和"引号"', ""], ["12345678901234567890", "2026-11-17", ""]]);
    const csv = tableCsv({ id: "fixture", rows, firstRowHeader: true });
    expect(parseDelimitedText(csv, ",")).toEqual(rows);
  });
  it("prefers detached HTML over image/text alternatives and expands merged cells without guessing values", () => {
    const html = '<table><tr><th rowspan="2">编号</th><th colspan="2">内容<br>说明</th></tr><tr><td>中文</td><td></td></tr><tr><td>0001</td><td><img src=x onerror="alert(1)"><script>unsafe()</script>值</td><td>2</td></tr></table>';
    expect(parseClipboardTable(html, "irrelevant\ttext")).toEqual([["编号", "内容\n说明", ""], ["", "中文", ""], ["0001", "值", "2"]]);
  });
  it("leaves plain text, Markdown, ragged tabbed code and image-only pastes alone", () => {
    for (const text of ["普通文字\n多行", "| a | b |\n|---|---|", "code\tvalue\n\t\tindented", '"unclosed\tfield']) expect(parseClipboardTable("", text)).toBeNull();
    expect(parseClipboardTable('<img src="x.png">', "")).toBeNull();
  });
  it("fails visibly instead of silently truncating excessive tables or spans", () => {
    expect(() => parseClipboardTable('<table><tr><td colspan="999999">bad</td></tr></table>', "")).toThrow(ClipboardTableError);
    expect(() => parseClipboardTable("", "x".repeat(MAX_TABLE_CHARACTERS) + "\ty")).toThrow(ClipboardTableError);
    expect(() => parseClipboardTable("", Array.from({ length: 201 }, () => "x").join("\t"))).toThrow(ClipboardTableError);
  });
  it("can treat the first row as data without losing it, including blank records and formula-like text", () => {
    const rows = [["001", "=1+1"], ["", ""], ["末行", "值"]];
    expect(parseDelimitedText(tableCsv({ id: "t", rows, firstRowHeader: false }), ",")).toEqual([["column_1", "column_2"], ...rows]);
    expect(parseDelimitedText('a,b\n,\n"",\n\n', ",", { skipEmptyLines: true })).toEqual([["a", "b"], ["", ""], ["", ""]]);
    expect(serializeDelimitedText([["a\tb", "c"]], "\t")).toBe('"a\tb"\tc');
  });
  it("only restores bounded, rectangular draft tables", () => {
    expect(normalizePastedTables([{ id: "one", rows: [["001", "中"]], firstRowHeader: false }])).toHaveLength(1);
    expect(normalizePastedTables([{ id: "../bad", rows: [["a"]] }, { id: "ragged", rows: [["a", "b"], ["c"]] }])).toEqual([]);
  });
  it("reuses uploaded paths on retries and retains successful uploads if a later table fails", async () => {
    const tables = [{ id: "a", rows: [["h"], ["v"]], firstRowHeader: true }, { id: "b", rows: [["h"], ["v"]], firstRowHeader: true }];
    const remember = vi.fn();
    const upload = vi.fn().mockResolvedValueOnce(["user_data/a.csv"]).mockRejectedValueOnce(new Error("offline"));
    await expect(uploadPastedTables(tables, upload, remember)).rejects.toThrow("offline");
    expect(remember).toHaveBeenCalledWith("a", "user_data/a.csv");
    upload.mockResolvedValueOnce(["user_data/b.csv"]);
    expect(await uploadPastedTables([{ ...tables[0], uploadedPath: "user_data/a.csv" }, tables[1]], upload, remember)).toEqual(["user_data/a.csv", "user_data/b.csv"]);
    expect(upload).toHaveBeenCalledTimes(3);
    expect(upload.mock.calls[0][0][0]).toBeInstanceOf(File);
  });
});
