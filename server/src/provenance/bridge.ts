/**
 * Wiring so SUBAGENT work lands in the parent's provenance log.
 *
 * On subagent completion (synchronous `tool_result` or asynchronous
 * `subagent:async-complete`), the parent parses each child's session file into
 * steps and appends them to its own log.
 *
 * This requires no tool inside the child. The child's own session file is the record,
 * and it exists whether or not the child knows it is being observed. That is the
 * point — provenance the agent cannot author.
 */
import fs from "node:fs";
import type { ExtensionFactory } from "@earendil-works/pi-coding-agent";
import { boundedSetAdd } from "../bounded.ts";
import { currentRunId } from "../agent/run-ids.ts";
import { resolvePaths } from "../projects.ts";
import { captureAndStoreEnvironment } from "./environment.ts";
import { inferOutputs, provenanceStepsFromSessionFile } from "./harvest.ts";
import { scanSandbox } from "./scanner.ts";
import { appendNewSteps, readSteps, type ProvenanceStep } from "./store.ts";

// Step ids already harvested, so a re-delivered async completion (broadcast to
// every live session's listener) cannot double-append. Fast path only — empty
// after a restart, so the durable guard is the log itself (appendNewSteps).
const harvestedIds = new Set<string>();
const MAX_HARVESTED_IDS = 10_000;

/** Result shape consumed from both the sync and async completion payloads. */
interface ChildResult {
  agent?: string;
  sessionFile?: string;
  model?: string;
}

export function makeSubagentProvenanceExtension(
  projectId: string,
  getSessionId: () => string,
  onError?: (err: unknown) => void,
): ExtensionFactory {
  const harvest = async (results: ChildResult[] | undefined): Promise<void> => {
    const parentSessionId = getSessionId();
    if (!parentSessionId || !results?.length) return;
    const sandboxRoot = resolvePaths(projectId).sandbox;
    // Same attribution caveat as the notebook harvest: an async child that
    // finishes during a LATER run of this session is stamped with that run's id,
    // because the completion payload carries no correlation (see run-ids.ts).
    const runId = currentRunId(projectId, parentSessionId);

    // Paths any recorded step already accounts for — the filter that stops
    // mtime-window inference from re-attributing the lead's own writes.
    const claimedPaths = new Set(
      readSteps(parentSessionId, projectId).flatMap((step) =>
        step.outputs.map((ref) => ref.path),
      ),
    );

    let candidates: Array<{ path: string; mtimeMs: number }> | null = null;
    // One environment capture per completion batch. It describes the sandbox
    // NOW, not when the child ran, so steps carry `environmentAt: "harvest"`.
    let environmentId: string | undefined | null = null;

    for (const result of results) {
      if (!result.agent || !result.sessionFile) continue;
      let content: string;
      try {
        content = fs.readFileSync(result.sessionFile, "utf-8");
      } catch {
        continue; // child session file gone or unreadable
      }

      const { steps, window } = provenanceStepsFromSessionFile(content, result.agent, {
        parentSessionId,
        sandboxRoot,
        ...(result.model ? { model: result.model } : {}),
        ...(runId ? { runId } : {}),
      });
      if (steps.length === 0) continue;

      // One scan serves every child in this completion batch.
      if (candidates === null) {
        const scan = await scanSandbox(sandboxRoot);
        candidates = scan.degraded
          ? [] // an incomplete snapshot must not drive attribution
          : [...scan.snapshot].map(([p, stat]) => ({ path: p, mtimeMs: stat.mtimeMs }));
      }
      if (environmentId === null) {
        try {
          environmentId = await captureAndStoreEnvironment(sandboxRoot, projectId);
        } catch (err) {
          onError?.(err);
          environmentId = undefined;
        }
      }
      const enriched = inferOutputs(steps, candidates, window, claimedPaths, sandboxRoot).map(
        (step) =>
          environmentId ? { ...step, environmentId, environmentAt: "harvest" as const } : step,
      );

      const fresh: ProvenanceStep[] = [];
      for (const step of enriched) {
        const dedupKey = `${result.sessionFile}:${step.id}`;
        if (harvestedIds.has(dedupKey)) continue;
        boundedSetAdd(harvestedIds, dedupKey, MAX_HARVESTED_IDS);
        fresh.push(step);
      }
      appendNewSteps(parentSessionId, fresh, projectId);
      // Later children in this batch must not re-claim what this one just took.
      for (const step of enriched) {
        for (const ref of step.outputs) claimedPaths.add(ref.path);
      }
    }
  };

  const safeHarvest = (results: ChildResult[] | undefined): void => {
    // Provenance must never break a run, and neither completion hook wants to
    // wait on a sandbox scan.
    void harvest(results).catch((err) => onError?.(err));
  };

  return (pi) => {
    pi.on("tool_result", async (event) => {
      if (event.toolName !== "subagent") return;
      const details = event.details as { results?: ChildResult[] } | undefined;
      safeHarvest(details?.results);
    });
    pi.events.on("subagent:async-complete", (data: unknown) => {
      const payload = data as { results?: ChildResult[] };
      safeHarvest(payload.results);
    });
  };
}
