import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useSandbox } from "./use-sandbox";

const fetchMock = vi.hoisted(() => vi.fn());
vi.mock("./projects", () => ({ apiFetch: fetchMock, useProjectScopeId: () => "test", getActiveProjectId: () => "test", API_BASE: "http://localhost" }));
const text = (body: string, etag = 'W/"one"') => new Response(body, { headers: { ETag: etag } });
beforeEach(() => fetchMock.mockReset());

describe("file preview tabs", () => {
  it("reuses one preview and preserves files explicitly opened or kept", async () => {
    fetchMock.mockImplementation(async (path: string) => text(path));
    const onStateChange = vi.fn();
    const { result } = renderHook(() => useSandbox(false, "test", undefined, onStateChange));
    await act(() => result.current.selectFile("pinned.txt"));
    await act(() => result.current.selectFile("first.txt", "preview"));
    await act(() => result.current.selectFile("second.txt", "preview"));
    expect(result.current.tabs.map((tab) => tab.path)).toEqual(["pinned.txt", "second.txt"]);
    expect(onStateChange).toHaveBeenLastCalledWith({
      openPaths: ["pinned.txt", "second.txt"], activePath: "second.txt", previewPath: "second.txt",
    });
    act(() => result.current.keepOpen("second.txt"));
    await act(() => result.current.selectFile("third.txt", "preview"));
    await act(() => result.current.selectFile("third.txt", "open"));
    expect(result.current.tabs.map((tab) => tab.path)).toEqual(["pinned.txt", "second.txt", "third.txt"]);
    expect(result.current.tabs.some((tab) => tab.preview)).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("cancels the previous preview without letting its delayed result replace the current file", async () => {
    let finish!: (value: Response) => void;
    fetchMock.mockImplementationOnce(() => new Promise<Response>((resolve) => { finish = resolve; }));
    fetchMock.mockResolvedValueOnce(text("current file"));
    const { result } = renderHook(() => useSandbox(false, "test"));
    await act(async () => {
      const previous = result.current.selectFile("first.txt", "preview");
      await result.current.selectFile("second.txt", "preview");
      finish(text("delayed file"));
      await previous;
    });
    expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(true);
    expect(result.current.activeTabPath).toBe("second.txt");
    expect(result.current.tabs).toMatchObject([{ path: "second.txt", content: "current file", preview: true }]);
  });
});

describe("conditional sandbox refresh", () => {
  it("uses validators and preserves tab identity for 304 and equal content", async () => {
    fetchMock.mockResolvedValueOnce(text("original"));
    const { result } = renderHook(() => useSandbox(false, "test"));
    await act(() => result.current.selectFile("a.txt"));
    const tabs = result.current.tabs;
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 304 }));
    await act(() => result.current.refreshOpenTabs());
    expect(fetchMock.mock.calls.at(-1)?.[1].headers).toEqual({ "If-None-Match": 'W/"one"' });
    expect(result.current.tabs).toBe(tabs);
    fetchMock.mockResolvedValueOnce(text("original", 'W/"two"'));
    await act(() => result.current.refreshOpenTabs());
    expect(result.current.tabs).toBe(tabs);
  });

  it("coalesces overlapping refresh cycles", async () => {
    fetchMock.mockResolvedValueOnce(text("original"));
    const { result } = renderHook(() => useSandbox(false, "test"));
    await act(() => result.current.selectFile("a.txt"));
    let finish!: (value: Response) => void;
    fetchMock.mockImplementationOnce(() => new Promise<Response>((resolve) => { finish = resolve; }));
    await act(async () => {
      const one = result.current.refreshOpenTabs();
      const two = result.current.refreshOpenTabs();
      expect(two).toBe(one);
      finish(text("updated"));
      await one;
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.current.tabs[0].content).toBe("updated");
  });

  it("ignores a stale refresh after a save even if the transport ignores abort", async () => {
    fetchMock.mockResolvedValueOnce(text("original"));
    const { result } = renderHook(() => useSandbox(false, "test"));
    await act(() => result.current.selectFile("a.txt"));
    let finish!: (value: Response) => void;
    fetchMock.mockImplementationOnce(() => new Promise<Response>((resolve) => { finish = resolve; }));
    const pending = result.current.refreshOpenTabs();
    fetchMock.mockResolvedValueOnce(new Response("{}"));
    await act(() => result.current.saveFile("a.txt", "saved"));
    await act(async () => { finish(text("stale")); await pending; });
    expect(result.current.tabs[0].content).toBe("saved");
    fetchMock.mockResolvedValueOnce(text("saved"));
    await act(() => result.current.refreshOpenTabs());
    expect(fetchMock.mock.calls.at(-1)?.[1].headers).toBeUndefined();
  });

  it("does not apply an old load to a closed and reopened path", async () => {
    let finish!: (value: Response) => void;
    fetchMock.mockImplementationOnce(() => new Promise<Response>((resolve) => { finish = resolve; }));
    const { result } = renderHook(() => useSandbox(false, "test"));
    let pending!: Promise<void>;
    act(() => { pending = result.current.selectFile("a.txt"); });
    act(() => result.current.closeTab("a.txt"));
    fetchMock.mockResolvedValueOnce(text("new"));
    await act(() => result.current.selectFile("a.txt"));
    await act(async () => { finish(text("old")); await pending; });
    expect(result.current.tabs[0].content).toBe("new");
  });
});
