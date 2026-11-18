import { describe, expect, it } from "vitest";
import { parseExplorerTable, columnProfile, filterSortTable, distribution, tableCsv, categoryDistribution, dateDistribution, isoCalendarDate } from "./table-explorer";
import { parseDelimitedText } from "./delimited-text";
describe("text table explorer", () => {
  it("counts exact categories, missing values and an explicit remainder without losing rows", () => {
    const rows = [["A"], ["A"], [" A "], [null], [" "], ...Array.from({ length: 25 }, (_, i) => [`category-${i}`])];
    const result = categoryDistribution(rows, 0);
    expect(result.missing).toBe(2);
    expect(result.distinct).toBe(27);
    expect(result.items).toHaveLength(21);
    expect(result.items[0]).toEqual({ label: "A", count: 2 });
    expect(result.items.at(-1)?.other).toBe(true);
    expect(result.items.reduce((sum, item) => sum + item.count, result.missing)).toBe(rows.length);
    expect(categoryDistribution([["true"], [" TRUE "], ["false"], [null]], 0, true).items).toEqual([{ label: "true", count: 2 }, { label: "false", count: 1 }]);
  });
  it("only infers valid ISO dates and groups written calendar dates without timezone conversion", () => {
    expect(isoCalendarDate("2024-02-29T23:30:00-05:00")).toBe("2024-02-29");
    for (const value of ["2023-02-29", "2024-04-31", "2024-01-01T25:00:00", "01/02/2024", "20240101", "001"]) expect(isoCalendarDate(value)).toBeNull();
    const rows = [["2024-02-29T23:30:00-05:00"], ["2024-02-01"], ["2025-01-01"], [null]];
    expect(columnProfile(rows, 0).type).toBe("date");
    expect(dateDistribution(rows, 0, "month").items).toEqual([{ label: "2024-02", count: 2 }, { label: "2025-01", count: 1 }]);
    expect(dateDistribution(rows, 0, "year").items).toEqual([{ label: "2024", count: 2 }, { label: "2025", count: 1 }]);
    expect(dateDistribution(rows, 0, "day").items[1]).toEqual({ label: "2024-02-29", count: 1 });
    expect(columnProfile([["2024-01-01"], ["not a date"]], 0).type).toBe("text");
  });
  it("preserves quoted text, embedded newlines, zero-padded IDs and ragged rows", () => {
    const t = parseExplorerTable('id,note\n001,"line 1\nline 2"\n002,hello,extra', "csv");
    expect(t.columns).toEqual(["id", "note", "Column 3"]);
    expect(t.rows).toEqual([["001", "line 1\nline 2", null], ["002", "hello", "extra"]]);
    expect(columnProfile(t.rows, 0).type).toBe("text");
    expect(parseExplorerTable('id\tnote\n001\t"a\tb"', "tsv").rows).toEqual([["001", "a\tb"]]);
  });
  it("preserves unsafe JSON integers, numeric spelling, escaped keys and nested values", () => {
    const t = parseExplorerTable(' \n[{"id":9007199254740993,"n":1.20,"text":"001","a\\\"b":false,"nested":{"x":[1,2]}}] ', "json");
    expect(t.columns).toEqual(["id", "n", "text", 'a"b', "nested"]);
    expect(t.rows[0]).toEqual(["9007199254740993", "1.20", "001", "false", '{"x":[1,2]}']);
    expect(columnProfile(t.rows, 0).type).toBe("text");
  });
  it("unions JSONL keys without confusing zero, false, null or missing fields", () => {
    const t = parseExplorerTable('{"a":0,"b":false,"__proto__":"safe"}\n\n{"a":null,"c":""}', "jsonl");
    expect(t.columns).toEqual(["a", "b", "__proto__", "c"]);
    expect(t.rows[0]).toEqual(["0", "false", "safe", null]);
    expect(columnProfile(t.rows, 0)).toEqual({ type: "number", missing: 1, distinct: 1 });
    expect(columnProfile(t.rows, 1).type).toBe("boolean");
    expect(columnProfile(t.rows, 3).missing).toBe(2);
  });
  it("rejects malformed files rather than silently skipping rows", () => {
    expect(() => parseExplorerTable('{"a":1}\nnot json', "ndjson")).toThrow("line 2");
    expect(() => parseExplorerTable('[{"a":1},2]', "json")).toThrow();
    expect(() => parseExplorerTable('{"a":1}', "json")).toThrow("JSON array");
    expect(() => parseExplorerTable('x,y\n"unclosed', "csv")).toThrow();
    expect(parseExplorerTable('[]', "json").rows).toEqual([]);
  });
  it("filters before sorting and exports every matching row with original values", () => {
    const t = parseExplorerTable('id,group,value\n001,A,10\n002,B,3\n003,A,2', "csv");
    const rows = filterSortTable(t, "A", { column: 2, desc: false }, ["text", "text", "number"]);
    expect(rows.map(row => row[0])).toEqual(["003", "001"]);
    expect(parseDelimitedText(tableCsv(t.columns, rows), ",")[1]).toEqual(["003", "A", "2"]);
    expect(t.rows[0][0]).toBe("001");
    expect(distribution(rows, 2)).toMatchObject({ min: 2, max: 10, mean: 6, count: 2 });
    expect(distribution(rows, 2)!.bins.reduce((a, b) => a + b, 0)).toBe(2);
    expect(distribution([["5"], ["5"], [null]], 0)?.bins).toEqual([2]);
    expect(distribution([], 0)).toBeNull();
  });
});
