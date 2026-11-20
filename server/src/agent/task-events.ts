/** Durable observations, separate from Pi's transcript and the SSE cursor. */
export const TASK_EVENT_SCHEMA_VERSION = 1;

export type RunOutcome = "completed" | "failed" | "cancelled" | "blocked" | "interrupted";
export type RecordedContent =
  | { kind: "inline"; value: unknown; truncated?: true; redacted?: true }
  | { kind: "ref"; piEntryId: string; contentIndex: number }
  | { kind: "omitted"; reason: "unavailable" | "too-large" | "unsupported" };

type MessageRole = "user" | "assistant";
type Tool = { toolCallId: string; toolName: string; parentToolCallId?: string };

type Payloads = {
  run_started: { origin: "user" | "system"; kind: "turn" | "notice"; basePiEntryId?: string };
  run_ended: { outcome: RunOutcome; reason?: string };
  turn_started: Record<string, never>;
  turn_ended: Record<string, never>;
  message_started: { role: MessageRole; attachments?: RecordedContent };
  message_chunk: { role: MessageRole; channel: "input" | "text" | "thinking"; content: RecordedContent };
  message_ended: { role: MessageRole; stopReason?: string; entryId?: string; attachments?: RecordedContent[] };
  tool_started: Tool & { args: RecordedContent };
  tool_ended: Tool & { outcome: "completed" | "failed" | "cancelled" | "unknown"; result: RecordedContent; durationMs?: number; attachments?: RecordedContent };
  system_notice: { code: string; content?: RecordedContent; requestId?: string; toolCallId?: string; outcome?: string; attempt?: number; maxAttempts?: number };
  record_gap: { reason: "uncommitted_tail" | "write_failed" | "queue_overflow" | "late_observer" | "capture_failed"; droppedCount?: number };
};

export interface TaskEventScope {
  projectId: string;
  sessionId: string;
}

type EventBody = {
  [K in keyof Payloads]: { type: K; payload: Payloads[K] };
}[keyof Payloads];

export type TaskEventDraft = EventBody & {
  eventId: string;
  runId: string;
  observedAt: number;
  source: "pi" | "server" | "recovery";
  sourceAt?: { timestamp: number; precision: "message" | "event" };
  turnId?: string;
  messageId?: string;
  blockId?: string;
};

export type TaskEvent = TaskEventDraft & TaskEventScope & {
  schemaVersion: typeof TASK_EVENT_SCHEMA_VERSION;
  taskSeq: number;
};

export type EventObservation = EventBody & Pick<TaskEventDraft, "turnId" | "messageId" | "blockId" | "sourceAt">;

// Future event types/versions stay on disk and remain available to readers.
export type StoredTaskEvent = TaskEventScope & {
  schemaVersion: number;
  eventId: string;
  runId: string;
  observedAt: number;
  source: string;
  taskSeq: number;
  type: string;
  payload: unknown;
  messageId?: string;
  blockId?: string;
  sourceAt?: TaskEventDraft["sourceAt"];
};
