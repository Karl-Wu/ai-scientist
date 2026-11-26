# Next investigations

**What next?** on a saved hypothesis compared explanations and proposed tests
that could change a decision. Saved proposals, preferences and receipts remain
readable. Proposal generation and preference entry have been retired.

## How historical proposals were produced

1. Open **What next?** and inspect **Grounding context**: bounded source excerpts, plans/deviations, qualifications and artifact checks. Opening/refreshing makes no model call.
2. Expand **Generate a source-linked proposal**, supply constraints and approve one planning-model call. It uses the selected chat model or configured default; Fusion is unsupported.
3. Review 2–4 explanations and 1–6 proposed tests, including measurements, controls, predicted outcomes, decision branches, an inconclusive-result action and required resources.
4. **Record planning preference** to prioritize, defer or reject a candidate with a reason. It is bound to the exact proposal/context digests; changed or unverified context needs acknowledgement.
5. Review an analysis plan and obtain execution/resource approvals separately. Computational sensitivity work uses [Stress-test finding](notebook-robustness.md).

Prior proposals and preferences remain accessible as planning context.

## Interpretation

Predictions are conditional expectations, not observations. Priorities, time and
cost are qualitative judgments, not calibrated probabilities, power calculations
or provider quotes. Existing-data checks are preferred; new collection needs a
reason. Schema validation does not establish feasibility or scientific validity.

Proposals/preferences contribute **context** only: they cannot support/refute a
hypothesis or supersede actual scientific findings. Performed-Methods drafts
exclude them. `current` means the bounded source identities still match;
`changed` and `unverified` preserve known uncertainty.

## Costs and interrupted calls

Normal provider billing applies under the `next-experiments` ledger session,
including returned refusals or invalid/incomplete responses. The cap is checked
before paid calls; admitted calls can exceed remaining spend.

A persisted request ID returns its confirmed result/failure without another
model call. An interrupted request with no outcome is **not automatically retried**:
usage may be unknown. The request-status endpoint and cost ledger preserve the
known outcome of past calls.

## Proposal history and storage

Historical entries may contain proposals authored through the retired `notebook`
tool. New proposals generated through the API target a saved hypothesis and
include the research question, existing-data assessment, competing explanations,
and tests with predictions, decision branches, requirements and limitations.
The historical research memory API returns exact source IDs. API-generated
proposals record the source versions available during generation.

Proposals/preferences append to `.kady/notebook/<sessionId>.jsonl`. Model-call
receipts live in `.kady/notebook/next-experiment-generations/`. Hashes do not
archive all earlier input bytes. JSON/Markdown/ZIP exports and evidence packages
preserve proposals as planning context.

Context uses [research memory's bounded scan](notebook-memory.md#coverage-and-privacy),
up to 24 sources, 1,800 characters per excerpt and 30,000 bytes of source text.
Omissions are explicit; neither direct artifact checks nor planning hashes
verify complete upstream lineage. Each hypothesis retains up to 100 call receipts.

Implementation: [`next-experiments.ts`](../server/src/agent/next-experiments.ts),
[`next-experiment-receipts.ts`](../server/src/agent/next-experiment-receipts.ts) and
[shared proposal schema](../web/src/lib/next-experiments.ts).
Project-scoped routes under `/sessions/:sessionId/notebook/:entryId/next-experiments`
provide historical reads and request-status operations.
