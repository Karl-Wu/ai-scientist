import { describe, expect, it } from "vitest";
import { normalizeNotebookExecution } from "./notebook-execution";

describe("notebook execution state", () => {
  it("does not accept bare completion or a fabricated verified status", () => {
    expect(normalizeNotebookExecution({ status: "completed", evidence: "  " })).toEqual({ status: "unverified" });
    expect(normalizeNotebookExecution({ status: "verified", evidence: "Trust me" })).toBeUndefined();
    expect(normalizeNotebookExecution(undefined)).toBeUndefined();
  });

  it("retains the evidence accompanying a reported completion", () => {
    const execution = { status: "completed", evidence: "uv run python analysis.py; exit 0; derived/run-2/log.txt" };
    expect(normalizeNotebookExecution(execution)).toEqual(execution);
  });
});
