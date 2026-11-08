import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { apiFetch } from "./projects";
import { restoredModelChoice, useSessionModel } from "./use-session-model";
vi.mock("./projects", () => ({ apiFetch: vi.fn() }));
const model = restoredModelChoice("openrouter/chosen/model", []);

describe("session model selection", () => {
  it("restores the saved ref in the owning project, including an unavailable model", async () => {
    vi.mocked(apiFetch).mockResolvedValue(Response.json({ model: model.id }));
    const restore = vi.fn();
    const touched = { current: false };
    const { result } = renderHook(() => useSessionModel({ projectId: "study", sessionId: "saved", models: [], touched, onRestore: restore }));
    expect(result.current).toBe(false);
    await waitFor(() => expect(result.current).toBe(true));
    expect(restore).toHaveBeenCalledWith(expect.objectContaining({ id: model.id }));
    expect(apiFetch).toHaveBeenLastCalledWith("/sessions/saved/selection", expect.anything(), "study");
  });
  it("preserves a browser's explicit unsent choice", () => {
    vi.mocked(apiFetch).mockClear();
    const restore = vi.fn();
    const { result } = renderHook(() => useSessionModel({ projectId: "study", sessionId: "saved", initialModel: model, models: [], touched: { current: false }, onRestore: restore }));
    expect(result.current).toBe(true);
    expect(apiFetch).not.toHaveBeenCalled();
    expect(restore).not.toHaveBeenCalled();
  });
  it("does not replace a manual choice made while recovery is loading", async () => {
    let resolve!: (response: Response) => void;
    vi.mocked(apiFetch).mockReturnValue(new Promise<Response>((done) => { resolve = done; }));
    const restore = vi.fn();
    const touched = { current: false };
    const { result } = renderHook(() => useSessionModel({ projectId: "study", sessionId: "saved", models: [], touched, onRestore: restore }));
    touched.current = true;
    await act(async () => resolve(Response.json({ model: model.id })));
    expect(result.current).toBe(true);
    expect(restore).not.toHaveBeenCalled();
  });
  it("uses catalogue metadata when the stored model is known", () => {
    const known = { ...model, label: "Chosen model", available: true };
    expect(restoredModelChoice(known.id, [known])).toBe(known);
  });
});
