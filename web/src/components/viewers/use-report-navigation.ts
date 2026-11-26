import { useEffect, useRef, useState } from "react";
import { apiFetch } from "@/lib/projects";

const root = "https://project.invalid/";
const fileAddress = (path: string) => "/" + path.split("/").map(encodeURIComponent).join("/");

export function useReportNavigation(path: string, projectId: string | undefined, content: string | null) {
  const initial = fileAddress(path);
  const [history, setHistory] = useState({ entries: [initial], index: 0 });
  const current = history.entries[history.index];
  const [address, setAddress] = useState(current);
  const [document, setDocument] = useState({ path, body: content, revision: 0 });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const frame = useRef<HTMLIFrameElement>(null);
  const pending = useRef<AbortController | null>(null);
  useEffect(() => () => pending.current?.abort(), []);

  async function navigate(input: string, index?: number, refresh = false) {
    pending.current?.abort();
    setBusy(false);
    setError("");
    let url: URL;
    let nextPath: string;
    try {
      url = new URL(input, new URL(current, root));
      nextPath = decodeURIComponent(url.pathname.slice(1));
      if (!input.trim() || url.origin !== new URL(root).origin || url.username || url.password ||
          !/\.html?$/i.test(nextPath) || /[\\\x00]/.test(nextPath) ||
          nextPath.split("/").some(part => part === ".." || part === ".")) throw new Error();
    } catch {
      setError("Enter a project HTML file path.");
      return;
    }
    const next = url.pathname + url.search + url.hash;
    if (refresh || nextPath !== document.path || new URL(current, root).search !== url.search) {
      const controller = new AbortController();
      pending.current = controller;
      setBusy(true);
      try {
        const response = await apiFetch("/sandbox/file?" + new URLSearchParams({ path: nextPath }), {
          signal: controller.signal, cache: "no-store",
        }, projectId);
        if (!response.ok || response.headers.has("X-Project-Fallback")) throw new Error();
        const body = await response.text();
        if (controller.signal.aborted) return;
        setDocument(previous => ({ path: nextPath, body, revision: previous.revision + 1 }));
      } catch {
        if (!controller.signal.aborted) setError("Could not load file");
        return;
      } finally {
        if (!controller.signal.aborted) setBusy(false);
      }
    } else {
      frame.current?.contentWindow?.frames[0]?.postMessage({ kind: "report-location", value: url.hash }, "*");
    }
    setAddress(next);
    setHistory(previous => {
      if (index !== undefined) return { ...previous, index };
      if (previous.entries[previous.index] === next) return previous;
      return { entries: [...previous.entries.slice(0, previous.index + 1), next], index: previous.index + 1 };
    });
  }

  useEffect(() => {
    function receive(event: MessageEvent) {
      const inner = frame.current?.contentWindow?.frames[0];
      if (!inner || event.source !== inner || typeof event.data?.value !== "string") return;
      const { kind, value } = event.data;
      if (kind === "report-ready") {
        inner.postMessage({ kind: "report-location", value: new URL(current, root).hash }, "*");
      } else if (kind === "report-link") {
        void navigate(value);
      } else if (kind === "report-hash" && (!value || value.startsWith("#")) && value !== new URL(current, root).hash) {
        void navigate(current.split("#")[0] + value);
      }
    }
    window.addEventListener("message", receive);
    return () => window.removeEventListener("message", receive);
  });
  return { history, current, address, setAddress, document, error, busy, navigate, frame };
}
