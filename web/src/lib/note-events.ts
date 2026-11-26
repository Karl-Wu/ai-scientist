"use client";

import { useEffect, useState } from "react";

const NOTE_PAGES_CHANGED = "kady:note-pages-changed";

export function notifyNotePagesChanged(projectId: string): void {
  window.dispatchEvent(new CustomEvent(NOTE_PAGES_CHANGED, { detail: projectId }));
}

export function useNotePagesRevision(projectId: string): number {
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    function changed(event: Event) {
      if ((event as CustomEvent<string>).detail === projectId) setRevision(value => value + 1);
    }
    window.addEventListener(NOTE_PAGES_CHANGED, changed);
    return () => window.removeEventListener(NOTE_PAGES_CHANGED, changed);
  }, [projectId]);
  return revision;
}
