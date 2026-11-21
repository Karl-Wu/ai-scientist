# Historical research memory

The retired Lab Notebook stored research records, user notes and analysis plans.
Its read-only API still serves those records. In the workspace, attach a current
note page from the composer's **Research** tab to let the assistant read that
revision with `note_read`.

## Historical record API

`POST /projects/:projectId/notebook/memory/search` accepts a text query and
optional filters. The response includes exact source IDs, digests, excerpts,
limitations, amendment links and direct artifact warnings. Superseded records
are included by default. Use the returned `sourceUri` for an exact read. The
response indicates whether the record has changed since search.

Source kinds are `notebook`, `user-note` and `plan-event`. Requests are scoped
to the project. Retrieved text describes earlier work and approvals.

## Coverage and privacy

Each request reads durable files afresh. It does not search raw chat transcripts,
arbitrary project files, credentials, literature or external services. Comments
and pins are not standalone findings. Partial scans and truncated text are flagged.

| Boundary | Limit |
|---|---|
| Query/results | 500 characters; default 6 results, maximum 12 |
| Project scan | 32 MiB, 512 files, 100 sessions, 5,000 records |
| Notebook window | Recent 4 MiB/file; exact reads prioritize the source with up to 16 MiB |

Direct artifact checks do not traverse transitive lineage. Records lacking
outcome labels need text search as well as filters. Search uses local text matching.

Implementation: [research memory routes](../server/src/api/notebook-memory.ts),
[lookup](../server/src/agent/notebook-memory.ts) and
[record loading](../server/src/agent/notebook-memory-loader.ts).
