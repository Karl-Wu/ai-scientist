"use client";

import { useEffect, useRef, useState, type MutableRefObject } from "react";
import type { Model } from "@/components/model-selector";
import { apiFetch } from "./projects";

export function restoredModelChoice(id: string, models: Model[]): Model {
  return models.find((model) => model.id === id) ?? {
    id, label: id, provider: id.split("/", 1)[0], tier: "mid",
    context_length: 0, pricing: { prompt: 0, completion: 0 },
    modality: null, description: "", available: false,
  };
}

/** Browser draft choice wins; otherwise restore the session's recorded model. */
export function useSessionModel({ projectId, sessionId, initialModel, models, touched, onRestore }: {
  projectId: string;
  sessionId?: string | null;
  initialModel?: Model;
  models: Model[];
  touched: MutableRefObject<boolean>;
  onRestore: (model: Model) => void;
}): boolean {
  const [ready, setReady] = useState(!sessionId || !!initialModel);
  const modelsRef = useRef(models);
  modelsRef.current = models;
  useEffect(() => {
    if (!sessionId || initialModel) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const load = async () => {
      try {
        const response = await apiFetch(`/sessions/${encodeURIComponent(sessionId)}/selection`, { signal: controller.signal, cache: "no-store" }, projectId);
        if (!response.ok && response.status !== 404 && response.status !== 410) throw new Error("Selection unavailable");
        const selection = response.ok ? await response.json() as { model?: unknown } : null;
        if (controller.signal.aborted) return;
        if (!touched.current && typeof selection?.model === "string" && selection.model) {
          onRestore(restoredModelChoice(selection.model, modelsRef.current));
        }
        setReady(true);
      } catch {
        if (!controller.signal.aborted) timer = setTimeout(load, 1000);
      }
    };
    void load();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [projectId, sessionId, initialModel, touched, onRestore]);
  return ready;
}
