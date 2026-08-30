---
owner: sixonelabs-piqc
feature: Export currency flag (PR-C3) — Stage-8 surfaces grounding drift for PIQC-drafted deliverables; flag, never block
status: in-review
started: 2026-08-30
target_pr:
---

# Export currency flag (PR-C3)

## Context

The grounding lifecycle's last honest checkpoint (workflow Q&A round 4): before export, the auditor should see — never be blocked by — whether any PIQC-drafted Stage-5 deliverable was generated before the evidence register changed. C3 adds a display-only currency panel to `FinalReviewExportWorkspace` (Stage 8): per deliverable with a `grounding_snapshot`, run the existing `computeDeliverableCurrency` set-diff against the live register; stale → amber notice naming the deliverable and its new/removed sources, all current → one quiet confirming line; never generated → nothing. The sealed `readiness_fingerprint` system and its gates are untouched — this is information beside the gates, not a gate. No migration, no edge function, no new API file: three existing read paths composed in one component.

## Scope (files allowed)

- src/components/dashboard/audit/stages/FinalReviewExportWorkspace.tsx (currency panel: parallel fetch of bundle + register on mount, per-deliverable set-diff render)
- src/components/dashboard/audit/stages/__tests__/FinalReviewExportWorkspace.test.tsx (extend: stale notice, all-current line, never-generated absence, fetch-failure absence)
- plans/sixonelabs-piqc/audit-export-currency-flag.md (this file)
- plans/sixonelabs-piqc/_archive/* (step-0: three provably-merged plans archived)

## Out of scope (files forbidden)

- readiness_fingerprint / verifyExportReadiness / gate checklist logic (the flag is never a gate)
- src/lib/** (all three read paths exist: fetchPreAuditDeliverables, listAuditEvidence, computeDeliverableCurrency)
- supabase/** (no schema or function change)
- Stage-5 files (their per-deliverable notices shipped in C1/C2)
- src/context/**

## Architecture layers touched

- [ ] migration (`supabase/migrations/`)
- [ ] RPC (`supabase/functions/` or `.sql`)
- [ ] adapter (`src/lib/*/*Adapter.ts`)
- [ ] context (`src/context/`)
- [x] component (`src/components/`)
- [x] test (`src/**/__tests__/`)

## Mock data plan

none

## Approved-by

- @karl-dev-piqc — for src/components/dashboard/audit/**

## Verification

CI-first: no Node/npm/tsc/vitest on the authoring machine — CI is where typecheck and tests first execute.

- [ ] CI green (typecheck + vitest incl. extended FinalReviewExportWorkspace.test.tsx)
- [ ] Staging: generate checklist at Stage 5 → attach a new evidence doc → Stage 8 shows the amber drift notice naming the checklist + the new source; export still fully available
- [ ] Staging: revise the checklist → Stage 8 shows the quiet all-current line
- [ ] Staging: audit with no generated deliverables → no currency panel at all
- [ ] Staging: gates + sign-off + export behavior unchanged (fingerprint regression)
