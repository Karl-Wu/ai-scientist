import { expect, it } from "vitest";
import { matchTaskResponses, type TaskResponse } from "./use-task-responses";
import { applyFrameToTranscript, type AgentFrame, type ChatMessage } from "./use-agent";
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

it.each([false, true])("skips a pre-compaction fragment when the reply continues (restored=%s)", (restored) => {
  const before: ChatMessage = {
    id: "before", role: "assistant", content: "Checking the data.", timestamp: 1,
    ...(restored ? { entryId: "partial" } : {}),
  };
  const marker: ChatMessage = {
    id: "marker", role: "system", customType: "compaction", content: "Context compacted", timestamp: 2,
  };
  const after: ChatMessage = {
    id: "after", role: "assistant", content: before.content, timestamp: 3,
    ...(restored ? { entryId: "final" } : {}),
  };
  const finalAnswer: TaskResponse = { entryId: "final", content: after.content, feedback: null, children: [] };
  const responses = restored ? [{ ...finalAnswer, entryId: "partial" }, finalAnswer] : [finalAnswer];
  expect([...matchTaskResponses([before, marker, after], responses)]).toEqual([["after", finalAnswer]]);
  const pending: ChatMessage = { id: "pending", role: "assistant", content: "", timestamp: 3 };
  const sameTextDuringCompaction = matchTaskResponses([before, marker, pending], responses, true);
  expect(sameTextDuringCompaction.size).toBe(0);
});

it("keeps actions on completed answers followed by a compaction notice and a new prompt", () => {
  const answer: TaskResponse = { entryId: "saved-answer", content: "Finished.", feedback: null, children: [] };
  const messages: ChatMessage[] = [
    { id: "reply", entryId: answer.entryId, role: "assistant", content: answer.content, timestamp: 1 },
    { id: "marker", role: "system", customType: "compaction", content: "Context compacted", timestamp: 2 },
    { id: "user", role: "user", content: "A different question.", timestamp: 3 },
    { id: "next", role: "assistant", content: "", timestamp: 4 },
  ];
  expect(matchTaskResponses(messages, [answer], true).get("reply")).toBe(answer);
});

it.each(["", "\n\n"])("matches a completed reply after compaction with separator %j", (separator) => {
  let next = 0;
  const nextId = () => String(++next);
  let messages: ChatMessage[] = [
    { id: "original-question", role: "user", content: "Review the dataset.", timestamp: 1 },
    { id: "before-compaction", role: "assistant", content: "", timestamp: 2 },
  ];
  let state = { assistantId: "before-compaction", sawPromptEcho: true };
  const frames: AgentFrame[] = [
    { type: "text_delta", delta: "Gathering the inputs." },
    { type: "message_start", role: "custom", customType: "compaction", content: "Context compacted" },
    { type: "text_delta", delta: "Checking the delivery." },
    { type: "tool_start", toolName: "read", toolCallId: "check" },
    { type: "tool_end", toolName: "read", toolCallId: "check" },
    { type: "text_delta", delta: "The data was delivered." },
    { type: "done", outcome: "completed" },
    { type: "message_start", role: "user", content: "Hello" },
    { type: "text_delta", delta: "How can I help?" },
    { type: "done", outcome: "completed" },
  ];
  for (const frame of frames) {
    ({ messages, state } = applyFrameToTranscript(messages, state, frame, nextId));
  }

  const delivery = messages[3];
  const greeting = messages[5];
  expect(delivery.content).toBe("Checking the delivery.\n\nThe data was delivered.");
  const answers: TaskResponse[] = [
    { entryId: "delivery", content: `Checking the delivery.${separator}The data was delivered.`, feedback: null, children: [] },
    { entryId: "greeting", content: greeting.content, feedback: null, children: [] },
  ];
  expect([...matchTaskResponses(messages, answers)]).toEqual([[delivery.id, answers[0]], [greeting.id, answers[1]]]);
});
