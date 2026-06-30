---
owner: ish-dev-piqc
feature: footnotes-button
status: active
started: 2026-06-29
target_pr:
---

# Visit Prep — Footnotes button (display-only SoA footnotes)

## Context

SoA footnote legends ("a. Time 0 on Day 1 is pre-dose…", "b. Participants in Cohorts … return for Follow-Up…")
carry real clinical context (timing windows, conditional rules, cohort caveats) but are dropped from Visit Prep's
structured data — they survive only as unstructured `chunks` (searchable by Ask). This adds a lightweight,
**display-only** "Footnotes" button in Visit Prep that shows the SoA footnote text straight from `chunks` via a small
access-gated RPC. No parsing, no structuring, no linkage, no re-ingest — it just shows up.

## Scope (files allowed)

- supabase/migrations/20260707000000_get_soa_footnotes_rpc.sql   (NEW)
- src/types/visit-execution/index.ts
- src/lib/visit-execution/visitExecutionApi.ts
- src/components/dashboard/visit-execution/FootnotesDrawer.tsx   (NEW)
- src/components/dashboard/visit-execution/VisitExecutionTab.tsx

## Out of scope (forbidden)

- supabase/functions/ — no ingest/parser change (no footnote structuring or procedure linkage).
- chunks RLS — not widened; the RPC is SECURITY DEFINER + gated by user_can_access_protocol.
- Slice 3.1 cohort-scope fix — separate, parked.

## Architecture layers touched

- [x] migration (read-only RPC) — `supabase/`
- [ ] context
- [x] adapter / api (`src/lib/visit-execution/visitExecutionApi.ts`)
- [x] component (`visit-execution/` Footnotes button + drawer)
- [ ] test  (display-only; verified via SQL RPC call + manual UI — see Verification)

**DB schema change → TS type mirror:** the RPC return shape ↔ `SoaFootnote` in `src/types/visit-execution/`. In scope.

## Mock data plan

none.

## Approved-by

- @rv61 (Roger) — `supabase/migrations/`.
- `src/{types,lib,components}/visit-execution/` — Ishika owns directly.

## Verification

- **RPC:** `select get_protocol_soa_footnotes('2ce2fc03-e147-44ef-b623-66a192575224')` returns BLKR201's a./b./c.
  SAD/MAD/CSF legend text; a protocol with no SoA → `{footnotes:[]}`; a non-member caller → `{footnotes:[]}` (access gate).
- **UI:** "Footnotes" button in the Visit Prep header opens a drawer showing the footnote text; empty/error states render
  cleanly; ESC / backdrop / swipe close. Demo protocol (alias→real) shows footnotes via the RPC.
- `npm run typecheck` clean; `/piqc-review` green; migration deployed; live-verified on BLKR201.
