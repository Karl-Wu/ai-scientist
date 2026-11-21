import { resolvePaths } from "../projects.ts";
import { apiRelative, isUserVisible, safePath, SandboxError } from "../sandbox-fs.ts";
import { DECLARED_WRITE_TOOLS } from "./recorder.ts";
import { findProjectSteps, identifyAsync, type ArtifactRef, type ProvenanceStep } from "./store.ts";

export interface StepReference {
  sessionId: string;
  stepId: string;
  runId?: string;
}

type OriginEvidence = "recorded" | "scan" | "scan-inferred" | "inferred" | "harvest" | "declared";
type OriginStatus = "matched" | "edited" | "historical" | "changed" | "unknown" | "unrecorded";
type OriginWrite = { step: ProvenanceStep; ref: ArtifactRef };

function refersToStep(step: ProvenanceStep, reference: StepReference): boolean {
  return step.sessionId === reference.sessionId && step.id === reference.stepId &&
    (!reference.runId || step.runId === reference.runId);
}

function evidence(step: ProvenanceStep, ref: ArtifactRef): OriginEvidence {
  if (ref.identityAt === "harvest") return "harvest";
  // Rows written before `via` was added used this same recorder branching.
  const fromScan = ref.via === "sandbox-scan" ||
    (step.role === "agent" && (step.isError || !DECLARED_WRITE_TOOLS.has(step.toolName)));
  if (fromScan) return ref.confidence === "inferred" ? "scan-inferred" : "scan";
  return ref.confidence === "observed" ? "recorded" : ref.confidence;
}

function summarize({ step, ref }: OriginWrite) {
  return {
    sessionId: step.sessionId,
    stepId: step.id,
    runId: step.runId,
    toolName: step.toolName,
    role: step.role,
    timestamp: step.timestamp,
    change: ref.change,
    evidence: evidence(step, ref),
    inputs: step.inputs.map(({ path, confidence }) => ({ path, confidence })),
    outputs: step.outputs.filter((output) => output.change !== "deleted")
      .map((output) => ({ path: output.path, evidence: evidence(step, output) })),
  };
}

function matchesVersion(write: OriginWrite, sha256: string | undefined): boolean {
  return Boolean(sha256 && write.ref.sha256 === sha256 && write.ref.change !== "deleted" &&
    write.ref.identityAt !== "harvest");
}

function isEditorSave(write: OriginWrite): boolean {
  return write.step.role === "user" && write.step.toolName === "save" && write.ref.change === "modified";
}

function editorInput(write: OriginWrite): ArtifactRef | undefined {
  return write.step.inputs.find((input) => input.path === write.ref.path);
}

function followEditorSaves(writes: OriginWrite[]): OriginWrite | undefined {
  let version = writes[0];
  for (let index = 0; version && isEditorSave(version); index++) {
    const previous = writes[index + 1];
    // A conflicting or unrecorded write breaks the chain. Matching an older
    // checksum elsewhere in history would not identify the overwritten version.
    if (!previous || previous.step.timestamp >= version.step.timestamp ||
        writes[index + 2]?.step.timestamp === previous.step.timestamp ||
        !matchesVersion(previous, editorInput(version)?.sha256)) return undefined;
    version = previous;
  }
  return version;
}

export async function fileOrigin(projectId: string, path: string, consumer?: StepReference) {
  const sandbox = resolvePaths(projectId).sandbox;
  const abs = safePath(path, sandbox);
  if (abs === sandbox || !isUserVisible(abs, sandbox)) throw new SandboxError(403, "File is not user-visible");
  const rel = apiRelative(sandbox, abs);
  const [current, steps] = await Promise.all([
    identifyAsync(abs),
    findProjectSteps(projectId, (step) =>
      step.outputs.some((ref) => ref.path === rel) || Boolean(consumer && refersToStep(step, consumer))),
  ]);
  const consumers = consumer ? steps.filter((step) => refersToStep(step, consumer)) : [];
  const readStep = consumers.length === 1 ? consumers[0] : undefined;
  const input = readStep?.inputs.find((ref) => ref.path === rel);
  const before = readStep ? (readStep.startedAt ?? readStep.timestamp) : undefined;
  const writes = steps.flatMap((step) => {
    // Exclude the consumer's own writes, but keep other writes tied with its
    // start time so an older version is not accidentally reported as certain.
    if (consumer && (!input || before === undefined || step === readStep || step.timestamp > before)) return [];
    const ref = step.outputs.find((ref) => ref.path === rel && ref.change !== "read");
    return ref ? [{ step, ref }] : [];
  });
  const latest = writes[0];
  const ambiguous = latest && (writes[1]?.step.timestamp === latest.step.timestamp ||
    (consumer && latest.step.timestamp === before));
  let status: OriginStatus = "unrecorded";
  let source: OriginWrite | undefined;
  let changedSinceUse: boolean | null = null;
  if (consumer) {
    if (input?.sha256 && current?.sha256) changedSinceUse = current.sha256 !== input.sha256;
    status = "unknown";
    if (latest && !ambiguous && input?.identityAt !== "harvest" && matchesVersion(latest, input?.sha256)) {
      source = followEditorSaves(writes);
      if (source) status = "historical";
    }
  } else if (latest) {
    status = "unknown";
    if (!ambiguous && matchesVersion(latest, current?.sha256)) {
      source = followEditorSaves(writes);
      const precedingHash = source?.ref.sha256 ?? editorInput(latest)?.sha256;
      if (!isEditorSave(latest) || precedingHash) {
        status = isEditorSave(latest) && precedingHash !== current?.sha256 ? "edited" : "matched";
      }
    } else if (!ambiguous && current && (latest.ref.change === "deleted" ||
        (current.sha256 && latest.ref.sha256 && current.sha256 !== latest.ref.sha256))) {
      status = "changed";
    }
  }
  const previous = !ambiguous ? writes.find((write) => write.ref.change !== "deleted") : undefined;
  return {
    status,
    changedSinceUse,
    inputConfidence: input?.confidence,
    source: source && summarize(source),
    lastKnown: !source && !consumer && previous ? summarize(previous) : undefined,
    history: writes.slice(0, 12).map(summarize),
  };
}
