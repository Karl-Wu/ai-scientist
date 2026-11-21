"use client";

/**
 * Provenance client. Answers "where did this file come from?" for one
 * sandbox-relative path, project-scoped (apiFetch injects X-Project-Id).
 *
 * The server derives all of this by observing the agent's tool calls, so
 * `confidence` on an edge is meaningful and must be surfaced, not flattened —
 * an inferred edge is a lead, not a fact.
 */
import { apiFetch } from "@/lib/projects";

export type EdgeConfidence = "observed" | "inferred" | "declared";

export type ArtifactChange =
  | "created"
  | "modified"
  | "deleted"
  | "read"
  | "unchanged"
  /** Written, but created-vs-modified unknown (no before-state was observed). */
  | "wrote";

export type Staleness = "current" | "stale" | "unknown";

/**
 * When the recorded size/hash was measured. `write` (the default) means right
 * after the producing call, so the hash is what that step produced. `harvest`
 * means later, when a subagent's session file was parsed — so the bytes may
 * already have changed, and staleness will not report "current" from it.
 */
export type IdentityTiming = "write" | "harvest";

/** Why a step's file attribution is less complete than usual. */
export type DegradeReason = "sandbox-too-large" | "scan-failed" | "no-scan-baseline";

export interface ArtifactRef {
  path: string;
  sha256?: string;
  size: number;
  mtimeMs: number;
  change: ArtifactChange;
  confidence: EdgeConfidence;
  via?: "sandbox-scan";
  identityAt?: IdentityTiming;
  hashSkipped?: "too-large" | "unreadable";
}

/**
 * Who performed a step: the lead agent (observed live), a subagent
 * (reconstructed from its session file), the user through the sandbox file API
 * (upload / save / move / delete, recorded server-side), or a remote Modal job
 * (identities from the transfer layer's own hashes).
 */
export type StepRole = "agent" | "subagent" | "user" | "compute";

export interface ComputeInfo {
  provider: "modal";
  jobId: string;
  state: string;
  instance?: string;
  gpu?: string | null;
  environment?: string;
  image?: { base?: string; pip?: string[]; apt?: string[] };
  sandboxId?: string;
  exitCode?: number;
  missingOutputs?: string[];
  submittedBy?: "lead" | "subagent" | "api";
}

export interface ProvenanceStep {
  schemaVersion: number;
  id: string;
  sessionId: string;
  runId?: string;
  startedAt?: number;
  timestamp: number;
  toolName: string;
  args?: unknown;
  isError?: boolean;
  model?: string;
  role: StepRole;
  agentName?: string;
  inputs: ArtifactRef[];
  outputs: ArtifactRef[];
  degraded?: DegradeReason;
  truncatedEdges?: number;
  /** Environment snapshot in effect when the step ran (see `environments`). */
  environmentId?: string;
  /** The environment was captured at harvest time, not when the step ran. */
  environmentAt?: "harvest";
  compute?: ComputeInfo;
}

export interface PackageVersion {
  name: string;
  version: string;
}

export interface EnvironmentSnapshot {
  schemaVersion: number;
  id: string;
  capturedAt: number;
  os: { platform: string; release: string; arch: string };
  python?: {
    version?: string;
    source: "venv" | "system";
    packages: PackageVersion[];
    packagesTruncated?: number;
  };
  r?: { version: string; packages: PackageVersion[]; packagesTruncated?: number };
  lockfiles: Array<{ path: string; sha256: string }>;
  git?: { head: string };
  tools?: { uv?: string };
}

export type LineageRoot = "upload" | "user" | "unrecorded" | "budget";

export interface LineageNode {
  path: string;
  depth: number;
  /** Producer of the VERSION consumed downstream; absent for an unrecorded root. */
  stepId?: string;
  root?: LineageRoot;
  current: { sha256?: string; size: number; mtimeMs: number } | null;
  /** Disk bytes differ from the version the downstream step consumed. */
  changedSinceUse?: boolean | null;
}

export interface LineageEdge {
  from: string;
  to: string;
  stepId: string;
  confidence: EdgeConfidence;
}

export interface Lineage {
  nodes: LineageNode[];
  edges: LineageEdge[];
  steps: Record<string, ProvenanceStep>;
  truncated: boolean;
}

export interface NotebookCitation {
  id: string;
  sessionId: string;
  type: "hypothesis" | "method" | "observation" | "decision" | "note";
  title: string;
  timestamp: number;
  role: string;
  runId?: string;
  precedesLatestOutput: boolean;
}

export interface ArtifactProvenance {
  path: string;
  exists: boolean;
  current: { sha256?: string; size: number; mtimeMs: number } | null;
  producedBy: ProvenanceStep[];
  readBy: ProvenanceStep[];
  readByTotal: number;
  citedBy: NotebookCitation[];
  staleness: Staleness;
  lineage: Lineage;
  environments: Record<string, EnvironmentSnapshot>;
}

export async function getArtifactProvenance(
  path: string,
  projectId?: string,
): Promise<ArtifactProvenance> {
  const res = await apiFetch(
    `/sandbox/provenance?path=${encodeURIComponent(path)}`,
    {},
    projectId,
  );
  if (!res.ok) {
    const data = (await res.json().catch(() => null)) as { detail?: string } | null;
    throw new Error(data?.detail || `getArtifactProvenance ${res.status}`);
  }
  return (await res.json()) as ArtifactProvenance;
}

export interface SourceStepReference {
  sessionId: string;
  stepId: string;
  runId?: string;
}

export type SourceEvidence = "recorded" | "scan" | "scan-inferred" | "inferred" | "harvest" | "declared";

export interface FileSourceStep extends SourceStepReference {
  toolName: string;
  role: StepRole;
  timestamp: number;
  change: ArtifactChange;
  evidence: SourceEvidence;
  inputs: { path: string; confidence: EdgeConfidence }[];
  outputs: { path: string; evidence: SourceEvidence }[];
}

export interface FileOrigin {
  status: "matched" | "edited" | "historical" | "changed" | "unknown" | "unrecorded";
  changedSinceUse: boolean | null;
  inputConfidence?: EdgeConfidence;
  source?: FileSourceStep;
  lastKnown?: FileSourceStep;
  history: FileSourceStep[];
}

export interface FileSourceFocus {
  step: FileSourceStep;
  nonce: number;
}

export const SOURCE_EVIDENCE_LABELS: Record<SourceEvidence, string> = {
  recorded: "Recorded association",
  scan: "Detected by sandbox scan",
  "scan-inferred": "Inferred from sandbox scan",
  inferred: "Inferred association",
  harvest: "Collected after execution",
  declared: "Declared association",
};

export async function getFileOrigin(path: string, projectId: string, consumer?: SourceStepReference, signal?: AbortSignal) {
  const query = new URLSearchParams({ path });
  if (consumer) {
    query.set("sessionId", consumer.sessionId);
    query.set("stepId", consumer.stepId);
    if (consumer.runId) query.set("runId", consumer.runId);
  }
  const response = await apiFetch(`/sandbox/file-origin?${query}`, { signal }, projectId);
  if (!response.ok) throw new Error("File source lookup failed");
  return (await response.json()) as FileOrigin;
}
