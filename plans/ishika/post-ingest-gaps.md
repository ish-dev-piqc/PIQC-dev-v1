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
- `src/components/sotr/ConfidenceBadge.tsx` — G5b (title-attr tooltip on the chip with per-state copy)
- `src/components/sotr/ReviewActionBar.tsx` — G5c (explanatory blurb above the action buttons)

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

- [x] Protocol tab: amendment/supplementary upload section is gone (G18).
- [x] Today tab: even with zero visible visits, the week/month grid still renders; empty-state copy moves into a compact banner above the grid (G14).
- [x] Visits drawer: date input pre-fills to today's local date on open (G4b).
- [x] Visits tab: after a successful manual schedule, a green confirmation banner shows the new visit name + date for 5s (G4e).
- [x] Participants tab: HeatIndicator chip only renders for `moderate` / `high` scores; suppressed on default-state rows (G15).
- [x] SOTR worksheet: ConfidenceBadge has a `title=`-attribute tooltip per state explaining what the level means (G5b); ReviewActionBar shows an explanatory paragraph above the action row clarifying what Accept/Edit/Reject/Flag do (G5c). G5d is documented inside the same blurb.
- [ ] `/piqc-review` passes locally; CI `piqc-discipline.yml` passes.
