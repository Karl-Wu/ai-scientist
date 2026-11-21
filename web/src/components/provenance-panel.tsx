"use client";

/**
 * Lineage view for one sandbox artifact: what produced it, from which inputs,
 * in which run, by which model — plus the notebook entries that cite it.
 *
 * Three things this deliberately refuses to smooth over, because all are real
 * scientific hazards the rest of the app cannot see:
 *   - a `stale` artifact, whose bytes changed after the step that produced it
 *   - a citation written before the artifact's latest version, so the entry
 *     describes something other than what is on disk now
 *   - an upstream input that changed since it was consumed, so the artifact
 *     cannot be regenerated from what is on disk now
 */
import { cn } from "@/lib/utils";
import { useLocale, useT } from "@/components/i18n-provider";
import type { Locale } from "@/lib/i18n";
import type { Translate } from "@/lib/translations";
import {
  getArtifactProvenance,
  type ArtifactProvenance,
  type ArtifactRef,
  type EdgeConfidence,
  type EnvironmentSnapshot,
  type Lineage,
  type LineageNode,
  type ProvenanceStep,
  type SourceStepReference,
} from "@/lib/provenance";
import {
  AlertTriangleIcon,
  ArrowRightIcon,
  BotIcon,
  CircleHelpIcon,
  CpuIcon,
  FileInputIcon,
  FileOutputIcon,
  PackageIcon,
  RefreshCcwIcon,
  ShieldCheckIcon,
  UploadIcon,
  UserIcon,
  WrenchIcon,
} from "lucide-react";
import { useCallback, useEffect, useState, type ReactNode } from "react";

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function formatWhen(ms: number, locale: Locale): string {
  return new Date(ms).toLocaleString(locale, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

const CONFIDENCE_COPY: Record<EdgeConfidence, { label: string; title: string }> = {
  observed: {
    label: "observed",
    title: "The tool named this file and its bytes were hashed afterward.",
  },
  inferred: {
    label: "inferred",
    title:
      "Attributed from evidence rather than direct observation: either a sandbox scan that could not be split between neighbouring steps, or a file the command line named that existed beforehand — a probable input, not a verified one.",
  },
  declared: {
    label: "declared",
    title: "The model asserted this link and nothing verified it.",
  },
};

function ConfidenceBadge({ confidence }: { confidence: EdgeConfidence }) {
  const t = useT();
  const copy = CONFIDENCE_COPY[confidence];
  return (
    <span
      title={t(copy.title)}
      className={cn(
        "shrink-0 rounded px-1 py-0.5 text-[9px] font-medium uppercase tracking-wider",
        confidence === "observed" && "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
        confidence === "inferred" && "bg-amber-500/10 text-amber-600 dark:text-amber-400",
        confidence === "declared" && "bg-muted text-muted-foreground",
      )}
    >
      {t(copy.label)}
    </span>
  );
}

function shortHash(sha?: string): string | null {
  return sha ? sha.slice(0, 12) : null;
}

function ArtifactRow({
  ref_,
  onOpenFile,
}: {
  ref_: ArtifactRef;
  onOpenFile?: (path: string) => void;
}) {
  const t = useT();
  const hash = shortHash(ref_.sha256);
  return (
    <li className="flex items-baseline gap-1.5 py-0.5">
      <button
        type="button"
        disabled={!onOpenFile || ref_.change === "deleted"}
        onClick={() => onOpenFile?.(ref_.path)}
        className={cn(
          "truncate font-mono text-[11px]",
          onOpenFile && ref_.change !== "deleted"
            ? "text-foreground/80 underline-offset-2 hover:underline"
            : "text-foreground/60",
          ref_.change === "deleted" && "line-through",
        )}
        title={ref_.path}
      >
        {ref_.path}
      </button>
      <span className="shrink-0 text-[10px] text-muted-foreground">
        {ref_.change === "deleted" ? t("deleted") : formatBytes(ref_.size)}
      </span>
      {hash && (
        <span
          className="shrink-0 font-mono text-[10px] text-muted-foreground/70"
          title={`sha256:${ref_.sha256}`}
        >
          {hash}
        </span>
      )}
      {ref_.identityAt === "harvest" && (
        <span
          className="shrink-0 text-[10px] text-muted-foreground"
          title={t("Hashed when the subagent's record was parsed, not when the step wrote the file — the bytes may already have changed by then.")}
        >
          {t("hashed later")}
        </span>
      )}
      {ref_.hashSkipped && (
        <span
          className="shrink-0 text-[10px] text-amber-600 dark:text-amber-400"
          title={t(
            ref_.hashSkipped === "too-large"
              ? "Not hashed: above the size limit. Identity is size+mtime only."
              : "Not hashed: the file could not be read.",
          )}
        >
          {t("unhashed")}
        </span>
      )}
      <ConfidenceBadge confidence={ref_.confidence} />
    </li>
  );
}

/** Who did it, in words a reader can act on. */
function actorLabel(step: ProvenanceStep, t: Translate): string {
  switch (step.role) {
    case "subagent":
      return step.agentName ? t("subagent: {name}", { name: step.agentName }) : t("subagent");
    case "user":
      return t(step.toolName === "upload"
        ? "uploaded by you"
        : step.toolName === "save"
          ? "saved by you in the editor"
          : step.toolName === "move"
            ? "moved by you"
            : step.toolName === "delete"
              ? "deleted by you"
              : "you");
    case "compute":
      return t("remote compute");
    default:
      return t("lead agent");
  }
}

function ActorIcon({ step, className }: { step: ProvenanceStep; className?: string }) {
  if (step.role === "user") {
    return step.toolName === "upload" ? (
      <UploadIcon className={className} />
    ) : (
      <UserIcon className={className} />
    );
  }
  if (step.role === "compute") return <CpuIcon className={className} />;
  return <WrenchIcon className={className} />;
}

function shortId(id: string): string {
  return id.slice(0, 8);
}

/** One-line environment summary plus an expandable package list. */
function EnvironmentLine({
  env,
  atHarvest,
}: {
  env: EnvironmentSnapshot;
  atHarvest?: boolean;
}) {
  const t = useT();
  const parts: string[] = [];
  if (env.python) {
    parts.push(
      `Python ${env.python.version ?? "?"}${env.python.source === "system" ? ` ${t("(system)")}` : ""}` +
        (env.python.packages.length ? ` · ${t("{count} packages", { count: env.python.packages.length })}` : ""),
    );
  }
  if (env.r) parts.push(`${env.r.version} · ${t("{count} packages", { count: env.r.packages.length })}`);
  for (const lock of env.lockfiles) parts.push(`${lock.path} ${lock.sha256.slice(0, 8)}`);
  if (env.git) parts.push(`git ${env.git.head.slice(0, 8)}`);
  if (parts.length === 0) parts.push(`${env.os.platform} ${env.os.arch}`);
  const hasPackages = (env.python?.packages.length ?? 0) + (env.r?.packages.length ?? 0) > 0;
  return (
    <details className="mt-1.5">
      <summary
        className="flex cursor-pointer items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground"
        title={t("Environment {id}", { id: env.id })}
      >
        <PackageIcon className="size-2.5 shrink-0" />
        <span className="truncate">{parts.join(" · ")}</span>
        {atHarvest && (
          <span
            className="shrink-0 text-muted-foreground/70"
            title={t("Captured when the subagent's record was parsed, not when the step ran — the subagent may have changed the environment in between.")}
          >
            {t("(captured later)")}
          </span>
        )}
      </summary>
      <div className="mt-1 rounded bg-muted/50 p-1.5 font-mono text-[10px] leading-relaxed">
        <p>
          {env.os.platform} {env.os.release} {env.os.arch}
          {env.tools?.uv ? ` · uv ${env.tools.uv}` : ""}
        </p>
        {env.git && <p>git HEAD {env.git.head}</p>}
        {env.lockfiles.map((lock) => (
          <p key={lock.path} className="truncate" title={`sha256:${lock.sha256}`}>
            {lock.path} sha256:{lock.sha256.slice(0, 16)}
          </p>
        ))}
        {hasPackages && (
          <div className="mt-1 max-h-48 overflow-auto">
            {env.python?.packages.map((pkg) => (
              <p key={`py-${pkg.name}`}>
                {pkg.name}=={pkg.version}
              </p>
            ))}
            {env.python?.packagesTruncated ? (
              <p className="text-muted-foreground">
                {t("+ {count} more Python packages not recorded", { count: env.python.packagesTruncated })}
              </p>
            ) : null}
            {env.r?.packages.map((pkg) => (
              <p key={`r-${pkg.name}`}>
                R: {pkg.name} {pkg.version}
              </p>
            ))}
            {env.r?.packagesTruncated ? (
              <p className="text-muted-foreground">
                {t("+ {count} more R packages not recorded", { count: env.r.packagesTruncated })}
              </p>
            ) : null}
          </div>
        )}
      </div>
    </details>
  );
}

function StepCard({
  step,
  target,
  environment,
  onOpenFile,
  onOpenInput,
}: {
  step: ProvenanceStep;
  target: string;
  environment?: EnvironmentSnapshot;
  onOpenFile?: (path: string) => void;
  onOpenInput?: (path: string, step: ProvenanceStep) => void;
}) {
  const t = useT();
  const locale = useLocale();
  const outputRef = step.outputs.find((o) => o.path === target);
  const otherOutputs = step.outputs.filter((o) => o.path !== target);
  return (
    <div className="rounded-md border bg-card/40 p-2.5">
      <div className="flex items-center gap-1.5">
        <ActorIcon step={step} className="size-3 shrink-0 text-muted-foreground" />
        <span className="font-mono text-xs font-medium">{step.toolName}</span>
        {step.isError && (
          <span className="rounded bg-destructive/10 px-1 py-0.5 text-[9px] font-medium uppercase tracking-wider text-destructive">
            {t("Error")}
          </span>
        )}
        {outputRef && <ConfidenceBadge confidence={outputRef.confidence} />}
        {/* The target's own ref is summarised by the badge above rather than
            rendered as an ArtifactRow, so its timing marker has to live here or
            the card silently implies a write-time hash it does not have. */}
        {outputRef?.identityAt === "harvest" && (
          <span
            className="shrink-0 text-[10px] text-muted-foreground"
            title={t("This step ran inside a subagent, so the file was hashed when its record was parsed rather than when the step wrote it.")}
          >
            {t("hashed later")}
          </span>
        )}
        <span className="ml-auto shrink-0 text-[10px] text-muted-foreground">
          {formatWhen(step.timestamp, locale)}
        </span>
      </div>

      <div className="mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[10px] text-muted-foreground">
        {step.model && (
          <span className="flex items-center gap-1">
            <BotIcon className="size-2.5" />
            <span className="font-mono">{step.model}</span>
          </span>
        )}
        <span title={step.role === "subagent" ? step.agentName : undefined}>{actorLabel(step, t)}</span>
        {step.compute && (
          <span
            className="font-mono"
            title={[
              t("Modal job {id}", { id: step.compute.jobId }),
              step.compute.sandboxId && t("sandbox {id}", { id: step.compute.sandboxId }),
            ].filter(Boolean).join(" · ")}
          >
            {step.compute.instance ?? "modal"}
            {step.compute.gpu ? ` · ${step.compute.gpu}` : ""}
            {step.compute.environment ? ` · ${step.compute.environment}` : ""}
            {step.compute.exitCode !== undefined ? ` · ${t("exit {code}", { code: step.compute.exitCode })}` : ""}
            {` · ${t("job {id}", { id: shortId(step.compute.jobId) })}`}
          </span>
        )}
        {step.runId && (
          <span className="font-mono" title={t("run {id}", { id: step.runId })}>
            {t("run {id}", { id: shortId(step.runId.replace(/^run_/, "")) })}
          </span>
        )}
        {step.role !== "user" && (
          <span className="font-mono" title={t("session {id}", { id: step.sessionId })}>
            {t("session {id}", { id: shortId(step.sessionId) })}
          </span>
        )}
      </div>

      {step.compute?.missingOutputs?.length ? (
        <p className="mt-1.5 flex items-start gap-1 text-[10px] text-amber-600 dark:text-amber-400">
          <AlertTriangleIcon className="mt-px size-2.5 shrink-0" />
          {step.compute.missingOutputs.length === 1
            ? t("The remote job never produced {file}.", { file: step.compute.missingOutputs[0] })
            : t("The remote job never produced {count} requested outputs.", { count: step.compute.missingOutputs.length })}
        </p>
      ) : null}

      {environment && <EnvironmentLine env={environment} atHarvest={step.environmentAt === "harvest"} />}

      {step.degraded && (
        <p className="mt-1.5 flex items-start gap-1 text-[10px] text-amber-600 dark:text-amber-400">
          <AlertTriangleIcon className="mt-px size-2.5 shrink-0" />
          {t(step.degraded === "sandbox-too-large"
            ? "Sandbox exceeded the scan budget — file attribution for this step is incomplete."
            : step.degraded === "scan-failed"
              ? "The sandbox scan failed — file attribution for this step is incomplete."
              : "Ran inside a subagent and was reconstructed afterward, so this step's file effects could not be observed directly. Any files below are attributed by timing, not observation.")}
        </p>
      )}

      {step.inputs.length > 0 && (
        <div className="mt-2">
          <p className="flex items-center gap-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            <FileInputIcon className="size-2.5" /> {t("Inputs")}
          </p>
          <ul className="mt-0.5">
            {step.inputs.map((input) => (
              <ArtifactRow key={input.path} ref_={input}
                onOpenFile={onOpenInput ? (path) => onOpenInput(path, step) : onOpenFile} />
            ))}
          </ul>
        </div>
      )}

      {otherOutputs.length > 0 && (
        <div className="mt-2">
          <p className="flex items-center gap-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            <FileOutputIcon className="size-2.5" /> {t("Also wrote")}
          </p>
          <ul className="mt-0.5">
            {otherOutputs.map((output) => (
              <ArtifactRow key={output.path} ref_={output} onOpenFile={onOpenFile} />
            ))}
          </ul>
        </div>
      )}

      {step.truncatedEdges ? (
        <p className="mt-1.5 text-[10px] text-muted-foreground">
          {t(step.truncatedEdges === 1 ? "+ 1 more file not recorded (per-step limit)" :
            "+ {count} more files not recorded (per-step limit)", { count: step.truncatedEdges })}
        </p>
      ) : null}

      {step.args !== undefined && (
        <details className="mt-2">
          <summary className="cursor-pointer text-[10px] text-muted-foreground hover:text-foreground">
            {t("Arguments")}
          </summary>
          <pre className="mt-1 max-h-40 overflow-auto rounded bg-muted/50 p-1.5 font-mono text-[10px] leading-relaxed">
            {JSON.stringify(step.args, null, 2)}
          </pre>
        </details>
      )}
    </div>
  );
}

const ROOT_COPY: Record<NonNullable<LineageNode["root"]>, { label: string; title: string }> = {
  upload: { label: "uploaded", title: "You uploaded this file. This is where the chain starts." },
  user: {
    label: "created by you",
    title: "You created this file in the editor; nothing recorded fed into it.",
  },
  unrecorded: {
    label: "no recorded origin",
    title:
      "No recorded step produced the version that was used here. It predates provenance recording, arrived outside the sandbox API, or was written during a run whose attribution degraded.",
  },
  budget: {
    label: "walk stopped",
    title: "The upstream walk reached its depth limit here.",
  },
};

/**
 * Upstream tree: the artifact at the top, each input indented beneath the
 * step that consumed it, down to uploads or the edge of the record. A DAG can
 * reach the same input twice; it is expanded once and referenced after.
 */
function LineageTree({
  lineage,
  target,
  onOpenFile,
  onOpenInput,
}: {
  lineage: Lineage;
  target: string;
  onOpenFile?: (path: string) => void;
  onOpenInput?: (path: string, step: ProvenanceStep) => void;
}) {
  const t = useT();
  const locale = useLocale();
  const nodes = new Map(lineage.nodes.map((node) => [node.path, node]));
  const inputsOf = new Map<string, Lineage["edges"]>();
  for (const edge of lineage.edges) {
    const list = inputsOf.get(edge.to) ?? [];
    list.push(edge);
    inputsOf.set(edge.to, list);
  }
  const expanded = new Set<string>();

  const renderNode = (
    path: string,
    depth: number,
    via?: Lineage["edges"][number],
  ): ReactNode => {
    const node = nodes.get(path);
    const step = node?.stepId ? lineage.steps[node.stepId] : undefined;
    const consumer = via && lineage.steps[via.stepId];
    const open = consumer && onOpenInput ? () => onOpenInput(path, consumer) :
      onOpenFile && node?.current !== null ? () => onOpenFile(path) : undefined;
    const repeated = expanded.has(path);
    expanded.add(path);
    const inputs = repeated ? [] : (inputsOf.get(path) ?? []);
    return (
      <li key={`${depth}:${path}`} className="min-w-0">
        <div
          className="flex min-w-0 items-baseline gap-1.5 py-0.5"
          style={{ paddingLeft: `${depth * 14}px` }}
        >
          {depth > 0 && <span className="shrink-0 text-muted-foreground/60">└</span>}
          <button
            type="button"
            disabled={!open}
            onClick={open}
            className={cn(
              "truncate font-mono text-[11px]",
              open
                ? "text-foreground/80 underline-offset-2 hover:underline"
                : "text-foreground/60",
              node?.current === null && "line-through",
              depth === 0 && "font-medium",
            )}
            title={path}
          >
            {path}
          </button>
          {step && (
            <span
              className="shrink-0 truncate text-[10px] text-muted-foreground"
              title={`${step.toolName} · ${actorLabel(step, t)} · ${formatWhen(step.timestamp, locale)}`}
            >
              {step.role === "agent" || step.role === "subagent" ? `${step.toolName} · ` : ""}
              {actorLabel(step, t)}
            </span>
          )}
          {via && via.confidence !== "observed" && (
            <ConfidenceBadge confidence={via.confidence} />
          )}
          {node?.root && node.root !== "user" && node.root !== "upload" && (
            <span
              className="shrink-0 rounded bg-muted px-1 py-0.5 text-[9px] uppercase tracking-wider text-muted-foreground"
              title={t(ROOT_COPY[node.root].title)}
            >
              {t(ROOT_COPY[node.root].label)}
            </span>
          )}
          {node?.changedSinceUse === true && (
            <span
              className="flex shrink-0 items-center gap-0.5 text-[10px] text-amber-600 dark:text-amber-400"
              title={t("The bytes on disk differ from the version this step consumed. Whatever was built from it may not be reproducible from the current file.")}
            >
              <AlertTriangleIcon className="size-2.5" /> {t("changed since use")}
            </span>
          )}
          {repeated && (
            <span className="shrink-0 text-[10px] text-muted-foreground/70">{t("(shown above)")}</span>
          )}
        </div>
        {inputs.length > 0 && (
          <ul>
            {inputs.map((edge) => renderNode(edge.from, depth + 1, edge))}
          </ul>
        )}
      </li>
    );
  };

  return (
    <div>
      <ul>{renderNode(target, 0)}</ul>
      {lineage.truncated && (
        <p className="mt-1 text-[10px] text-muted-foreground">
          {t("Upstream walk stopped at its limit — the record continues beyond what is shown.")}
        </p>
      )}
    </div>
  );
}

const STALENESS_COPY = {
  current: {
    Icon: ShieldCheckIcon,
    className: "text-emerald-600 dark:text-emerald-400",
    text: "Current — the bytes on disk match what the producing step recorded.",
  },
  stale: {
    Icon: AlertTriangleIcon,
    className: "text-amber-600 dark:text-amber-400",
    text: "Stale — this file changed after the step that produced it. Anything citing it may describe a different version.",
  },
  unknown: {
    Icon: CircleHelpIcon,
    className: "text-muted-foreground",
    text: "Unverified — no recorded hash to compare against, so sameness could not be checked.",
  },
  /**
   * Also "unknown" on the wire, but for a different reason worth stating: the
   * bytes match a hash taken when the subagent's record was parsed rather than
   * when the step wrote the file, so this only rules out changes since then.
   */
  unknownRetrospective: {
    Icon: CircleHelpIcon,
    className: "text-muted-foreground",
    text: "Unchanged since this record was reconstructed — but the producing step ran inside a subagent and its bytes were never hashed at the time, so a match cannot confirm this is what it produced.",
  },
} as const;

export interface ProvenancePanelProps {
  path: string;
  projectId: string;
  embedded?: boolean;
  onOpenFile?: (path: string) => void;
  onOpenSourceInput?: (path: string, consumer: SourceStepReference) => void;
  /**
   * Jump to a notebook entry in the Lab Notebook view. The notebook view is
   * scoped to the active tab's session, so a citation from a different session
   * opens the notebook without focusing the entry.
   */
  onOpenNotebookEntry?: (entryId: string) => void;
}

export function ProvenancePanel({
  path,
  projectId,
  onOpenFile,
  onOpenSourceInput,
  onOpenNotebookEntry,
  embedded = false,
}: ProvenancePanelProps) {
  const t = useT();
  const locale = useLocale();
  const [data, setData] = useState<ArtifactProvenance | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    getArtifactProvenance(path, projectId)
      .then((result) => {
        if (!cancelled) setData(result);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [path, projectId]);

  useEffect(() => load(), [load]);

  if (loading && !data) {
    return (
      <div className={cn("flex items-center justify-center text-xs text-muted-foreground", embedded ? "p-6" : "h-full")}>
        {t("Loading provenance…")}
      </div>
    );
  }

  if (error) {
    return (
      <div className={cn("flex flex-col items-center justify-center gap-2 px-6 text-center", embedded ? "py-6" : "h-full")}>
        <AlertTriangleIcon className="size-5 text-muted-foreground/40" />
        <p role="alert" className="text-xs text-muted-foreground">{t("Could not load provenance.")}</p>
        <button
          onClick={load}
          className="flex items-center gap-1 rounded-md border px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <RefreshCcwIcon className="size-3" /> {t("Retry")}
        </button>
        <details className="text-xs text-muted-foreground">
          <summary className="cursor-pointer">{t("Error details")}</summary>
          <p>{error}</p>
        </details>
      </div>
    );
  }

  if (!data) return null;

  const openInput = onOpenSourceInput
    ? (path: string, step: ProvenanceStep) => onOpenSourceInput(path, {
        sessionId: step.sessionId,
        stepId: step.id,
        runId: step.runId,
      })
    : undefined;
  const hasHistory = data.producedBy.length > 0;
  // Distinguish "we have no hash" from "we have one, but it was taken too late
  // to certify anything" — both arrive as `unknown`.
  const latestRef = data.producedBy[0]?.outputs.find((o) => o.path === data.path);
  const staleness =
    data.staleness === "unknown" && latestRef?.identityAt === "harvest" && latestRef.sha256
      ? STALENESS_COPY.unknownRetrospective
      : STALENESS_COPY[data.staleness];

  return (
    <div className={cn("px-3 py-3", !embedded && "h-full overflow-auto")}>
      {/* Identity */}
      <div className="rounded-md border bg-card/40 p-2.5">
        <div className="flex items-center justify-between gap-2">
          <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            {t("This version")}
          </p>
          <button
            onClick={load}
            disabled={loading}
            className="flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
            title={t("Re-read from disk")}
          >
            <RefreshCcwIcon className={cn("size-2.5", loading && "animate-spin")} /> {t("Refresh")}
          </button>
        </div>
        {data.current ? (
          <div className="mt-1 space-y-0.5">
            <p className="font-mono text-[11px] text-foreground/80">
              sha256:{data.current.sha256 ?? "—"}
            </p>
            <p className="text-[10px] text-muted-foreground">
              {formatBytes(data.current.size)} · {t("modified {time}", { time: formatWhen(data.current.mtimeMs, locale) })}
            </p>
          </div>
        ) : (
          <p className="mt-1 text-[11px] text-muted-foreground">
            {t("This file no longer exists in the sandbox.")}
          </p>
        )}
        <p className={cn("mt-2 flex items-start gap-1 text-[10px]", staleness.className)}>
          <staleness.Icon className="mt-px size-2.5 shrink-0" />
          {t(staleness.text)}
        </p>
      </div>

      {/* Upstream lineage: only worth a section once there is more than the
          artifact itself in it. */}
      {data.lineage && data.lineage.edges.length > 0 && (
        <div className="mt-3">
          <p className="mb-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            {t("Lineage")}
          </p>
          <div data-testid="provenance-lineage" className="rounded-md border bg-card/40 px-2.5 py-2">
            <LineageTree lineage={data.lineage} target={data.path} onOpenFile={onOpenFile} onOpenInput={openInput} />
          </div>
        </div>
      )}

      {/* Producing steps */}
      <div className="mt-3">
        <p className="mb-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
          {hasHistory ? t("Produced by ({count})", { count: data.producedBy.length }) : t("Produced by")}
        </p>
        {hasHistory ? (
          <div className="space-y-2">
            {data.producedBy.map((step) => (
              <StepCard
                key={step.id}
                step={step}
                target={data.path}
                environment={
                  step.environmentId ? data.environments?.[step.environmentId] : undefined
                }
                onOpenFile={onOpenFile}
                onOpenInput={openInput}
              />
            ))}
          </div>
        ) : (
          <p className="rounded-md border border-dashed px-2.5 py-3 text-[11px] leading-relaxed text-muted-foreground">
            {t("No recorded provenance. Either this file predates provenance recording, it was uploaded rather than produced by the agent, or it was written during a run whose attribution degraded.")}
          </p>
        )}
      </div>

      {/* Notebook citations */}
      {data.citedBy.length > 0 && (
        <div className="mt-3">
          <p className="mb-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            {t("Cited in the notebook ({count})", { count: data.citedBy.length })}
          </p>
          <div className="space-y-1">
            {data.citedBy.map((citation) => (
              <button
                key={citation.id}
                type="button"
                disabled={!onOpenNotebookEntry}
                onClick={() => onOpenNotebookEntry?.(citation.id)}
                className={cn(
                  "flex w-full items-start gap-1.5 rounded-md border bg-card/40 px-2 py-1.5 text-left",
                  onOpenNotebookEntry && "hover:bg-muted/50",
                )}
              >
                <span className="mt-px shrink-0 rounded bg-muted px-1 py-0.5 text-[9px] font-medium uppercase tracking-wider text-muted-foreground">
                  {t(citation.type.charAt(0).toUpperCase() + citation.type.slice(1))}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[11px] text-foreground/90">
                    {citation.title}
                  </span>
                  <span className="mt-0.5 block text-[10px] text-muted-foreground">
                    {t(citation.role)} · {formatWhen(citation.timestamp, locale)}
                  </span>
                  {citation.precedesLatestOutput && (
                    <span className="mt-0.5 flex items-start gap-1 text-[10px] text-amber-600 dark:text-amber-400">
                      <AlertTriangleIcon className="mt-px size-2.5 shrink-0" />
                      {t("Written before the latest version of this file — the entry may describe different bytes.")}
                    </span>
                  )}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Downstream reads */}
      {data.readByTotal > 0 && (
        <div className="mt-3">
          <p className="mb-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            {t("Read by ({count})", { count: data.readByTotal })}
          </p>
          <ul className="space-y-0.5">
            {data.readBy.map((step) => (
              <li
                key={step.id}
                className="flex items-center gap-1.5 text-[11px] text-muted-foreground"
              >
                <ArrowRightIcon className="size-2.5 shrink-0" />
                <span className="font-mono">{step.toolName}</span>
                <span className="text-[10px]">{formatWhen(step.timestamp, locale)}</span>
              </li>
            ))}
          </ul>
          {data.readByTotal > data.readBy.length && (
            <p className="mt-1 text-[10px] text-muted-foreground">
              {t("+ {count} more", { count: data.readByTotal - data.readBy.length })}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
