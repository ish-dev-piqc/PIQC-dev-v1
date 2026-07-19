---
owner: sixonelabs-piqc
feature: ISA protocol-citation bridge (S4 of the notes → findings → report arc)
status: merged
merged: 2026-07-19
started: 2026-07-19
target_pr: #508
---

# ISA protocol-citation bridge — S4

## Context

ISA findings cite the external norm (closed-world E6(R3)/CFR map) but not the
document the site actually signed up to: its own protocol. This slice adds
protocol citations — the site's uploaded, SOTR-parsed protocol quoted against
the site's conduct — as a second, sharper reference on a finding. PIQC
proposes the citation during finding drafting (auditor confirms, D-008); a
manual search picker is the override/edit affordance.

The wiring already exists: `audits.protocol_id` (NOT NULL) and
`documents.protocol_id` point at the same `protocols` row, so
audit → parsed-protocol content is a join, not a new linkage. Chunk RLS is
owner-only (`documents.user_id`) and the auditor is usually not the uploader —
retrieval therefore runs behind an ownership gate: service-role in the edge
function after the JWT-scoped audit fetch proves access (the dashboard-chat
precedent), and a SECURITY DEFINER RPC gated on `lead_auditor_id = auth.uid()`
for the client picker. Roger's RLS is not touched.

## Scope (files allowed)

- supabase/migrations/20260727000000_audit_mode_isa_protocol_bridge.sql
- supabase/functions/isa-finding-draft/index.ts
- supabase/functions/isa-finding-draft/gates.ts
- supabase/functions/isa-finding-draft/protocolCandidates.ts
- src/types/audit/objects.ts
- src/lib/audit/isaFindingsApi.ts
- src/lib/audit/isaReportModel.ts
- src/lib/audit/isaReportClipboard.ts
- src/lib/audit/isaReportDocx.ts
- src/components/dashboard/audit/stages/investigator/IsaConductWorkspace.tsx
- src/lib/audit/__tests__/isaFindingGates.test.ts
- src/lib/audit/__tests__/isaProtocolCandidates.test.ts
- src/lib/audit/__tests__/isaFindingsApi.test.ts
- src/lib/audit/__tests__/isaReportClipboard.test.ts
- src/lib/audit/__tests__/isaInsights.test.ts (mechanical compile fix only —
  finding fixtures gain the now-required `protocol_refs: []`)
- src/lib/audit/__tests__/isaReportModel.test.ts (same mechanical fix)

## Out of scope (files forbidden)

- supabase/functions/dashboard-chat/** (we reuse its patterns, not its code)
- Any migration altering `hybrid_search`, `chunks`, `documents`, or their RLS
- src/lib/sotr/**, src/components/dashboard/sotr/** (mode isolation — the
  bridge joins at the DB layer, never via source imports)
- src/lib/audit/isaNotesApi.ts, isaInsights.ts, isaReportApi.ts
- src/components/dashboard/audit/stages/investigator/IsaReportWorkspace.tsx
  (renderers take the packet; no workspace change needed)

## Architecture layers touched

migration, RPC, edge function, API (lib), component, test.
No context change (findings already flow through existing fetches).

## Mock data plan

None.

## Approved-by

- Roger — supabase/ (migration adds a column on `isa_finding_objects`, two
  audit-owned RPC replacements, one new SECURITY DEFINER search RPC that
  deliberately bypasses chunk RLS behind an audit-ownership gate; no change to
  his RLS policies or `hybrid_search`).

## Design stance (load-bearing)

- **Snapshot, not live FK.** A protocol ref stores
  `{ chunk_id, document_id, quote, section_heading, page_start, page_end }`
  denormalized at attach time (the `visit_requirements` precedent). Renderers
  read the snapshot; a later re-parse cannot mutate or orphan a signed
  finding's citation. `chunk_id` is a provenance breadcrumb, not a dependency.
- **Closed world at birth.** Gate 3 in the edge function: a proposed ref must
  name a passage from the candidate set actually sent to the model AND its
  quote must be a verbatim substring of that chunk (whitespace-normalized).
  Fails → ref stripped, draft survives, honesty counter increments. The DB
  validates shape/caps only — membership is enforced where refs are born
  (gate + picker RPC), so editing a finding years later never fails on a
  since-re-parsed chunk.
- **Silent-with-signal.** Protocol has no ready parsed documents → no
  proposal, no picker, one nudge line. Response carries
  `protocol_source: ready | unavailable`.
- **LLM data note:** protocol chunk text now goes to OpenAI from this
  function — the same data class Sponsor Ask (dashboard-chat) already sends.
  Notes/personnel rules unchanged.

## Verification

- Unit: Gate 3 (membership, substring, strip-not-withhold, counters), snapshot
  materialization, picker RPC param mapping, renderer output ("Protocol
  requirement:" line present when refs exist, absent otherwise, escaped, in
  all five artifacts).
- `tsc --noEmit -p tsconfig.app.json` clean; full `vitest run src/lib/audit`.
- Post-merge (dev team): apply migration, redeploy `isa-finding-draft`; on a
  seeded ISA audit with a parsed protocol, confirm drafts carry a quoted
  passage that exists verbatim in the protocol, confirm picker search returns
  only this protocol's chunks, confirm a protocol with no parsed docs shows
  the nudge and no dead buttons.
