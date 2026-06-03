---
owner: ish-dev-piqc
feature: Visit Prep — source citations (wire traceability to real evidence)
status: merged
merged: 2026-06-03
started: 2026-06-03
target_pr: #257
approved_by: rv61 (supabase migration — workspace RPC)
---

# Visit Prep — source citations

## Context

Visit Prep's `TraceabilityDrawer` / `ExecutionChecklist` / `CompletenessSignalsPanel`
render page/section citations from each requirement's `protocol_page` / `protocol_section`.
On **real ingested protocols those are null** — the structured-procedure extraction
doesn't emit per-line page numbers — so the drawer shows its placeholder: *"No protocol
source linkage available for this requirement yet. Source evidence will populate once the
structured ingest extraction is connected."* Citations only ever appear in the **demo/mock
fixture** (`mockVisitWorkspace.ts`, which hardcodes `Lab Manual §3.2, p.14` etc.). This is
a built-but-never-connected feature, not a regression. (The Ask-tab citation system is
separate and already works.)

**Key finding — the citation data exists and is reachable (no re-ingest needed):**
- `protocol_source_evidence` holds real `page_number` (213/213 sampled populated),
  `section_title`, `section_number`, `quoted_text`, `bounding_boxes`.
- `protocol_item_evidence_links` links `extracted_item_id ↔ source_evidence_id`
  (`is_primary_source`, `relevance_score`).
- Every `visit_requirements` row already has `extracted_item_id` set (56/56 on POLAR-A).
- So `requirement.extracted_item_id → protocol_item_evidence_links → protocol_source_evidence`
  resolves a real page + section. Visit Prep simply never joins to it — it reads the
  (null) denormalized `protocol_page` on the requirement.

## Approach

**A (recommended) — resolve at read time in `visit_execution_get_workspace`.**
Add a bounded LATERAL subquery per requirement: pick the primary evidence
(`is_primary_source = true`, else highest `relevance_score`) via the link table, and
`COALESCE` its `page_number` / `section_title` onto the requirement's own
`protocol_page` / `protocol_section` in the RPC output. Optionally surface `quoted_text`
to enrich the drawer. **Works on every existing protocol immediately — no re-ingest.**
RPC-only; the UI already renders these fields.

**B (rejected) — populate `visit_requirements.protocol_page` at ingest.** Requires a
persist-RPC change *and* a re-ingest of every protocol to backfill; larger write surface;
doesn't fix existing data without re-ingest. Read-time resolution (A) is strictly better
here since the evidence already exists.

## Scope (files allowed)

- **NEW** `supabase/migrations/2026XXXX_visit_execution_get_workspace_v4_citations.sql` —
  `CREATE OR REPLACE FUNCTION visit_execution_get_workspace` (restate `SECURITY DEFINER` +
  `search_path`): resolve `source_section` / `source_page` (+ optional `quoted_text`) per
  requirement through `extracted_item_id → protocol_item_evidence_links (is_primary_source)
  → protocol_source_evidence`, COALESCing over the requirement's own fields. Append-only.
- `src/types/visit-execution/index.ts` — ONLY if a new field (`quoted_text`) is added to
  the output; the existing `protocol_page`/`protocol_section`/`source_*` fields need no
  change.
- Possibly `src/components/dashboard/visit-execution/TraceabilityDrawer.tsx` — ONLY to
  render `quoted_text` if we choose to surface it. The page/section path already renders.

## Out of scope (files forbidden)

- The structured-procedure extraction prompt / `ingestPipeline.ts` (we resolve from the
  evidence chain, not by changing how Reducto emits per-line pages).
- The Ask-tab citation system (`DashboardChat.tsx`) — already works.
- `src/lib/sotr/` evidence write path — unchanged; we only read it.
- `mockVisitWorkspace.ts` — leave the demo fixture as-is.

## Architecture layers touched

- RPC (workspace read). Type/component only if surfacing `quoted_text`. No new write path,
  no ingest change.

## Mock data plan

None — this makes real mode match what the demo fixture already shows.

## Approved-by

- `rv61` (Roger) — owns `supabase/`; this is a `visit_execution_get_workspace` migration.

## Open questions / step 0

- Confirm exact join keys + that `is_primary_source` is reliably set on the link rows
  (else tie-break on `relevance_score DESC`, then null → graceful placeholder).
- Decide whether to surface `quoted_text` (richer drawer) or just page+section (smaller diff).
- Confirm `visit_execution_get_workspace` is the only real read path (mock path bypasses it).

## Verification

- On POLAR-A (existing protocol, **no re-ingest**): open a requirement's TraceabilityDrawer
  → shows real "§ Title · Page N" resolved from the evidence chain instead of the placeholder.
- A requirement whose extracted_item has no linked evidence still shows the graceful
  placeholder (no crash, no fabricated page).
- `EXPLAIN` the RPC on a large protocol — the per-requirement LATERAL stays bounded; no
  N+1 / timeout regression.

## Risks

- **RPC perf** — `visit_execution_get_workspace` is already large; add the evidence lookup
  as a bounded `LATERAL (… LIMIT 1)`, not a row-multiplying JOIN. Verify EXPLAIN.
- **Mis-linked citation** — prefer `is_primary_source`; fall back to top `relevance_score`;
  else null. A wrong page is worse than no page (matches the project's flag-don't-fabricate
  stance), so default conservative.
