import { assertModelAuthentication, modelReference, resolveModel } from "../agent/models.ts";
import { ONE_SHOT_REASONING } from "../agent/one-shot-reasoning.ts";
import { getModelRegistry, getModelRuntime } from "../agent/session-registry.ts";
import { billingCountsTowardBudget, billingForModel } from "../cost/billing.ts";
import { emptySnapshot, isBudgetExceeded, recordRun } from "../cost/ledger.ts";
import { SandboxError } from "../sandbox-fs.ts";
import { draftJson, NOTE_DRAFT_SESSION_ID } from "./draft.ts";

const OUTPUT_TOKENS = 8_000;

export async function openCurationModel(projectId: string, reference: string) {
  const runtime = getModelRuntime();
  let model;
  try { model = resolveModel(reference, getModelRegistry()); }
  catch { throw new SandboxError(422, "The selected expert model is unavailable."); }
  try { await assertModelAuthentication(model, runtime); }
  catch { throw new SandboxError(401, "Connect the selected model provider first"); }
  const billing = await billingForModel(model, runtime);
  // Use serialized bytes as a conservative bound even for non-English text and code.
  const batchBytes = Math.min(160_000, model.contextWindow - OUTPUT_TOKENS - 4_000);
  if (batchBytes < 4_000) throw new SandboxError(422, "The selected model has too little context for complete curation.");
  return {
    batchBytes,
    async request(systemPrompt: string, input: unknown, signal: AbortSignal): Promise<unknown> {
      signal.throwIfAborted();
      if (billingCountsTowardBudget(billing) && isBudgetExceeded(projectId).exceeded) {
        throw new SandboxError(402, "Project spend limit reached");
      }
      const lifetime = AbortSignal.any([signal, AbortSignal.timeout(180_000)]);
      const message = await runtime.completeSimple(model, {
        systemPrompt,
        messages: [{ role: "user", content: JSON.stringify(input), timestamp: Date.now() }],
      }, { maxTokens: Math.min(OUTPUT_TOKENS, model.maxTokens), reasoning: ONE_SHOT_REASONING, signal: lifetime });
      const usage = message.usage;
      if (usage.totalTokens || usage.cost.total) recordRun({
        projectId, sessionId: NOTE_DRAFT_SESSION_ID, model: modelReference(model), role: "agent", billing,
        before: emptySnapshot(),
        after: { costUsd: usage.cost.total, input: usage.input, output: usage.output, cacheRead: usage.cacheRead, total: usage.totalTokens },
      });
      signal.throwIfAborted();
      if (lifetime.aborted) throw new SandboxError(504, "Note drafting timed out");
      try { return draftJson(message); }
      catch { throw new SandboxError(502, "The expert did not return usable note candidates"); }
    },
  };
}
