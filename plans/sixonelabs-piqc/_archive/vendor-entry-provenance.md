---
status: merged
merged: 2026-09-02
feature: vendor-entry-provenance
owner: sixonelabs-piqc
branch: sixonelabs-piqc/vendor-entry-provenance
target_pr: #599
---

# Vendor-entry provenance (fieldwork lane, slice 3 of 3)

Slice 2 (#597) records provenance on every accepted candidate — `origin`, the notes consumed, the gated evidence chain, the verified protocol quote, the drafting engine — but nothing in the client reads those columns yet: an accepted candidate renders byte-identical to a hand-typed entry (slice 2's decision 6 deferred the display shape to its consumer). This slice is that consumer. Frontend-only; zero migrations; fully deploy-safe.

Standalone value: the auditor and a later reviewer can see WHICH Stage-6 observations PIQC proposed, whether the auditor changed them, and from what — the note bodies, the filed-document passages, the protocol requirement, the model. That is the GxP half of the latch that slice 2 made real.

## Scope

- plans/sixonelabs-piqc/vendor-entry-provenance.md
- src/lib/audit/mockWorkspaceEntries.ts (display shape gains `origin`, `source_note_ids`, `evidence_refs`, `protocol_ref`, `drafting_engine`)
- src/lib/audit/workspaceEntriesApi.ts (row interface + `flattenEntry`, default-tolerant pre-apply)
- src/lib/audit/__tests__/workspaceEntriesApi.test.ts
- src/lib/audit/labels.ts (`WORKSPACE_ENTRY_ORIGIN_LABELS`)
- src/lib/audit/lineageAdapter.ts (entry node origin line names the provenance)
- src/lib/audit/__tests__/lineageAdapter.test.ts
- src/lib/audit/passageLocator.ts (new — the filed-passage locator, shared by the panel and the row)
- src/lib/audit/__tests__/passageLocator.test.ts (new)
- src/components/dashboard/audit/stages/vendor/EntryProvenance.tsx (new)
- src/components/dashboard/audit/stages/vendor/__tests__/EntryProvenance.test.tsx (new)
- src/components/dashboard/audit/stages/vendor/VendorCandidatePanel.tsx (its local locator helper moves to passageLocator.ts)
- src/components/dashboard/audit/stages/AuditConductWorkspace.tsx (EntryRow: two props, one mount; one memoized `notesById` derivation)
- src/components/dashboard/audit/stages/__tests__/AuditConductWorkspace.test.tsx
- Type-forced fixture lines (the display shape gained required fields): src/components/dashboard/audit/stages/__tests__/FindingsReportSection.test.tsx, src/components/dashboard/audit/stages/__tests__/FinalReviewExportWorkspace.test.tsx, src/components/dashboard/audit/stages/vendor/__tests__/VendorCandidatePanel.test.tsx, src/lib/audit/__tests__/capaApi.test.ts, src/lib/audit/__tests__/observationGroups.test.ts

## Out of scope

- supabase/** — no migration, no RPC. The columns exist (20260909000000); this slice reads them.
- `HistoryDrawer` (deltas render raw keys today for every object type — not this slice's problem).
- Findings-report / export bodies — an accepted candidate is an observation like any other there; provenance is an audit-record fact, not report content. Trigger: sponsor asks for AI-origin disclosure in the report.
- Origin flip on post-accept edits (server-side; partner-return item).
- The ISA lane.
- AuditConductWorkspace render blocks beyond the EntryRow prop + mount and the `notesById` line (a parallel session is sweeping theme tokens in audit components).

## Architecture layers touched

adapter (pure client mapping), component, test. No migration, no RPC, no context.

## Mock data plan

None. Pre-apply of 20260909000000 in prod the columns are absent from `select *`; the mapper defaults them (AUDITOR, no sources) — which is TRUE pre-apply, since the promote RPC that writes anything else does not exist there yet. Nothing silently misreports.

## Approved-by

- @karl-dev-piqc (src/lib/audit, src/components/dashboard/audit)

## Decision record

1. **Required fields on the display shape, defaulted in the mapper.** `MockWorkspaceEntry` gains the five provenance fields as required (a consumer should never wonder whether they were mapped); `flattenEntry` defaults absent columns (`?? 'AUDITOR'`, `?? []`, `?? null`) so the same build reads correctly before and after the migration applies. Seven fixtures gain the lines — the cost slice 2 declined to pay before there was a consumer.
2. **Provenance renders as a pill plus a collapsed disclosure, in one self-contained component.** `EntryProvenance` (stages/vendor/) renders nothing for AUDITOR entries — hand-typed observations stay exactly as they were; for PIQC origins it shows the origin pill (PiqcMark; "PIQC-drafted" / "PIQC-drafted, edited") and a "Sources" toggle that opens the chain **per evidence item, as it was reviewed**: the claim's text, then the note bodies it cites and the filed-evidence passages it came from (post-review amendment — the first cut flattened the notes into one list and dropped the claim text, losing the note↔claim pairing that IS the review act), then the verified protocol quote and the drafting engine. Collapsed by default: the record's primary surface is the observation text.
3. **Two props on EntryRow, one mount between the observation text and the footer.** `notesById` (memoized once in the workspace from the read the pad and the panel already share) and `notesStatus` — so a cited note reads "(note not loaded)" while the read is loading or failed and "Note unavailable" only when the notes are known and the note is genuinely gone (post-review amendment: the first cut said "unavailable" during every page load).
4. **Lineage names the provenance** with the same label the pill wears: "PIQC-drafted — from N fieldwork notes during Audit conduct (domain); accepted by the auditor" / "PIQC-drafted, edited — …". AUDITOR entries keep today's line verbatim.
5. **Origin labels live in labels.ts** (`WORKSPACE_ENTRY_ORIGIN_LABELS`) and are the single source for the pill and the lineage line. The AUDITOR key exists because the map is exhaustive over the enum; no surface badges a hand-typed entry.
6. **The filed-passage locator is one function.** `passageLocator.ts` decides "no locator" from the fields themselves (never by comparing the shared formatter's protocol fallback word), then delegates to `formatProtocolRefWhere` so a passage reads identically in the candidate panel and on the record. Post-review amendment — the first cut carried a second copy of a 3-line helper that string-compared a sentinel owned by the ISA lane.

## Deferral ledger

- **Evidence-passage locators are breadcrumbs, not links** — the chain names the document by id and locator; opening the filed document from the row is a follow-up (needs the register's title lookup + the evidence drawer). Trigger: auditor asks to jump from an observation to its filed source.
- **Deleted source notes** — the vendor RPCs refuse to delete a consumed note, but the applied ISA delete RPC checks only `promoted_finding_id` and is not lane-scoped (slice 1's ledger, partner-return item), so a consumed vendor note CAN still be soft-deleted through it and drop out of the read. "Note unavailable" is the honest read then; the chain's claim text and passages survive on the record regardless.
- **AI-origin disclosure in report bodies** — deliberately not surfaced (out of scope above).

## Verification

- CI green — first execution of typecheck + vitest (no local Node).
- workspaceEntriesApi: `flattenEntry` maps the five fields through; absent columns default to AUDITOR / [] / null (pre-apply pin); malformed jsonb (missing `source_passages`, junk items, incomplete refs) is normalized, never thrown.
- passageLocator: section + pages format exactly like the shared protocol-citation locator; no section and no page yields '' (never the protocol fallback word).
- EntryProvenance: AUDITOR renders nothing; PIQC_DRAFTED / PIQC_EDITED render the correct pill; the Sources summary names the claim count and the distinct sources; opening it shows each claim with the note bodies and passage locators it cites, then the protocol quote and the engine line scoped to acceptance ("Changes since acceptance are in History"); a missing note reads "(note not loaded)" while the read is loading/failed and "Note unavailable" once the notes are known; evidence-only entries show no note/protocol lines; two rows keep their own row-scoped toggles.
- lineageAdapter: PIQC origins produce the provenance origin line with the pill's label and the note count (or "filed evidence"); AUDITOR keeps the existing line verbatim.
- AuditConductWorkspace: EntryRow passes `notesById` + `notesStatus` and mounts the component (marker asserts the entry id, the notes it received, and the settled status).
- End-to-end (user, deployed after apply): accept two candidates (one edited) → rows show "PIQC-drafted" and "PIQC-drafted, edited" pills; Sources opens the note bodies and the filed passage; a hand-typed entry shows no pill; the lineage panel's Stage-6 node reads the provenance line.
