import { expect, it } from "vitest";
import { matchTaskResponses, type TaskResponse } from "./use-task-responses";
import type { ChatMessage } from "./use-agent";
it("binds live and restored bubbles to persisted IDs, preserving duplicate answer order", () => {
  const messages: ChatMessage[] = [
    { id: "user", role: "user", content: "Question", timestamp: 1 },
    { id: "local-1", role: "assistant", content: "Same answer", timestamp: 2 },
    { id: "local-2", role: "assistant", content: "Same answer", timestamp: 3 },
    { id: "partial", role: "assistant", content: "Not yet persisted", timestamp: 4 },
  ];
  const responses: TaskResponse[] = ["a", "b"].map((entryId) => ({ entryId, content: "Same answer", feedback: null, children: [] }));
  const result = matchTaskResponses(messages, responses);
  expect(result.get("local-1")?.entryId).toBe("a");
  expect(result.get("local-2")?.entryId).toBe("b");
  expect(result.has("partial")).toBe(false);
  expect(matchTaskResponses([{ ...messages[1], entryId: "b" }], responses).get("local-1")?.entryId).toBe("b");
});
