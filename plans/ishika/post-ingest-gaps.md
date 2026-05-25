---
owner: ish-dev-piqc
feature: post-ingest-gaps
status: active
started: 2026-05-25
target_pr:
---

# Post-ingest dashboard gap fixes — Tier 1 (quick wins)

## Context

PR #105 (`feature/ish-ingest-async`) made a real 150-page protocol ingest end-to-end in prod. Walking the dashboard after that ingest, ~20 gaps surfaced — most are small UX issues, some are silent no-op buttons, a few touch the Site Mode data flow. Full gap inventory + tier ordering is in the scratch plan at `~/.claude/plans/i-am-planning-to-hashed-gadget.md`.

This branch ships **Tier 1** only — quick wins that are mostly conditional copy / single-component edits. Tier 2 (Site Mode form rework) and Tier 3 (SOTR rendering) ship in separate branches after this lands. Tier 4 (timezone story w/ migration) is a Roger-owned PR.

## Scope (files allowed)

Tier 1 gaps and the components they live in:

- `plans/ishika/post-ingest-gaps.md` (this plan)
- `src/components/dashboard/site/ProtocolTab.tsx` — G18 (remove amendment/supplementary upload section)
- `src/components/dashboard/site/TodayTab.tsx` — G14 (show empty calendar w/ "pick a participant" prompt instead of filter-block)
- `src/components/dashboard/site/VisitFormDrawer.tsx` — G4b (default date to today on open)
- `src/components/dashboard/site/VisitsTab.tsx` — G4e (highlight just-created visit / scroll-into-view)
- `src/components/dashboard/site/ParticipantsTab.tsx` — G15 (hide HeatIndicator when no signal yet)
- `src/components/sotr/WorksheetItemsList.tsx` — G5b/c/d (confidence-chip legend; "Accept for draft" explanatory copy)
- `src/components/sotr/WorksheetItemRow.tsx` — G5b (confidence-chip tooltip)

## Out of scope (files forbidden)

- All Tier 2/3/4 fix targets — handled in separate branches.
- `supabase/migrations/**` — no schema changes in Tier 1.
- `supabase/functions/**` — no edge-function changes.
- `src/lib/sotr/sourceEvidenceAdapter.ts` — Tier 3 semantic rendering refactor.
- `src/components/dashboard/audit/**`, `src/lib/audit/**` — Audit Mode untouched.

## Architecture layers touched

- [ ] migration (`supabase/migrations/`)
- [ ] RPC
- [ ] adapter
- [ ] context
- [x] component (`src/components/dashboard/site/`, `src/components/sotr/`)
- [ ] test

## Mock data plan

None. All edits are conditional UI rendering on existing real data.

## Approved-by

- **@ki-dev-piqc** (Kiara) — for Site Mode components: `ProtocolTab.tsx`, `TodayTab.tsx`, `VisitFormDrawer.tsx`, `VisitsTab.tsx`, `ParticipantsTab.tsx`.
- `src/components/sotr/*` — Ishika owns directly.

## Verification

- [ ] Protocol tab: amendment/supplementary upload section is gone.
- [ ] Today tab w/o participant filter: calendar renders empty with prompt instead of block.
- [ ] Visits drawer: opens with today's date pre-filled.
- [ ] Visits tab: after scheduling a new visit, the new row is briefly highlighted / scrolled into view.
- [ ] Participants tab: HeatIndicator chip hidden when participant has no deviation/dropout history.
- [ ] SOTR worksheet: confidence chip has a tooltip; "Accept for draft" has explanatory copy above the action bar.
- [ ] `/piqc-review` passes locally; CI `piqc-discipline.yml` passes.
