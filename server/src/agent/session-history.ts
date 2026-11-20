/**
 * Replay a stored Pi session JSONL file as the client SSE frame vocabulary.
 *
 * Reload recovery: the frontend rebuilds a past chat by folding these frames
 * through the same reducer it uses for live streams (applyFrameToMessage), so
 * a reopened transcript renders exactly like it did while streaming — prose,
 * reasoning blocks, and tool activity rows with args and capped results.
 */
import {
  customMessageFrame,
  relativizeSandboxPaths,
  skillFieldFor,
  summaryTextIndex,
  toolResultFields,
  type ClientFrame,
} from "./events.ts";
import {
  readEntries,
  textOf,
  type TextPart,
  type ThinkingPart,
  type ToolCallPart,
} from "./session-export.ts";
import { isParentWake } from "./subagent-wake.ts";
import type { ProjectPaths } from "../projects.ts";
import { scanTaskTimeline } from "./task-event-log.ts";
import { TASK_EVENT_SCHEMA_VERSION, type TaskEventScope } from "./task-events.ts";

export interface HistoryMessage {
  /** Stable Pi entry at the end of this rendered answer. */
  entryId?: string;
  /** `system` = an extension-injected custom message or a compaction marker. */
  role: "user" | "assistant" | "system";
  /** Prompt text (user) or rendered notice text (system). */
  content?: string;
  /** Custom message type — system messages only (e.g. `subagent_watchdog_warning`). */
  customType?: string;
  /** Whitelisted scalar details — system messages only. */
  details?: Record<string, string | number | boolean>;
  /** Inline image attachments (base64 + mime type) — user messages only. */
  images?: { data: string; mimeType: string }[];
  /** Ordered replay frames — assistant messages only. */
  frames?: ClientFrame[];
  /** Wall-clock ms of the underlying log row, when recorded. */
  timestamp?: number;
}

interface ToolObservation {
  start?: { time: number; seq: number };
  end?: { durationMs?: number; isError: boolean; result?: string };
}

interface SummaryObservation {
  runId: string;
  textStartedAt?: number;
}

/** Keep Pi's transcript and rich tool results, with committed activity observations. */
export async function withTaskObservations(
  messages: HistoryMessage[], paths: ProjectPaths, scope: TaskEventScope, isActive: () => boolean,
): Promise<HistoryMessage[]> {
  const observed = new Map<string, ToolObservation>();
  const resultIds = new Set<string>();
  const summaryIndexes = new Map<number, number>();
  const summariesByTimestamp = new Map<number, SummaryObservation | null>();
  const summariesByBlock = new Map<string, SummaryObservation>();
  const runs = new Map<string, { startedAt: number; outcome?: unknown; hasGap?: boolean }>();
  for (const { frames } of messages) {
    for (const frame of frames ?? []) {
      if (frame.type === "summary_candidate" && typeof frame.messageTimestamp === "number" && typeof frame.contentIndex === "number") {
        summaryIndexes.set(frame.messageTimestamp, frame.contentIndex);
      }
      if (typeof frame.toolCallId !== "string") continue;
      if (frame.type === "tool_start") observed.set(frame.toolCallId, {});
      if (frame.type === "tool_end") resultIds.add(frame.toolCallId);
    }
  }
  await scanTaskTimeline(paths, scope, isActive, (event) => {
    if (event.schemaVersion !== TASK_EVENT_SCHEMA_VERSION || !event.payload || typeof event.payload !== "object") return;
    const payload = event.payload as Record<string, unknown>;
    if (event.type === "run_started") runs.set(event.runId, { startedAt: event.observedAt });
    const run = runs.get(event.runId);
    if (run && event.type === "run_ended") run.outcome = payload.outcome;
    if (run && event.type === "record_gap") run.hasGap = true;
    if (event.type === "message_started" && payload.role === "assistant") {
      const timestamp = event.sourceAt?.timestamp;
      const index = typeof timestamp === "number" ? summaryIndexes.get(timestamp) : undefined;
      if (typeof timestamp === "number" && index !== undefined) {
        const summary = { runId: event.runId };
        summariesByTimestamp.set(timestamp, summariesByTimestamp.has(timestamp) ? null : summary);
        if (event.messageId) summariesByBlock.set(`${event.messageId}:${index}`, summary);
      }
    } else if (event.type === "message_chunk" && payload.channel === "text" && event.blockId) {
      const summary = summariesByBlock.get(event.blockId);
      if (summary?.runId === event.runId) summary.textStartedAt ??= event.observedAt;
    }
    if (event.type !== "tool_started" && event.type !== "tool_ended") return;
    const id = payload.toolCallId;
    if (typeof id !== "string") return;
    const tool = observed.get(id);
    if (!tool) return;
    if (event.type === "tool_started") {
      tool.start = { time: event.observedAt, seq: event.taskSeq };
    } else if (payload.outcome === "completed" || payload.outcome === "failed") {
      const durationMs = payload.durationMs;
      const content = payload.result as { kind?: string; value?: unknown } | undefined;
      tool.end = {
        isError: payload.outcome === "failed",
        ...(typeof durationMs === "number" && Number.isFinite(durationMs) && durationMs >= 0 ? { durationMs } : {}),
        ...(!resultIds.has(id) && content?.kind === "inline" && typeof content.value === "string"
          ? { result: content.value } : {}),
      };
    }
  });

  return messages.map((message) => {
    if (!message.frames) return message;
    const frames: ClientFrame[] = [];
    let starts: ClientFrame[] = [];
    const startOf = (frame: ClientFrame) => observed.get(String(frame.toolCallId))?.start;
    const flushStarts = () => {
      // Move observed calls only within this consecutive group of declarations.
      // Leave unobserved declarations in place and preserve surrounding prose.
      const sorted = starts.filter(startOf).sort((a, b) => startOf(a)!.seq - startOf(b)!.seq);
      let next = 0;
      for (const declaration of starts) {
        const frame = startOf(declaration) ? sorted[next++] : declaration;
        const id = String(frame.toolCallId);
        const tool = observed.get(id);
        frames.push(tool?.start ? { ...frame, startedAt: tool.start.time } : frame);
        if (!resultIds.has(id) && tool?.end) {
          frames.push({ type: "tool_end", toolCallId: frame.toolCallId, toolName: frame.toolName, ...tool.end });
        }
      }
      starts = [];
    };
    for (const frame of message.frames) {
      if (frame.type === "tool_start") {
        starts.push(frame);
        continue;
      }
      flushStarts();
      if (frame.type === "summary_candidate") {
        const { messageTimestamp, contentIndex: _contentIndex, ...client } = frame;
        const summary = typeof messageTimestamp === "number" ? summariesByTimestamp.get(messageTimestamp) : undefined;
        const run = summary ? runs.get(summary.runId) : undefined;
        // A recorded but unconfirmed run includes interrupted/restarted runs.
        // For legacy tasks the saved successful assistant message is the boundary.
        if (summary === null || (summary && run?.outcome !== "completed")) continue;
        const executionMs = run && !run.hasGap && summary?.textStartedAt !== undefined
          ? Math.max(0, summary.textStartedAt - run.startedAt) : undefined;
        frames.push({ ...client, ...(executionMs === undefined ? {} : { executionMs }) });
        continue;
      }
      const durationMs = frame.type === "tool_end" ? observed.get(String(frame.toolCallId))?.end?.durationMs : undefined;
      frames.push(durationMs === undefined ? frame : { ...frame, durationMs });
    }
    flushStarts();
    return { ...message, frames };
  });
}

/** Inline image parts of a user message (prompt attachments). */
function imagesOf(content: { type: string }[]): { data: string; mimeType: string }[] {
  const out: { data: string; mimeType: string }[] = [];
  for (const part of content ?? []) {
    if (part.type !== "image") continue;
    const { data, mimeType } = part as { data?: unknown; mimeType?: unknown };
    if (typeof data === "string" && typeof mimeType === "string") {
      out.push({ data, mimeType });
    }
  }
  return out;
}

export function toHistory(file: string, sandboxRoot = ""): HistoryMessage[] {
  const out: HistoryMessage[] = [];
  const toolOwners = new Map<string, HistoryMessage>();
  const summaries = new Map<HistoryMessage, ClientFrame>();
  let nextTextBlock = 0;
  // One assistant history message accumulates every agent turn between two
  // user prompts — the same shape the live stream produces client-side.
  let assistant: HistoryMessage | null = null;
  const pushFrame = (f: ClientFrame, timestamp?: number) => {
    if (!assistant) {
      assistant = { role: "assistant", frames: [], timestamp };
      out.push(assistant);
    }
    assistant.frames!.push(f);
  };

  const pushSystem = (frame: ClientFrame | null, timestamp?: string) => {
    if (!frame) return;
    const ms = timestamp ? Date.parse(timestamp) : NaN;
    out.push({
      role: "system",
      content: typeof frame.content === "string" ? frame.content : "",
      customType: typeof frame.customType === "string" ? frame.customType : "custom",
      ...(frame.details ? { details: frame.details as HistoryMessage["details"] } : {}),
      ...(Number.isFinite(ms) ? { timestamp: ms } : {}),
    });
    // The card sits between turns: whatever the agent says next opens a new
    // bubble, mirroring the live order (card, then reply).
    assistant = null;
  };

  for (const row of readEntries(file)) {
    if (row.type === "custom_message") {
      pushSystem(customMessageFrame(row, sandboxRoot), row.timestamp);
      continue;
    }
    if (row.type === "compaction") {
      pushSystem(
        customMessageFrame(
          {
            customType: "compaction",
            content: "Context compacted",
            details: { tokensBefore: row.tokensBefore },
          },
          sandboxRoot,
        ),
        row.timestamp,
      );
      continue;
    }
    const m = row.message;
    if (m.role === "user") {
      const text = textOf(m.content);
      const images = imagesOf(m.content);
      if ((!text && images.length === 0) || (images.length === 0 && isParentWake(text))) continue;
      out.push({
        role: "user",
        content: text,
        ...(images.length > 0 ? { images } : {}),
        timestamp: m.timestamp,
      });
      assistant = null;
      continue;
    }
    if (m.role === "toolResult" && m.toolCallId) {
      const frame = {
        type: "tool_end",
        toolCallId: m.toolCallId,
        toolName: m.toolName,
        isError: Boolean(m.isError),
        ...toolResultFields({ content: m.content, details: m.details }, sandboxRoot),
      };
      const owner = toolOwners.get(m.toolCallId);
      if (owner?.frames) owner.frames.push(frame);
      else pushFrame(frame, m.timestamp);
      continue;
    }
    if (m.role !== "assistant") continue;
    // Ensure even an empty final response updates the bubble boundary.
    if (!assistant) {
      assistant = { role: "assistant", frames: [], timestamp: m.timestamp };
      out.push(assistant);
    }
    if (row.id) assistant.entryId = row.id;
    const parts = m.content ?? [];
    const summaryIndex = summaryTextIndex(parts, m.stopReason);
    summaries.delete(assistant);
    for (const [index, part] of parts.entries()) {
      if (part.type === "thinking") {
        const { thinking, redacted } = part as ThinkingPart;
        if (thinking?.trim() && !redacted) pushFrame({ type: "thinking_delta", delta: thinking, reasoningStart: true }, m.timestamp);
      } else if (part.type === "text") {
        const t = (part as TextPart).text;
        if (t) {
          const blockId = `text-${++nextTextBlock}`;
          pushFrame({ type: "text_delta", delta: t, blockId }, m.timestamp);
          if (index === summaryIndex) summaries.set(assistant, {
            type: "summary_candidate", blockId, confirmed: true, contentIndex: index, messageTimestamp: m.timestamp,
          });
        }
      } else if (part.type === "toolCall") {
        const call = part as ToolCallPart;
        toolOwners.set(call.id, assistant);
        pushFrame(
          {
            type: "tool_start",
            toolCallId: call.id,
            toolName: call.name,
            args: relativizeSandboxPaths(call.arguments ?? {}, sandboxRoot),
            ...skillFieldFor(call.name, call.arguments, sandboxRoot),
          },
          m.timestamp,
        );
      }
    }
  }
  for (const [message, summary] of summaries) message.frames!.push(summary);
  return out;
}
