import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "typebox";
import { relativizeSandboxPaths } from "../agent/events.ts";
import { isRunClaimed } from "../agent/run-pipeline.ts";
import { scientificResultFromDetails } from "../agent/scientific-result.ts";
import { readEntries, textOf, type MessageRow, type ThinkingPart, type ToolCallPart } from "../agent/session-export.ts";
import { historyFromEntries } from "../agent/session-history.ts";
import { isParentWake } from "../agent/subagent-wake.ts";
import { scanTaskTimeline } from "../agent/task-event-log.ts";
import { recordArgs, redactText } from "../agent/task-event-recorder.ts";
import { TASK_EVENT_SCHEMA_VERSION, type RecordedContent, type TaskEvent } from "../agent/task-events.ts";
import { resolvePaths } from "../projects.ts";
import { SandboxError } from "../sandbox-fs.ts";
import { splitComposerContext } from "../../../web/src/lib/composer-context.ts";
import type { NoteCandidateBatch, NoteRecordFlag, NoteSourceLink } from "../../../web/src/lib/note-pages.ts";
import { noteSessionFile } from "./source.ts";

type Source = Exclude<NoteSourceLink, { kind: "file" | "pdfAnnotation" }>;
const kinds = ["question", "answer", "tool", "result", "reasoning", "notice"] as const;
type Kind = typeof kinds[number];

export interface TaskRecord {
  kind: Kind;
  source: Source;
  body: string;
  flags: NoteRecordFlag[];
  round?: number;
  timestamp?: number;
}

type Payload<T extends TaskEvent["type"]> = Extract<TaskEvent, { type: T }>["payload"];
type ToolObservation = { start?: Payload<"tool_started">; end?: Payload<"tool_ended">; timestamp: number };
type DraftTaskRecords = NonNullable<NoteCandidateBatch["taskRecords"]>;

function contentText(content: RecordedContent | undefined) {
  return content?.kind === "inline"
    ? typeof content.value === "string" ? content.value : JSON.stringify(content.value, null, 2) ?? ""
    : "";
}

function contentFlags(content: RecordedContent | undefined): NoteRecordFlag[] {
  if (!content || content.kind !== "inline") return ["unavailable"];
  return [...(content.truncated ? ["truncated" as const] : []), ...(content.redacted ? ["redacted" as const] : [])];
}

function compactLabel(text: string, fallback: string) {
  return redactText(text).replace(/^[#>\s]+/, "").replace(/\s+/g, " ").trim().slice(0, 120) || fallback;
}

export async function taskRecordTools(projectId: string, sessionId: string, answerId: string | undefined, signal: AbortSignal) {
  const { records, coverage } = await buildTaskRecords(projectId, sessionId, signal, { answerId });
  return makeTools(records, coverage);
}

export async function buildTaskRecords(projectId: string, sessionId: string, signal: AbortSignal,
  { answerId, complete = false }: { answerId?: string; complete?: boolean } = {}) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/.test(sessionId)) throw new SandboxError(400, "Invalid source task");
  const paths = resolvePaths(projectId);
  const activeAtStart = isRunClaimed(projectId, sessionId);
  let damaged = false;
  let damagedRows = 0;
  let unsupportedEvents = 0;
  let eventGaps = 0;
  let excludedAttachments = 0;
  const contextChanges: Record<string, unknown>[] = [];
  // Read the saved conversation once. The event scanner separately freezes its committed prefix.
  const saved = readEntries(noteSessionFile(projectId, sessionId), () => { damaged = true; damagedRows++; },
    complete ? (entry) => { if (entry.type === "context_edit") contextChanges.push(entry); } : undefined);
  const declaredIds = new Set<string>();
  const ambiguousIds = new Set<string>();
  for (const row of saved) {
    if (row.type !== "message" || row.message.role !== "assistant") continue;
    for (const part of row.message.content ?? []) {
      if (part.type !== "toolCall") continue;
      const { id } = part as ToolCallPart;
      if (declaredIds.has(id)) ambiguousIds.add(id);
      declaredIds.add(id);
    }
  }
  const history = historyFromEntries(saved, paths.sandbox);
  const selected = answerId === undefined ? -1 : history.findIndex((row) => row.role === "assistant" && row.entryId === answerId);
  if (answerId !== undefined && selected < 0) throw new SandboxError(404, "Source answer is unavailable in this task");

  let first = selected;
  let question: typeof history[number] | undefined;
  if (selected >= 0) {
    // A compaction card can split one answer into two visible parts.
    let preceding = first - 1;
    while (history[preceding]?.customType === "compaction") {
      while (history[preceding]?.customType === "compaction") preceding--;
      if (history[preceding]?.role !== "assistant") break;
      first = preceding;
      preceding = first - 1;
    }
    for (let index = first - 1; index >= 0; index--) {
      const row = history[index];
      if (row.role === "system" && row.customType !== "compaction") break;
      if (row.role === "user") { question = row; break; }
    }
  }
  const included = selected >= 0 ? [...(question ? [question] : []), ...history.slice(first, selected + 1)] : history;
  const records: TaskRecord[] = [];
  const taskLink = (label: string): Source => ({ kind: "task", sessionId, label });
  const add = (kind: Kind, source: Source, raw: string, extra: Pick<TaskRecord, "round" | "timestamp"> = {}, flags: NoteRecordFlag[] = []) => {
    const relative = relativizeSandboxPaths(raw, paths.sandbox);
    const body = redactText(relative);
    records.push({ kind, source: { ...source, label: compactLabel(source.label, kind) }, body,
      flags: [...new Set([...flags, ...(body !== relative ? ["redacted" as const] : [])])], ...extra });
  };

  const toolOwners = new Map<string, { name: string; args: unknown; round: number; timestamp?: number }>();
  const addAmbiguousTool = (id: string, label: string, content: RecordedContent, timestamp?: number) => {
    add("tool", taskLink(label), "Tool call ID: " + id + "\n" + contentText(content),
      { timestamp }, ["unavailable", ...contentFlags(content)]);
  };
  let round = 0;
  for (const message of complete ? [] : included) {
    signal.throwIfAborted();
    if (message.role === "user") round++;
    const extra = { round: round || undefined, timestamp: message.timestamp };
    const messageLink = (label: string): Source => message.entryId
      ? { kind: "message", sessionId, entryId: message.entryId, label } : taskLink(label);
    if (message.role === "user") {
      const body = splitComposerContext(message.content ?? "").text;
      if (body.trim()) add("question", messageLink(compactLabel(body, "Question")), body, extra);
      continue;
    }
    if (message.role !== "assistant") continue;
    const bodies = { text_delta: [] as string[], thinking_delta: [] as string[] };
    for (const frame of message.frames ?? []) {
      if ((frame.type === "text_delta" || frame.type === "thinking_delta") && typeof frame.delta === "string") {
        bodies[frame.type].push(frame.delta);
      }
      if (frame.type === "tool_start" && typeof frame.toolCallId === "string") {
        toolOwners.set(frame.toolCallId, { name: String(frame.toolName ?? "Tool"), args: frame.args, round, timestamp: message.timestamp });
      }
    }
    const body = bodies.text_delta.join("\n\n");
    if (body.trim()) add("answer", messageLink(compactLabel(body, "Answer")), body, extra);
    if (bodies.thinking_delta.length) add("reasoning", messageLink("Reasoning · " + compactLabel(body, "Answer")), bodies.thinking_delta.join("\n\n"), extra);
  }
  if (complete) {
    const visibleIds = new Set(history.flatMap((row) => row.entryId ? [row.entryId] : []));
    for (const row of saved) {
      signal.throwIfAborted();
      if (row.type !== "message") {
        const timestamp = Date.parse(row.timestamp ?? "") || undefined;
        if (row.type === "compaction") {
          add("notice", taskLink("Context compaction"), row.summary, { timestamp, round });
        } else {
          const details = row.details === undefined ? "" : contentText(recordArgs(row.details, paths.sandbox, true));
          add("notice", taskLink(row.customType), [textOf(row.content), details].filter(Boolean).join("\n\n"), { timestamp, round });
        }
        continue;
      }
      const message = row.message;
      const parts = Array.isArray(message.content) ? message.content : [];
      excludedAttachments += parts.filter((part) => part.type === "image").length;
      const link = (label: string): Source => row.id && visibleIds.has(row.id)
        ? { kind: "message", sessionId, entryId: row.id, label } : taskLink(label);
      const body = textOf(message.content ?? []);
      const timestamp = message.timestamp;
      if (message.role === "user") {
        if (!isParentWake(body) && (body.trim() || parts.length)) {
          add("question", link(compactLabel(body, "Question")), body, { timestamp, round: ++round });
        }
      } else if (message.role === "assistant") {
        if (body.trim()) add("answer", link(compactLabel(body, "Answer")), body, { timestamp, round });
        const thinking = parts.filter((part): part is ThinkingPart => part.type === "thinking");
        const readable = thinking.flatMap((part) => !part.redacted && part.thinking ? [part.thinking] : []);
        if (thinking.length) add("reasoning", link("Recorded reasoning"), readable.join("\n\n"), { timestamp, round },
          thinking.some((part) => part.redacted || !part.thinking) ? ["unavailable"] : []);
        if (message.errorMessage) add("notice", taskLink("Assistant error"), message.errorMessage, { timestamp, round });
        for (const part of parts) {
          if (part.type !== "toolCall") continue;
          const call = part as ToolCallPart;
          const previous = toolOwners.get(call.id);
          if (previous) addAmbiguousTool(call.id, previous.name, recordArgs(previous.args, paths.sandbox, true), previous.timestamp);
          toolOwners.set(call.id, { name: call.name, args: call.arguments ?? {}, timestamp, round });
        }
      }
    }
    for (const { timestamp, targetId, replacement } of contextChanges) {
      const change = recordArgs({ targetId, replacement }, paths.sandbox, true);
      add("notice", taskLink("Context edit"), contentText(change),
        { timestamp: typeof timestamp === "string" ? Date.parse(timestamp) || undefined : undefined }, contentFlags(change));
    }
  }

  const observations = new Map<string, ToolObservation>();
  const savedMessages = new Map(saved.flatMap((row) => row.type === "message" && row.message.timestamp !== undefined
    ? [[row.message.role + ":" + row.message.timestamp, row.message] as const] : []));
  const eventMessages = new Map<string, {
    role: string; timestamp: number; saved?: MessageRow["message"]; ended?: boolean;
    text: string[]; reasoning: string[]; flags: Set<NoteRecordFlag>;
  }>();
  let unsupported = false;
  const timeline = await scanTaskTimeline(paths, { projectId, sessionId }, () => isRunClaimed(projectId, sessionId), (event) => {
    signal.throwIfAborted();
    if (event.schemaVersion !== TASK_EVENT_SCHEMA_VERSION || !event.payload || typeof event.payload !== "object") {
      unsupported = true;
      unsupportedEvents++;
      return;
    }
    if (event.type === "tool_started" || event.type === "tool_ended") {
      const payload = event.payload as Payload<"tool_started"> | Payload<"tool_ended">;
      if (typeof payload.toolCallId !== "string") return;
      const previous = observations.get(payload.toolCallId) ?? { timestamp: event.observedAt };
      if (event.type === "tool_started") {
        if (previous.start) {
          ambiguousIds.add(payload.toolCallId);
          if (complete) addAmbiguousTool(payload.toolCallId, previous.start.toolName, previous.start.args, previous.timestamp);
        }
        previous.start = payload as Payload<"tool_started">;
      } else {
        if (previous.end) {
          ambiguousIds.add(payload.toolCallId);
          if (complete) addAmbiguousTool(payload.toolCallId, previous.end.toolName, previous.end.result, previous.timestamp);
        }
        previous.end = payload as Payload<"tool_ended">;
      }
      observations.set(payload.toolCallId, previous);
    } else if (answerId === undefined) {
      if (event.type === "system_notice") {
        const { code, content, outcome, attempt, maxAttempts } = event.payload as Payload<"system_notice">;
        if (typeof code === "string") {
          add("notice", taskLink(code), [code, outcome, complete && attempt !== undefined ? `Attempt: ${attempt}/${maxAttempts ?? "?"}` : undefined,
            contentText(content)].filter(Boolean).join("\n"),
            { timestamp: event.observedAt }, content ? contentFlags(content) : []);
        }
      } else if (complete && event.type === "run_ended") {
        const { outcome, reason } = event.payload as Payload<"run_ended">;
        add("notice", taskLink("Run · " + outcome), [outcome, reason].filter(Boolean).join("\n"), { timestamp: event.observedAt });
      } else if (complete && event.type === "record_gap") {
        eventGaps++;
        const gap = event.payload as Payload<"record_gap">;
        add("notice", taskLink("Execution log gap"), JSON.stringify(gap), { timestamp: event.observedAt }, ["unavailable"]);
      } else if (event.type === "message_started" && event.messageId) {
        const { role } = event.payload as Payload<"message_started">;
        eventMessages.set(event.messageId, { role, timestamp: event.observedAt,
          saved: savedMessages.get(role + ":" + event.sourceAt?.timestamp), text: [], reasoning: [], flags: new Set() });
      } else if (event.type === "message_ended" && event.messageId) {
        const item = eventMessages.get(event.messageId);
        if (item) item.ended = true;
      } else if (event.type === "message_chunk" && event.messageId) {
        const item = eventMessages.get(event.messageId);
        if (!item) return;
        const { channel, content } = event.payload as Payload<"message_chunk">;
        if (item.saved && (!complete || (channel === "thinking"
          ? Array.isArray(item.saved.content) && item.saved.content.some((part) => part.type === "thinking" && !(part as ThinkingPart).redacted && Boolean((part as ThinkingPart).thinking))
          : Boolean(textOf(item.saved.content ?? []))))) return;
        const value = contentText(content);
        (channel === "thinking" ? item.reasoning : item.text).push(value);
        for (const flag of contentFlags(content)) item.flags.add(flag);
      }
    }
  });
  signal.throwIfAborted();

  for (const item of eventMessages.values()) {
    if (complete && item.saved && !item.text.length && !item.reasoning.length) continue;
    const body = item.text.join("");
    if (!item.ended) item.flags.add("unavailable");
    const flags = [...item.flags];
    if (body.trim()) add(item.role === "user" ? "question" : "answer", taskLink(compactLabel(body, "Recorded message")), body, { timestamp: item.timestamp }, flags);
    if (item.reasoning.length) add("reasoning", taskLink("Recorded reasoning"), item.reasoning.join(""), { timestamp: item.timestamp }, flags);
    if (complete && flags.length && !body.trim() && !item.reasoning.length) {
      add("notice", taskLink("Message content unavailable"), "", { timestamp: item.timestamp }, flags);
    }
  }

  const savedResults = new Map<string, MessageRow["message"]>();
  for (const row of saved) {
    if (row.type !== "message" || row.message.role !== "toolResult" || !row.message.toolCallId) continue;
    const { toolCallId } = row.message;
    const previous = savedResults.get(toolCallId);
    if (previous && complete) {
      ambiguousIds.add(toolCallId);
      addAmbiguousTool(toolCallId, previous.toolName ?? "Tool", recordArgs({
        output: textOf(previous.content ?? []), details: previous.details, isError: previous.isError,
      }, paths.sandbox, true), previous.timestamp);
    }
    savedResults.set(toolCallId, row.message);
  }
  const toolIds = new Set(toolOwners.keys());
  if (answerId === undefined) {
    for (const id of savedResults.keys()) toolIds.add(id);
    for (const id of observations.keys()) toolIds.add(id);
  } else {
    // A child is in scope only when the recorded call explicitly links it to an in-scope call.
    for (const [id, observation] of observations) {
      const seen = new Set([id]);
      let parent = observation.start?.parentToolCallId ?? observation.end?.parentToolCallId;
      while (parent && !seen.has(parent)) {
        if (ambiguousIds.has(parent)) break;
        if (toolOwners.has(parent)) { toolIds.add(id); break; }
        seen.add(parent);
        const next = observations.get(parent);
        parent = next?.start?.parentToolCallId ?? next?.end?.parentToolCallId;
      }
    }
  }

  for (const id of toolIds) {
    if (ambiguousIds.has(id)) {
      damaged = true;
      if (!complete) continue;
    }
    const owner = toolOwners.get(id);
    const event = observations.get(id);
    const result = savedResults.get(id);
    const name = owner?.name ?? event?.start?.toolName ?? event?.end?.toolName ?? result?.toolName ?? "Tool";
    const state = event?.end?.outcome ?? (result ? result.isError ? "failed" : "completed" : "unknown");
    const args = owner ? recordArgs(owner.args, paths.sandbox, complete) : event?.start?.args;
    const output = textOf(result?.content ?? []);
    const card = result && !result.isError ? scientificResultFromDetails(result.details) : undefined;
    const extra = { round: owner?.round, timestamp: event?.timestamp ?? result?.timestamp ?? owner?.timestamp };
    const link = (kind: "tool" | "result", label: string): Source => owner && !ambiguousIds.has(id)
      ? { kind, sessionId, toolCallId: id, label } : taskLink(label);
    const resultFlags = output || card ? [] : contentFlags(event?.end?.result);
    if (complete) {
      const meta = result?.details as { truncation?: { truncated?: boolean }; linesTruncated?: boolean; matchLimitReached?: number } | undefined;
      if (meta?.truncation?.truncated || meta?.linesTruncated || meta?.matchLimitReached ||
          /\[(?:output |tool output )?truncated(?:[\s:,.\]]|$)/i.test(output)) resultFlags.push("truncated");
    }
    if (complete && ambiguousIds.has(id)) resultFlags.push("unavailable");
    const details = complete && result?.details !== undefined && !card ? recordArgs(result.details, paths.sandbox, true) : undefined;
    const body = [`Tool: ${name}\nStatus: ${state}`, contentText(args) && "Arguments:\n" + contentText(args),
      (output || contentText(event?.end?.result)) && "Output:\n" + (output || contentText(event?.end?.result)),
      contentText(details) && "Saved details:\n" + contentText(details)].filter(Boolean).join("\n\n");
    add("tool", link("tool", name + " · " + state), body, extra, [...contentFlags(args), ...resultFlags, ...(details ? contentFlags(details) : [])]);
    if (card) add("result", link("result", card.title), JSON.stringify(card, null, 2), extra);
  }

  records.sort((a, b) => (a.timestamp ?? 0) - (b.timestamp ?? 0));
  const coverage: DraftTaskRecords["coverage"] = damaged || unsupported || timeline.incomplete || activeAtStart ? "incomplete"
    : timeline.through ? "recorded" : "legacy";
  return { records, coverage, eventCount: timeline.through, damagedRows, unsupportedEvents, eventGaps, excludedAttachments,
    activeAtStart, ambiguousTools: ambiguousIds.size };
}

const READ_CHARS = 4_000;
const PAGE_SIZE = 20;
const OVERVIEW_CHARS = 1_200;

function makeTools(records: TaskRecord[], coverage: DraftTaskRecords["coverage"]) {
  const entries = records.map((record, index) => ({ ...record, id: `r${index + 1}` }));
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  const reads = new Map<string, { ranges: [number, number][]; first: string; last: string }>();
  let readBudget = 100_000;
  const indexParameters = Type.Object({
    query: Type.Optional(Type.String({ maxLength: 200 })),
    kind: Type.Optional(Type.Union(kinds.map((kind) => Type.Literal(kind)))),
    round: Type.Optional(Type.Integer({ minimum: 1 })),
    cursor: Type.Optional(Type.Integer({ minimum: 0 })),
  });
  const index: AgentTool<typeof indexParameters> = {
    name: "list_task_records", label: "Find task records",
    description: "Find saved records in the selected task or answer. Paginate from cursor 0 in chronological order, or search by keywords, type or round. Set kind to reasoning to search reasoning text. Read records before citing them.",
    parameters: indexParameters,
    async execute(_id, { query, kind, round, cursor = 0 }) {
      const words = query?.trim().toLowerCase().split(/\s+/).filter(Boolean) ?? [];
      const matches = entries.filter((entry) => {
        if ((kind && entry.kind !== kind) || (round && entry.round !== round)) return false;
        if (!words.length) return true;
        const searchable = (entry.source.label + (entry.kind !== "reasoning" || kind === "reasoning" ? " " + entry.body : "")).toLowerCase();
        return words.every((word) => searchable.includes(word));
      });
      const page = matches.slice(cursor, cursor + PAGE_SIZE);
      return { content: [{ type: "text", text: JSON.stringify({
        coverage, total: matches.length, nextCursor: cursor + page.length < matches.length ? cursor + page.length : null,
        records: page.map(({ id, kind, source, round, timestamp, body, flags }) => ({
          id, kind, label: source.label, round, timestamp, flags,
          ...(kind === "reasoning" ? {} : { preview: body.slice(0, 220) }),
        })),
      }) }], details: undefined };
    },
  };
  const readParameters = Type.Object({
    records: Type.Array(Type.Object({
      id: Type.String({ maxLength: 24 }), offset: Type.Optional(Type.Integer({ minimum: 0 })),
    }), { minItems: 1, maxItems: 6 }),
  });
  function readRecords(records: { id: string; offset?: number }[], maxChars = READ_CHARS) {
    return records.map(({ id, offset = 0 }) => {
      const entry = byId.get(id);
      if (!entry || offset >= entry.body.length) return { id, unavailable: true };
      if (readBudget <= 0) return { id, limitReached: true };
      const end = Math.min(offset + maxChars, offset + readBudget, entry.body.length);
      const text = entry.body.slice(offset, end);
      readBudget -= text.length;
      const previous = reads.get(id) ?? { ranges: [], first: text.slice(0, 1_200), last: "" };
      previous.ranges.push([offset, end]);
      previous.last = offset > 0 ? text.slice(0, 1_200) : "";
      reads.set(id, previous);
      return { id, kind: entry.kind, label: entry.source.label, text, flags: entry.flags,
        nextOffset: end < entry.body.length ? end : null };
    });
  }
  const read: AgentTool<typeof readParameters> = {
    name: "read_task_record", label: "Read task records",
    description: "Read the saved text, arguments, outputs, or result for up to six record IDs. Pass nextOffset to read more of a long record. No file or attachment content is fetched.",
    parameters: readParameters,
    async execute(_id, args) {
      return { content: [{ type: "text", text: JSON.stringify(readRecords(args.records)) }], details: undefined };
    },
  };

  return {
    tools: [index, read] as const,
    size: entries.length,
    get readCount() { return reads.size; },
    overviewEvidence() {
      if (entries.length <= PAGE_SIZE) return [];
      const chosen = (["answer", "result"] as const).flatMap((kind) => {
        const matches = entries.filter((entry) => entry.kind === kind);
        return [matches[0], matches[Math.floor(matches.length / 2)], matches.at(-1)];
      });
      const ids = [...new Set(chosen.flatMap((entry) => entry ? [entry.id] : []))];
      return readRecords(ids.map((id) => ({ id })), OVERVIEW_CHARS);
    },
    fallbackEvidence() {
      if ([...reads.keys()].some((id) => byId.get(id)?.kind !== "reasoning")) return [];
      // Save a finalization turn from being forced to draft from index previews alone.
      const selected = (["answer", "result", "question", "tool"] as const).flatMap((kind) => {
        const entry = entries.findLast((item) => item.kind === kind);
        return entry ? [{ id: entry.id }] : [];
      });
      return readRecords(selected).filter((item) => item.text !== undefined);
    },
    cite(ids: unknown) {
      if (!Array.isArray(ids) || !ids.length || ids.length > 8) throw new Error("Cite between one and eight task records per candidate");
      return [...new Set(ids)].map((id) => {
        const entry = byId.get(id);
        const observed = reads.get(id);
        if (!entry || !observed || entry.kind === "reasoning") throw new Error("Cite evidence records you read. Use reasoning only to guide your review.");
        const excerpt = [observed.first, observed.last].filter((text, index, parts) => text && parts.indexOf(text) === index).join("\n\n[…]\n\n");
        return { ...entry.source, excerpt, ...(entry.flags.length ? { recordFlags: entry.flags } : {}) };
      });
    },
    report(): DraftTaskRecords {
      const read = [...reads].map(([id, item]) => {
        const entry = byId.get(id)!;
        let through = 0;
        for (const [start, end] of item.ranges.sort((a, b) => a[0] - b[0])) {
          if (start > through) break;
          through = Math.max(through, end);
        }
        return { id, label: entry.source.label, partial: through < entry.body.length, flags: entry.flags };
      });
      return { total: entries.length, coverage, read };
    },
  };
}
