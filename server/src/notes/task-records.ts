import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "typebox";
import { relativizeSandboxPaths } from "../agent/events.ts";
import { isRunClaimed } from "../agent/run-pipeline.ts";
import { scientificResultFromDetails } from "../agent/scientific-result.ts";
import { readEntries, textOf, type ToolCallPart } from "../agent/session-export.ts";
import { historyFromEntries } from "../agent/session-history.ts";
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

interface TaskRecord {
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
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/.test(sessionId)) throw new SandboxError(400, "Invalid source task");
  const paths = resolvePaths(projectId);
  const activeAtStart = isRunClaimed(projectId, sessionId);
  let damaged = false;
  // Read the saved conversation once. The event scanner separately freezes its committed prefix.
  const saved = readEntries(noteSessionFile(projectId, sessionId), () => { damaged = true; });
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
  let round = 0;
  for (const message of included) {
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

  const observations = new Map<string, ToolObservation>();
  const savedMessages = new Set(saved.flatMap((row) => row.type === "message" && row.message.timestamp !== undefined
    ? [row.message.role + ":" + row.message.timestamp] : []));
  const eventMessages = new Map<string, {
    role: string; timestamp: number; saved: boolean; ended?: boolean; text: string[]; reasoning: string[]; flags: Set<NoteRecordFlag>;
  }>();
  let unsupported = false;
  const timeline = await scanTaskTimeline(paths, { projectId, sessionId }, () => isRunClaimed(projectId, sessionId), (event) => {
    signal.throwIfAborted();
    if (event.schemaVersion !== TASK_EVENT_SCHEMA_VERSION || !event.payload || typeof event.payload !== "object") {
      unsupported = true;
      return;
    }
    if (event.type === "tool_started" || event.type === "tool_ended") {
      const payload = event.payload as Payload<"tool_started"> | Payload<"tool_ended">;
      if (typeof payload.toolCallId !== "string") return;
      const previous = observations.get(payload.toolCallId) ?? { timestamp: event.observedAt };
      if (event.type === "tool_started") {
        if (previous.start) ambiguousIds.add(payload.toolCallId);
        previous.start = payload as Payload<"tool_started">;
      } else {
        if (previous.end) ambiguousIds.add(payload.toolCallId);
        previous.end = payload as Payload<"tool_ended">;
      }
      observations.set(payload.toolCallId, previous);
    } else if (answerId === undefined) {
      if (event.type === "system_notice") {
        const { code, content, outcome } = event.payload as Payload<"system_notice">;
        if (typeof code === "string") {
          add("notice", taskLink(code), [code, outcome, contentText(content)].filter(Boolean).join("\n"),
            { timestamp: event.observedAt }, content ? contentFlags(content) : []);
        }
      } else if (event.type === "message_started" && event.messageId) {
        const { role } = event.payload as Payload<"message_started">;
        eventMessages.set(event.messageId, { role, timestamp: event.observedAt,
          saved: savedMessages.has(role + ":" + event.sourceAt?.timestamp), text: [], reasoning: [], flags: new Set() });
      } else if (event.type === "message_ended" && event.messageId) {
        const item = eventMessages.get(event.messageId);
        if (item) item.ended = true;
      } else if (event.type === "message_chunk" && event.messageId) {
        const item = eventMessages.get(event.messageId);
        if (!item || item.saved) return;
        const { channel, content } = event.payload as Payload<"message_chunk">;
        const value = contentText(content);
        (channel === "thinking" ? item.reasoning : item.text).push(value);
        for (const flag of contentFlags(content)) item.flags.add(flag);
      }
    }
  });
  signal.throwIfAborted();

  for (const item of eventMessages.values()) {
    const body = item.text.join("");
    if (!item.ended) item.flags.add("unavailable");
    const flags = [...item.flags];
    if (body.trim()) add(item.role === "user" ? "question" : "answer", taskLink(compactLabel(body, "Recorded message")), body, { timestamp: item.timestamp }, flags);
    if (item.reasoning.length) add("reasoning", taskLink("Recorded reasoning"), item.reasoning.join(""), { timestamp: item.timestamp }, flags);
  }

  const savedResults = new Map(saved.flatMap((row) => row.type === "message" && row.message.role === "toolResult" && row.message.toolCallId
    ? [[row.message.toolCallId, row.message] as const] : []));
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
    if (ambiguousIds.has(id)) { damaged = true; continue; }
    const owner = toolOwners.get(id);
    const event = observations.get(id);
    const result = savedResults.get(id);
    const name = owner?.name ?? event?.start?.toolName ?? event?.end?.toolName ?? result?.toolName ?? "Tool";
    const state = event?.end?.outcome ?? (result ? result.isError ? "failed" : "completed" : "unknown");
    const args = owner ? recordArgs(owner.args, paths.sandbox) : event?.start?.args;
    const output = textOf(result?.content ?? []);
    const card = result && !result.isError ? scientificResultFromDetails(result.details) : undefined;
    const extra = { round: owner?.round, timestamp: event?.timestamp ?? result?.timestamp ?? owner?.timestamp };
    const link = (kind: "tool" | "result", label: string): Source => owner
      ? { kind, sessionId, toolCallId: id, label } : taskLink(label);
    const resultFlags = output || card ? [] : contentFlags(event?.end?.result);
    const body = [`Tool: ${name}\nStatus: ${state}`, contentText(args) && "Arguments:\n" + contentText(args),
      (output || contentText(event?.end?.result)) && "Output:\n" + (output || contentText(event?.end?.result))].filter(Boolean).join("\n\n");
    add("tool", link("tool", name + " · " + state), body, extra, [...contentFlags(args), ...resultFlags]);
    if (card) add("result", link("result", card.title), JSON.stringify(card, null, 2), extra);
  }

  records.sort((a, b) => (a.timestamp ?? 0) - (b.timestamp ?? 0));
  const coverage = damaged || unsupported || timeline.incomplete || activeAtStart ? "incomplete"
    : timeline.through ? "recorded" : "legacy";
  return makeTools(records, coverage);
}

const READ_CHARS = 4_000;
const PAGE_SIZE = 20;

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
  const read: AgentTool<typeof readParameters> = {
    name: "read_task_record", label: "Read task records",
    description: "Read the saved text, arguments, outputs, or result for up to six record IDs. Pass nextOffset to read more of a long record. No file or attachment content is fetched.",
    parameters: readParameters,
    async execute(_id, args) {
      const data = args.records.map(({ id, offset = 0 }) => {
        const entry = byId.get(id);
        if (!entry || offset >= entry.body.length) return { id, unavailable: true };
        if (readBudget <= 0) return { id, limitReached: true };
        const end = Math.min(offset + READ_CHARS, offset + readBudget, entry.body.length);
        const text = entry.body.slice(offset, end);
        readBudget -= text.length;
        const previous = reads.get(id) ?? { ranges: [], first: text.slice(0, 1_200), last: "" };
        previous.ranges.push([offset, end]);
        previous.last = offset > 0 ? text.slice(0, 1_200) : "";
        reads.set(id, previous);
        return { id, kind: entry.kind, label: entry.source.label, text, flags: entry.flags,
          nextOffset: end < entry.body.length ? end : null };
      });
      return { content: [{ type: "text", text: JSON.stringify(data) }], details: undefined };
    },
  };

  return {
    tools: [index, read] as const,
    size: entries.length,
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
