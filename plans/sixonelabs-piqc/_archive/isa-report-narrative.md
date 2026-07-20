---
owner: sixonelabs-piqc
feature: ISA report narrative sections — LLM draft/refine on the provenance ladder (S5)
status: merged
started: 2026-07-19
target_pr: 510
merged: 2026-07-19
---

# ISA report narrative sections — S5

## Context

The ISA report is ~70% deterministic; the remaining hand-writing is the four
prose sections. S5 closes that gap: PIQC drafts the auditee background and
opening/closing meeting sections FROM THE PAD NOTES (the only place fieldwork
facts live), and refines the derived exec summary into flowing register
prose. Everything lands on the vendor lane's provenance ladder —
`templated → llm → auditor_edited` — via the source columns the S3 schema
header explicitly reserved ("when LLM refinement lands, a source column comes
with it"). Proposals only; the auditor applies each one (D-008).

## Scope (files allowed)

- supabase/migrations/20260728000000_audit_mode_isa_report_narrative.sql
- supabase/functions/isa-report-draft/index.ts (new edge function)
- supabase/functions/isa-report-draft/sectionContract.ts (pure module)
- src/lib/audit/isaReportApi.ts
- src/lib/audit/isaReportModel.ts
- src/types/audit/objects.ts
- src/components/dashboard/audit/stages/investigator/IsaReportWorkspace.tsx
- src/lib/audit/__tests__/isaReportSectionContract.test.ts (new)
- src/lib/audit/__tests__/isaReportApi.test.ts
- src/lib/audit/__tests__/isaReportModel.test.ts
- src/lib/audit/__tests__/isaReportClipboard.test.ts (mechanical compile fix
  only, if the draft fixture needs the new source fields)

## Out of scope (files forbidden)

- src/lib/audit/isaReportClipboard.ts, isaReportDocx.ts (renderers consume
  stored text regardless of source — no change)
- supabase/functions/isa-finding-draft/** (sibling stays untouched)
- src/lib/audit/isaFindingsApi.ts, isaNotesApi.ts, isaInsights.ts
- IsaConductWorkspace.tsx

## Architecture layers touched

migration, RPC, edge function, API (lib), component, test.

## Mock data plan

None.

## Approved-by

- Roger — supabase/ (source columns + backfill on `isa_report_draft_objects`,
  upsert RPC replacement (DROP-first — signature changes), new edge function;
  no RLS changes).

## Design stance (load-bearing)

- **Provenance ladder.** Four `*_source` columns (`llm` | `auditor_edited`,
  NULL iff the prose column is NULL — CHECK-enforced, existing rows
  backfilled `auditor_edited`). Apply writes `llm`; any manual save writes
  `auditor_edited`; clear returns to NULL/templated. The chip in the
  workspace tells the truth at all times.
- **Exec refine requires the verdict.** The verdict sentence is a beat of the
  summary; refining around a placeholder writes around a hole. Server 409s
  until `site_verdict` is set.
- **Anchor gate, not vibes.** The exec draft must contain, verbatim: the
  compliance statement, the verdict sentence, and the response clause. Missing
  anchor → withheld with an honest error, never rendered. The anchor
  constants are duplicated Deno-side; a cross-tree test asserts equality with
  the client model's constants so drift becomes a test failure.
- **Note sections draft with bracketed gaps.** Where the notes don't cover a
  beat (attendees, recruitment source…), the model writes
  `[not recorded in notes: …]` instead of inventing — the gap teaches the
  auditor what to fill.
- **No names.** Sponsor/client/personnel/PI names never in output — roles
  only ("the investigator", "the study coordinator"), same rule as the
  finding writer. Note bodies go to OpenAI (existing S1 stance).

## Verification

- Unit: anchor gate (present/missing/withheld), constants parity with the
  client model, source-param RPC mapping, resolveSection/buildExecSummary
  source resolution.
- `tsc --noEmit -p tsconfig.app.json` clean; full `vitest run src/lib/audit`.
- Post-merge (dev team): apply migration, `supabase functions deploy
  isa-report-draft`; on a seeded ISA audit: exec refine blocked until verdict
  set, then produces prose containing all three anchors; background draft
  from notes shows bracketed gaps for uncovered beats; applying shows "PIQC
  drafted", hand-editing flips the chip to "Auditor written".
