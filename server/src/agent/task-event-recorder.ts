import { randomUUID } from "node:crypto";
import type { AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import type { ProjectPaths } from "../projects.ts";
import { relativizeSandboxPaths, type ClientFrame } from "./events.ts";
import { isParentWake } from "./subagent-wake.ts";
import { appendTaskEvents, reportTaskEventWriteFailure } from "./task-event-log.ts";
import type { EventObservation, RecordedContent, RunOutcome, TaskEventDraft, TaskEventScope } from "./task-events.ts";

const FLUSH_MS = 50;
const MAX_PENDING_EVENTS = 1_024;
const MAX_TEXT = 8_192;
const MAX_CHUNK = 4_096;
const MAX_JSON_ITEMS = 64;
const MAX_JSON_DEPTH = 5;
const SENSITIVE_KEY = /^(?:(?:http|request|response)?headers|(?:proxy)?authorization|.*(?:apikey|credential|passphrase|password|privatekey|secret|token|cookie|base64)s?)$/i;
const HIDDEN = "[redacted]";

export function redactText(text: string): string {
  return text
    .replace(/\b(Bearer|Basic)\s+[\w./+~=-]+/gi, "$1 " + HIDDEN)
    .replace(/\b((?:[\w-]*[_-])?(?:api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|password|passwd|secret|token|cookie)["']?\s*[:=]\s*)(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\s,;&}]+)/gi, "$1" + HIDDEN)
    .replace(/\b(sk-[\w-]{12,}|gh[pousr]_[\w]{12,}|github_pat_[\w]{12,})\b/g, HIDDEN)
    .replace(/\bdata:[\w.+/-]+;base64,[\w+/=]+/gi, HIDDEN)
    .replace(/(https?:\/\/)[^\s/@]+:[^\s/@]+@/gi, "$1" + HIDDEN + "@");
}

function recordText(text: string, max = MAX_TEXT, alreadyTruncated = false): RecordedContent {
  const bounded = text.slice(0, max);
  const value = redactText(bounded);
  return {
    kind: "inline", value,
    ...(alreadyTruncated || text.length > max ? { truncated: true } : {}),
    ...(bounded !== value ? { redacted: true } : {}),
  };
}

// Traverse only a bounded part of the JSON tree; keep unstructured strings
// bounded as well. No arbitrary tool details or attachment bytes are copied.
function recordArgs(args: unknown, sandbox: string): RecordedContent {
  if (args === undefined) return { kind: "omitted", reason: "unavailable" };
  let remaining = MAX_TEXT;
  let redacted = false;
  let truncated = false;
  const visit = (value: unknown, depth: number): unknown => {
    if (depth > MAX_JSON_DEPTH || remaining <= 0) {
      truncated = true;
      return null;
    }
    remaining -= 8;
    if (typeof value === "string") {
      const bounded = value.slice(0, Math.max(0, remaining));
      remaining -= bounded.length;
      const clean = redactText(bounded);
      truncated ||= bounded.length < value.length;
      redacted ||= clean !== bounded;
      return relativizeSandboxPaths(clean, sandbox);
    }
    if (Array.isArray(value)) {
      truncated ||= value.length > MAX_JSON_ITEMS;
      return value.slice(0, MAX_JSON_ITEMS).map((item) => visit(item, depth + 1));
    }
    if (value && typeof value === "object") {
      const entries: [string, unknown][] = [];
      for (const key of Object.keys(value)) {
        if (entries.length >= MAX_JSON_ITEMS || remaining <= 0) {
          truncated = true;
          break;
        }
        const safeKey = key.slice(0, 160);
        remaining -= safeKey.length + 8;
        truncated ||= key.length > safeKey.length;
        if (SENSITIVE_KEY.test(key.replace(/[^a-z0-9]/gi, ""))) {
          entries.push([safeKey, HIDDEN]);
          redacted = true;
        } else {
          entries.push([safeKey, visit((value as Record<string, unknown>)[key], depth + 1)]);
        }
      }
      return Object.fromEntries(entries);
    }
    return typeof value === "number" || typeof value === "boolean" ? value : null;
  };
  const value = visit(args, 0);
  return { kind: "inline", value, ...(truncated ? { truncated: true } : {}), ...(redacted ? { redacted: true } : {}) };
}

function hasImages(content: unknown): boolean {
  return Array.isArray(content) && content.some((part) => part?.type === "image");
}

function userText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.filter((part) => part?.type === "text" && typeof part.text === "string")
    .map((part) => part.text as string).join("\n");
}

interface RecorderOptions {
  paths: ProjectPaths;
  scope: TaskEventScope;
  runId: string;
  log: { warn: (err: { err: unknown }, message: string) => void };
  wallClock?: () => number;
  monotonicClock?: () => number;
}

/** Callback work is bounded; storage is serialized asynchronously per task. */
export class TaskEventRecorder {
  private pending: TaskEventDraft[] = [];
  private timer: ReturnType<typeof setTimeout> | undefined;
  private writing: Promise<void> | undefined;
  private startEvent: TaskEventDraft | undefined;
  private startsRun = true;
  private failed = 0;
  private overflow = 0;
  private finishing = false;
  private turn = 0;
  private activeTurn: string | undefined;
  private messages = new Map<"assistant" | "user", { id: string; turnId?: string; blocks: Set<number> }>();
  private tools = new Map<string, { now: number; turnId?: string }>();
  private text: { value: string; observedAt: number; channel: "text" | "thinking"; messageId?: string; blockId?: string; turnId?: string } | undefined;
  private cancelled = false;
  private terminalStop: string | undefined;
  private readonly wall: () => number;
  private readonly monotonic: () => number;

  constructor(private readonly opts: RecorderOptions) {
    this.wall = opts.wallClock ?? Date.now;
    this.monotonic = opts.monotonicClock ?? (() => performance.now());
  }

  get wasCancelled(): boolean { return this.cancelled || this.terminalStop === "aborted"; }
  get modelFailed(): boolean { return this.terminalStop === "error"; }

  start(payload: Extract<EventObservation, { type: "run_started" }>["payload"], observedAt = this.wall()): void {
    this.startEvent = this.draft({ type: "run_started", payload }, "server", observedAt);
    this.pending.push(this.startEvent);
    this.flush();
  }

  // Permission frames originate outside Pi's subscription. Observe only this
  // subset here so tool boundaries and custom messages are never double counted.
  observeServer(frame: ClientFrame): void {
    if (frame.type !== "permission_request" && frame.type !== "permission_resolved") return;
    this.add({ type: "system_notice", turnId: this.activeTurn, payload: {
      code: frame.type,
      ...(typeof frame.requestId === "string" ? { requestId: frame.requestId } : {}),
      ...(typeof frame.toolCallId === "string" ? { toolCallId: frame.toolCallId } : {}),
      ...(typeof frame.outcome === "string" ? { outcome: frame.outcome } : {}),
      ...(typeof frame.reason === "string" ? { content: recordText(frame.reason) } : {}),
    } }, "server", this.wall(), true);
  }

  observe(event: AgentSessionEvent, frames: readonly ClientFrame[], observedAt = this.wall()): void {
    try {
      this.capture(event, frames, observedAt);
    } catch (err) {
      this.add({ type: "record_gap", payload: { reason: "capture_failed", droppedCount: 1 } }, "server", observedAt, true);
      this.opts.log.warn({ err }, "failed to capture task execution event");
    }
  }

  private capture(event: AgentSessionEvent, frames: readonly ClientFrame[], observedAt: number): void {
    const frame = frames.at(-1);
    const record = (event: EventObservation, immediate = false) => this.add(event, "pi", observedAt, immediate);
    const turnId = this.activeTurn;
    const captureDelta = (channel: "text" | "thinking", value: string, contentIndex: number) => {
      if (!value) return;
      const message = this.messages.get("assistant");
      message?.blocks.add(contentIndex);
      this.addText({
        value, observedAt, messageId: message?.id,
        turnId: message?.turnId ?? turnId,
        blockId: message ? message.id + ":" + contentIndex : undefined,
        channel,
      });
    };
    const captureTextFrames = () => {
      for (const frame of frames) {
        if (frame.type !== "thinking_delta" && frame.type !== "text_delta") continue;
        if (typeof frame.delta === "string" && typeof frame.contentIndex === "number") {
          captureDelta(frame.type === "text_delta" ? "text" : "thinking", frame.delta, frame.contentIndex);
        }
      }
    };
    switch (event.type) {
      case "agent_settled":
        this.cancelled ||= event.aborted;
        break;
      case "turn_start":
        this.activeTurn = `${this.opts.runId}:${++this.turn}`;
        record({ type: "turn_started", turnId: this.activeTurn, payload: {} });
        break;
      case "turn_end":
        record({ type: "turn_ended", turnId, payload: {} });
        // Pi's turn_end arrives after its tools. The next turn_start replaces it.
        this.activeTurn = undefined;
        break;
      case "message_start": {
        const message = event.message;
        if (message.role === "custom" && frame?.role === "custom") {
          const code = typeof frame.customType === "string" ? frame.customType : "custom";
          record({ type: "system_notice", turnId, payload: {
            code, ...(typeof frame.content === "string" ? { content: recordText(frame.content) } : {}),
          } });
        }
        if (message.role !== "assistant" && message.role !== "user") break;
        const role = message.role;
        const text = role === "user" ? userText(message.content) : "";
        if (role === "user" && isParentWake(text) && !hasImages(message.content)) break;
        const messageId = randomUUID();
        this.messages.set(role, { id: messageId, turnId, blocks: new Set() });
        record({ type: "message_started", messageId, turnId,
          ...(Number.isFinite(message.timestamp) ? { sourceAt: { timestamp: message.timestamp, precision: "message" } } : {}),
          payload: { role } });
        if (text) record({ type: "message_chunk", messageId, turnId, blockId: messageId + ":input",
          payload: { role, channel: "input", content: recordText(text) } }, true);
        break;
      }
      case "message_update": {
        captureTextFrames();
        break;
      }
      case "message_end": {
        const role = event.message.role;
        if (role !== "assistant" && role !== "user") break;
        if (role === "assistant") this.terminalStop = event.message.stopReason;
        const message = this.messages.get(role);
        if (!message) break; // No observed start, or a filtered wake prompt.
        captureTextFrames();
        this.messages.delete(role);
        if (event.message.role === "assistant" && Array.isArray(event.message.content)) {
          // Some providers only deliver final text for a block. Record it at
          // the boundary where it was observed.
          for (const [index, part] of event.message.content.entries()) {
            if (part?.type !== "text" || !part.text || message.blocks.has(index)) continue;
            record({ type: "message_chunk", messageId: message.id, turnId: message.turnId,
              blockId: message.id + ":" + index, payload: { role, channel: "text", content: recordText(part.text) } });
          }
        }
        const attachments = hasImages(event.message.content) ? [{ kind: "omitted", reason: "unavailable" } as const] : undefined;
        record({ type: "message_ended", messageId: message.id, turnId: message.turnId,
          payload: { role, ...(role === "assistant" ? { stopReason: this.terminalStop } : {}),
            ...(attachments ? { attachments } : {}) } }, role === "user");
        break;
      }
      case "tool_execution_start":
      case "tool_execution_end": {
        const { toolCallId, toolName, parentToolCallId } = event;
        const tool = { toolCallId, toolName, ...(parentToolCallId ? { parentToolCallId } : {}) };
        if (event.type === "tool_execution_start") {
          if (this.tools.size < MAX_PENDING_EVENTS) this.tools.set(toolCallId, { now: this.monotonic(), turnId });
          if (frame?.type === "tool_start") frame.startedAt = observedAt;
          record({ type: "tool_started", turnId, payload: { ...tool, args: recordArgs(event.args, this.opts.paths.sandbox) } });
        } else {
          const start = this.tools.get(toolCallId);
          this.tools.delete(toolCallId);
          const durationMs = start ? Math.max(0, Math.round(this.monotonic() - start.now)) : undefined;
          if (frame?.type === "tool_end" && durationMs !== undefined) frame.durationMs = durationMs;
          const result = event.result as { content?: unknown } | undefined;
          record({ type: "tool_ended", turnId: start?.turnId ?? turnId, payload: {
            ...tool, outcome: event.isError ? "failed" : "completed",
            result: typeof frame?.result === "string" ? recordText(frame.result, MAX_TEXT, frame.result.endsWith("…")) : { kind: "omitted", reason: "unavailable" },
            ...(hasImages(result?.content) ? { attachments: { kind: "omitted", reason: "unavailable" } } : {}),
            ...(durationMs !== undefined ? { durationMs } : {}),
          } });
        }
        break;
      }
      case "auto_retry_start":
        record({ type: "system_notice", turnId, payload: { code: "retry", attempt: event.attempt, maxAttempts: event.maxAttempts } });
        break;
      case "compaction_end":
        record({ type: "system_notice", turnId, payload: { code: "compaction",
          outcome: event.aborted ? "cancelled" : event.result ? "completed" : "failed" } });
        break;
    }
  }

  lateObserver(): void {
    this.add({ type: "record_gap", payload: { reason: "late_observer" } }, "server", this.wall(), true);
  }

  async finish(outcome: RunOutcome, reason?: string): Promise<void> {
    if (this.finishing) return;
    this.sealText();
    this.finishing = true;
    const terminal = this.draft({ type: "run_ended", payload: { outcome, ...(reason ? { reason } : {}) } }, "server", this.wall());
    if (this.overflow) this.pending.push(this.draft({ type: "record_gap", payload: {
      reason: "queue_overflow", droppedCount: this.overflow,
    } }, "server", terminal.observedAt));
    // If the terminal batch fails transiently, retry just the terminal event
    // with the gap; the failed batch's unconfirmed bytes are never replayed.
    for (let attempt = 0; attempt < 2; attempt++) {
      this.pending.push(terminal);
      while (this.writing || this.pending.length) {
        this.flush();
        await this.writing;
      }
      if (!this.failed) break;
    }
  }

  private draft(event: EventObservation, source: TaskEventDraft["source"], observedAt: number): TaskEventDraft {
    return { ...event, source, observedAt, eventId: randomUUID(), runId: this.opts.runId };
  }

  private add(event: EventObservation, source: TaskEventDraft["source"], observedAt: number, immediate = false): void {
    if (this.finishing) return;
    this.sealText();
    this.enqueue(event, source, observedAt);
    if (immediate || this.pending.length >= 32) this.flush();
    else this.schedule();
  }

  private enqueue(event: EventObservation, source: TaskEventDraft["source"], observedAt: number): void {
    if (this.pending.length >= MAX_PENDING_EVENTS) {
      this.overflow++;
      return;
    }
    if (this.overflow) {
      this.pending.push(this.draft({ type: "record_gap", payload: { reason: "queue_overflow", droppedCount: this.overflow } }, "server", observedAt));
      this.overflow = 0;
    }
    this.pending.push(this.draft(event, source, observedAt));
  }

  private addText(piece: NonNullable<TaskEventRecorder["text"]>): void {
    const previous = this.text;
    if (previous && piece.blockId !== undefined && previous.blockId === piece.blockId &&
        previous.channel === piece.channel && previous.value.length + piece.value.length <= MAX_CHUNK) {
      previous.value += piece.value;
    } else {
      this.sealText();
      this.text = piece;
    }
    if ((this.text?.value.length ?? 0) >= MAX_CHUNK || !piece.blockId) this.sealText();
    if (this.pending.length >= 32) this.flush();
    else this.schedule();
  }

  private sealText(): void {
    const piece = this.text;
    if (!piece) return;
    this.text = undefined;
    this.enqueue({ type: "message_chunk", messageId: piece.messageId, turnId: piece.turnId, blockId: piece.blockId,
      payload: { role: "assistant", channel: piece.channel, content: recordText(piece.value, MAX_CHUNK) } }, "pi", piece.observedAt);
  }

  private schedule(): void {
    if (!this.timer) {
      this.timer = setTimeout(() => this.flush(), FLUSH_MS);
      this.timer.unref();
    }
  }

  private flush(): void {
    clearTimeout(this.timer);
    this.timer = undefined;
    this.sealText();
    if (this.writing || !this.pending.length) return;
    const batch = this.pending;
    this.pending = [];
    const wroteGap = Boolean(this.failed);
    if (wroteGap) {
      batch.unshift(this.draft({ type: "record_gap", payload: { reason: "write_failed", droppedCount: this.failed } }, "server", this.wall()));
    }
    if (this.startEvent && this.startsRun && !batch.includes(this.startEvent)) batch.unshift(this.startEvent);
    const writesStart = this.startsRun;
    this.writing = appendTaskEvents(this.opts.paths, this.opts.scope, batch, this.startsRun)
      .then(() => {
        this.startsRun = false;
        this.startEvent = undefined;
        this.failed = 0;
        reportTaskEventWriteFailure(this.opts.paths, this.opts.scope, this.opts.runId, false);
      }, (err) => {
        this.failed += Math.max(1, batch.length - Number(wroteGap) - Number(writesStart));
        reportTaskEventWriteFailure(this.opts.paths, this.opts.scope, this.opts.runId, true);
        this.opts.log.warn({ err }, "failed to persist task execution events");
      })
      .finally(() => {
        this.writing = undefined;
        if (this.pending.length) this.flush();
      });
  }
}
