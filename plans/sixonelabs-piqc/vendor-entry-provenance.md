---
status: active
feature: vendor-entry-provenance
owner: sixonelabs-piqc
branch: sixonelabs-piqc/vendor-entry-provenance
target_pr: TBD
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
- src/components/dashboard/audit/stages/vendor/EntryProvenance.tsx (new)
- src/components/dashboard/audit/stages/vendor/__tests__/EntryProvenance.test.tsx (new)
- src/components/dashboard/audit/stages/AuditConductWorkspace.tsx (EntryRow: one prop, one mount; one `notesById` derivation)
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
2. **Provenance renders as a pill plus a collapsed disclosure, in one self-contained component.** `EntryProvenance` (stages/vendor/) renders nothing for AUDITOR entries — hand-typed observations stay exactly as they were; for PIQC origins it shows the origin pill (PiqcMark; "PIQC-drafted" / "PIQC-drafted, edited") and a "Sources" toggle that opens the chain: each consumed note's body (or "note unavailable" if deleted/not loaded), each filed-evidence passage's locator (the shared `formatProtocolRefWhere`), the verified protocol quote, and the drafting engine. Collapsed by default: the record's primary surface is the observation text.
3. **One mount in EntryRow, between the observation text and the footer.** EntryRow gains a `notesById` prop (the workspace already holds the notes for the pad and the panel — one derivation, no new read). No portal, no second mount point.
4. **Lineage names the provenance.** The Stage-6 node's origin line becomes "PIQC-drafted from N fieldwork notes during Audit conduct (domain); accepted by the auditor" / "…, edited and accepted…" for PIQC origins; AUDITOR entries keep today's line verbatim.
5. **Origin labels live in labels.ts** next to the other audit enums (`WORKSPACE_ENTRY_ORIGIN_LABELS`), the single source for the pill, the lineage line, and any future report disclosure.

## Deferral ledger

- **Evidence-passage locators are breadcrumbs, not links** — the chain names the document by id and locator; opening the filed document from the row is a follow-up (needs the register's title lookup + the evidence drawer). Trigger: auditor asks to jump from an observation to its filed source.
- **Deleted source notes** — a note consumed by an accepted candidate cannot be deleted (slice 1's server guard), so "note unavailable" is reachable only while the notes read is loading/failed. If un-promote ever ships, this copy needs revisiting.
- **AI-origin disclosure in report bodies** — deliberately not surfaced (out of scope above).

## Verification

- CI green — first execution of typecheck + vitest (no local Node).
- workspaceEntriesApi: `flattenEntry` maps the five fields through; absent columns default to AUDITOR / [] / null (pre-apply pin).
- EntryProvenance: AUDITOR renders nothing; PIQC_DRAFTED / PIQC_EDITED render the correct pill; Sources toggle reveals note bodies (and "note unavailable" for a missing id), passage locators in the shared format, the protocol quote, and the engine line; hidden again on second click.
- lineageAdapter: PIQC origins produce the provenance origin line with the note count; AUDITOR keeps the existing line.
- AuditConductWorkspace: EntryRow passes `notesById` and mounts the component (marker asserts the entry id and the notes it received).
- End-to-end (user, deployed after apply): accept two candidates (one edited) → rows show "PIQC-drafted" and "PIQC-drafted, edited" pills; Sources opens the note bodies and the filed passage; a hand-typed entry shows no pill; the lineage panel's Stage-6 node reads the provenance line.
