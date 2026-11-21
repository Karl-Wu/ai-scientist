import { describe, expect, it } from "vitest";
import { memoryTokens, rankMemory, normalizeMemoryQuery, normalizeMemorySource, memorySourceKey } from "./notebook-memory";
const entry = (title: string, body: string, extra: object = {}) => ({ id: title, title, body, type: "note" as const, timestamp: 1, ...extra });
describe("research-memory protocol", () => {
  it("matches scientific identifiers, paths, language labels and simple inflections", () => {
    expect(memoryTokens("Failed analyses in R and TNF-alpha")).toEqual(expect.arrayContaining(["fail", "analysis", "r", "tnf-alpha", "tnf", "alpha"]));
    const rows = [
      { type: "note" as const, entry: entry("Harmony method", "Normalization worked") },
      { type: "note" as const, entry: entry("Unrelated", "Other data") },
    ];
    expect(rankMemory(rows, "Harmony")[0].document.entry.title).toBe("Harmony method");
    expect(rankMemory([{ type: "method" as const, entry: { ...entry("Fit", ""), code: { lang: "R", source: "lm(y ~ x)" } } }], "R")).toHaveLength(1);
  });
  it("does not use author confidence as a relevance or truth score", () => {
    const a = { type: "note" as const, entry: entry("Harmony", "same", { confidence: "low" }) };
    const b = { type: "note" as const, entry: entry("Harmony", "same", { confidence: "high" }) };
    expect(rankMemory([a, b], "Harmony").map((r) => r.score)[0]).toBe(rankMemory([a, b], "Harmony").map((r) => r.score)[1]);
  });
  it("validates search bounds, filters and exact source identities", () => {
    expect(normalizeMemoryQuery({ outcome: "technical-failure" })).toMatchObject({ query: "", limit: 6, includeSuperseded: true });
    expect(() => normalizeMemoryQuery({ query: "x", limit: 100 })).toThrow();
    expect(() => normalizeMemoryQuery({ query: "" })).toThrow();
    expect(() => normalizeMemorySource({ kind: "notebook", sessionId: "../x", entryId: "h" })).toThrow();
    expect(memorySourceKey({ kind: "notebook", sessionId: "a", entryId: "same" })).not.toBe(memorySourceKey({ kind: "notebook", sessionId: "b", entryId: "same" }));
    expect(memorySourceKey({ kind: "user-note", sessionId: "a", entryId: "same" })).not.toBe(memorySourceKey({ kind: "notebook", sessionId: "a", entryId: "same" }));
  });
});
