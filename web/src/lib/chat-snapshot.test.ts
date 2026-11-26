import { describe, expect, it, vi } from "vitest";
import { withChatSnapshots } from "@/lib/chat-snapshot";
import type { ResearchRef } from "@/lib/composer-context";

const json = (body: unknown, ok = true) => ({ ok, status: ok ? 200 : 404, json: async () => body }) as Response;

const note: ResearchRef = {
  kind: "note",
  type: "note",
  id: "ad94e200-56c4-4100-98b4-e2e643a24b01",
  version: 1,
  title: "Keep Emax",
};

describe("withChatSnapshots", () => {
  it("snapshots each referenced chat in the referenced project and leaves note pages alone", async () => {
    const fetcher = vi.fn(async (url: string) =>
      json({ path: `.kady/chat-snapshots/${url.split("/")[2]}-abc.md` }),
    );
    const { refs, failed } = await withChatSnapshots(
      [note, { kind: "chat", sessionId: "s-2", title: "QC chat" }],
      "project-a",
      fetcher as never,
    );
    expect(failed).toEqual([]);
    expect(refs).toEqual([
      note,
      { kind: "chat", sessionId: "s-2", title: "QC chat", snapshot: ".kady/chat-snapshots/s-2-abc.md" },
    ]);
    expect(fetcher).toHaveBeenCalledTimes(1);
    const [url, init, projectId] = fetcher.mock.calls[0] as unknown as [string, RequestInit, string];
    expect(url).toBe("/sessions/s-2/snapshot");
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({ title: "QC chat" });
    expect(projectId).toBe("project-a");
  });

  it("keeps a plain reference and reports the chat when its snapshot fails", async () => {
    const fetcher = vi.fn(async () => json({ detail: "No such session" }, false));
    const { refs, failed } = await withChatSnapshots(
      [{ kind: "chat", sessionId: "gone", title: "Deleted chat", snapshot: ".kady/old.md" }],
      "project-a",
      fetcher as never,
    );
    expect(refs).toEqual([{ kind: "chat", sessionId: "gone", title: "Deleted chat" }]);
    expect(failed).toEqual(["Deleted chat"]);
  });
});
