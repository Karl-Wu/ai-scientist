import { Type } from "typebox";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { NOTE_PAGE_ID } from "../../../web/src/lib/note-pages.ts";
import { SandboxError } from "../sandbox-fs.ts";
import { readNoteRevision } from "./store.ts";

const parameters = Type.Object({
  id: Type.String({ pattern: NOTE_PAGE_ID.source, description: "The selected note page ID." }),
  version: Type.Integer({ minimum: 1, description: "The exact selected revision number." }),
}, { additionalProperties: false });

export function makeNoteReadTool(projectId: string): ToolDefinition<typeof parameters> {
  return {
    name: "note_read",
    label: "Read note page",
    description: "Read a referenced note page revision in this project. Returns its summary, structured fields, review status, and source references.",
    parameters,
    execute: async (_callId, { id, version }) => {
      try {
        const note = readNoteRevision(projectId, id, version);
        return {
          content: [{ type: "text", text: JSON.stringify(note, null, 2) }],
          details: { id, version, found: true },
        };
      } catch (error) {
        if (!(error instanceof SandboxError) || error.statusCode !== 404) throw error;
        return {
          content: [{ type: "text", text: "This note page or revision is unavailable in the current project." }],
          details: { id, version, found: false },
        };
      }
    },
  };
}
