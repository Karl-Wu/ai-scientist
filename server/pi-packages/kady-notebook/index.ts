/** Expose read-only notebook search in child Pi sessions. */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { notebookSearchTool } from "./memory-tool.ts";
import { callMemoryApi } from "./memory-client.ts";

export default function (pi: ExtensionAPI): void {
  if (!process.env.PI_SUBAGENT_CHILD) return;
  registerChildNotebook(pi);
}
export function registerChildNotebook(pi: ExtensionAPI): void {
  pi.registerTool(notebookSearchTool(callMemoryApi));
}
