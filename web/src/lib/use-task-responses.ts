"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { apiFetch } from "@/lib/projects";
import type { ChatMessage } from "@/lib/use-agent";

export type AnswerFeedback = "up" | "down" | null;
export interface TaskLink { id: string; name: string; createdAt?: string }
export interface TaskResponse {
  entryId: string;
  content: string;
  feedback: AnswerFeedback;
  children: TaskLink[];
}
interface ResponseData { responses: TaskResponse[]; source: (TaskLink & { entryId: string }) | null }
const CHANGED = "kady:task-responses-changed";
export function notifyTaskResponsesChanged(projectId: string) {
  window.dispatchEvent(new CustomEvent(CHANGED, { detail: { projectId } }));
}
/** Match live bubbles only against an ordered, exact-text persisted answer.
 * Restored bubbles use Pi entry ids directly. Never persist transient React ids. */
export function matchTaskResponses(messages: ChatMessage[], responses: TaskResponse[]) {
  const remaining = [...responses];
  const matched = new Map<string, TaskResponse>();
  for (const message of messages) {
    if (message.role !== "assistant") continue;
    const index = remaining.findIndex((response) => message.entryId
      ? response.entryId === message.entryId
      : response.content === message.content);
    if (index < 0) continue;
    const [response] = remaining.splice(index, 1);
    matched.set(message.id, response);
  }
  return matched;
}
export function useTaskResponses(projectId: string, sessionId: string | null, streaming: boolean, messages: ChatMessage[]) {
  const [data, setData] = useState<ResponseData>({ responses: [], source: null });
  const [error, setError] = useState(false);
  const revision = useRef(0);
  const refresh = useCallback(async () => {
    const request = ++revision.current;
    if (!sessionId) { setData({ responses: [], source: null }); setError(false); return; }
    try {
      const res = await apiFetch(`/sessions/${encodeURIComponent(sessionId)}/responses`, {}, projectId);
      if (!res.ok) throw new Error("Response lookup failed");
      const next = await res.json() as ResponseData;
      if (revision.current === request) { setData(next); setError(false); }
    } catch { if (revision.current === request) setError(true); }
  }, [projectId, sessionId]);
  useEffect(() => {
    setData({ responses: [], source: null });
    setError(false);
    return () => { revision.current++; };
  }, [projectId, sessionId]);
  const hasAnswers = messages.some((message) => message.role === "assistant" && Boolean(message.content));
  useEffect(() => {
    if (!streaming && hasAnswers) void refresh();
  }, [refresh, streaming, hasAnswers]);
  useEffect(() => {
    const changed = (event: Event) => {
      if (hasAnswers && (event as CustomEvent).detail?.projectId === projectId) void refresh();
    };
    const focus = () => { if (hasAnswers) void refresh(); };
    window.addEventListener(CHANGED, changed);
    window.addEventListener("focus", focus);
    return () => { window.removeEventListener(CHANGED, changed); window.removeEventListener("focus", focus); };
  }, [projectId, refresh, hasAnswers]);
  return { byMessage: useMemo(() => matchTaskResponses(messages, data.responses), [messages, data.responses]), source: data.source, error, refresh };
}
