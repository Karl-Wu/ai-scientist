export const NOTE_TYPES = {
  note: { group: null, label: "General note", fields: {} },
  hypothesis: { group: "Research", label: "Hypothesis", fields: { scope: "Scope", prediction: "Prediction" } },
  observation: { group: "Research", label: "Observation", fields: { scope: "Scope", finding: "Finding", limitations: "Limitations" } },
  decision: { group: "Research", label: "Decision", fields: { rationale: "Rationale", revisitWhen: "When to revisit" } },
  mappingRule: { group: "Data processing", label: "Mapping rule", fields: { sourceField: "Source field", targetField: "Target field", condition: "Conversion rule" } },
  qualityCheck: { group: "Data processing", label: "Quality check", fields: { check: "Check", finding: "Finding" } },
  processingDecision: { group: "Data processing", label: "Processing decision", fields: { rationale: "Rationale", affectedData: "Affected data" } },
} as const;

export type NoteType = keyof typeof NOTE_TYPES;
export const NOTE_PAGE_ID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;

type PdfAnnotationAnchor = { kind: "pdfAnnotation"; path: string; annotationId: string };

export type NoteSourceLink = { label: string } & (
  | { kind: "task"; sessionId: string }
  | { kind: "message"; sessionId: string; entryId: string }
  | { kind: "tool" | "result"; sessionId: string; toolCallId: string }
  | { kind: "file"; path: string; sessionId?: string; sha256?: string }
  | (PdfAnnotationAnchor & { page: number })
);

export type NoteRecordFlag = "truncated" | "redacted" | "unavailable";
export const NOTE_RECORD_FLAG_LABELS: Record<NoteRecordFlag, string> = {
  truncated: "Record truncated", redacted: "Record redacted", unavailable: "Record details unavailable",
};

export type NoteSource = NoteSourceLink & { excerpt: string; recordFlags?: NoteRecordFlag[] };
export type NoteCitation = NoteSource & { id: string };

export interface NoteDraftCredit {
  expert: string;
}

export type NoteAnchor =
  | { kind: "message"; sessionId: string; entryId: string }
  | { kind: "result"; sessionId: string; toolCallId: string }
  | { kind: "file"; path: string }
  | PdfAnnotationAnchor;

export type NoteCreationSource = {
  title: string;
  initialSummary?: string;
} & ({ anchor: NoteAnchor; task?: never } | { task: NoteTaskReference; anchor?: never });

export const NOTE_SOURCE_LABELS = {
  task: "Task",
  message: "Message",
  tool: "Tool result",
  result: "Scientific result",
  file: "File",
  pdfAnnotation: "PDF annotation",
} as const;

export interface NoteContent {
  title: string;
  summary: string;
  fields: Record<string, string>;
}

export interface NoteRevision extends NoteContent {
  version: number;
  savedAt: number;
  status: "saved" | "pending" | "reviewed";
  draftCredit?: NoteDraftCredit;
}

export const NOTE_STATUS_LABELS = {
  saved: "Saved",
  pending: "Pending review",
  reviewed: "Reviewed",
} satisfies Record<NoteRevision["status"], string>;

export interface NoteTaskReference {
  id: string;
  title: string;
}

export interface NoteDraftDetails {
  taskExcerptShortened: boolean;
  sourceExcerptShortened?: boolean;
  checks?: { kind: "source" | "table" | "skill"; detail: string }[];
  draftCredit?: NoteDraftCredit;
}

export interface NoteDraft extends NoteDraftDetails {
  title: string;
  summary: string;
}

export const MAX_NOTE_CANDIDATES = 8;

export interface NoteCandidate extends NoteContent {
  type: NoteType;
  requestId: string;
  sources?: NoteSource[];
  sourceProof?: string;
}

export interface NoteCandidateBatch extends NoteDraftDetails {
  candidates: NoteCandidate[];
  draftCredit: NoteDraftCredit;
  taskRecords?: {
    total: number;
    coverage: "recorded" | "legacy" | "incomplete";
    read: { id: string; label: string; partial: boolean; flags: NoteRecordFlag[] }[];
  };
}

export type NoteBatchResult =
  | { requestId: string; status: "saved"; page: NotePage }
  | { requestId: string; status: "failed"; code: number };

export interface NotePage {
  id: string;
  schemaVersion: 3;
  type: NoteType;
  typeVersion: 1;
  organizer: string;
  deletedAt?: number;
  sources: NoteCitation[];
  revisions: NoteRevision[];
}

export interface NoteSummary {
  id: string;
  type: NoteType;
  version: number;
  organizer: string;
  title: string;
  excerpt: string;
  savedAt: number;
  status: NoteRevision["status"];
  tasks: string[];
  draftExpert?: string;
  source?: NoteSourceLink;
  sourceCount: number;
}

export interface NoteListResult {
  pages: NoteSummary[];
  unavailableCount: number;
}

export function noteTypesIn(pages: readonly NoteSummary[] = []): NoteType[] {
  const present = new Set(pages.map((page) => page.type));
  return (Object.keys(NOTE_TYPES) as NoteType[]).filter((type) => present.has(type));
}
