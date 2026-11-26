export const LOCAL_PREVIEW_EVENT = "kady:open-local-preview";
export interface LocalPreviewRef { projectId: string; sessionId: string; previewId: string; title: string }

export function previewAction(result?: string): Pick<LocalPreviewRef, "previewId" | "title"> | undefined {
  try {
    const value = JSON.parse(result ?? "");
    if (typeof value.title === "string" && /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i.test(value.previewId))
      return { previewId: value.previewId, title: value.title };
  } catch { /* Pending and failed calls have no action. */ }
}
