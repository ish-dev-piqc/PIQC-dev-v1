---
owner: ish-dev-piqc
feature: post-ingest-gaps
status: active
started: 2026-05-25
target_pr: 106
---

# Post-ingest dashboard gap fixes — Tiers 1–4 (bundled)

## Context

PR #105 (`feature/ish-ingest-async`) made a real 150-page protocol ingest end-to-end in prod. Walking the dashboard after that ingest, ~20 gaps surfaced — small UX issues, silent no-op buttons, and a few Site Mode data-flow problems. Full gap inventory in `~/.claude/plans/i-am-planning-to-hashed-gadget.md`.

This branch bundles everything (Tier 1 quick wins, Tier 2 form rework, Tier 3 SOTR rendering, Tier 4 timezone migration) into PR #106 per Ishika's request — easier to verify the whole post-ingest experience in one pass.

## Scope (files allowed)

- `plans/ishika/post-ingest-gaps.md` (this plan)

**Site Mode** (Kiara's review):
- `src/components/dashboard/site/ProtocolTab.tsx` — G18 amendment-upload removal + G19 timezone display + G13 anchor-modal wiring
- `src/components/dashboard/site/TodayTab.tsx` — G14 (always-render calendar grid w/ empty-state banner) + G13 anchor-modal initialTimezone pass-through
- `src/components/dashboard/site/VisitFormDrawer.tsx` — G4a/c/d (time picker, derived study_day, procedures checklist) + G4b (date defaults to today)
- `src/components/dashboard/site/VisitsTab.tsx` — G4e (post-schedule confirmation banner) + G17 (Group-by-participant picker) + G1 (refetch on save)
- `src/components/dashboard/site/ParticipantsTab.tsx` — G15 (hide HeatIndicator with no signal) + G16 (`Not enrolled` label) + G1 (refetch on save)
- `src/components/dashboard/site/ParticipantFormDrawer.tsx` — G16 (enrolled_at required on create)
- `src/components/dashboard/site/AnchorDateModal.tsx` — G19 explanatory copy + G13 timezone picker

**SOTR** (Ishika owns directly):
- `src/components/sotr/ConfidenceBadge.tsx` — G5b (per-state tooltip)
- `src/components/sotr/ReviewActionBar.tsx` — G5c (explanatory blurb above action buttons)
- `src/components/sotr/WorksheetItemRow.tsx` — G5 (semantic schedule_of_events render via `formatVisit`)

**Shared infrastructure** (2 reviewers required):
- `src/context/ProtocolContext.tsx` — add `timezone` to the `Protocol` type (G13)
- `src/lib/site/repos/realSiteRepo.ts` — select + map `timezone`; broaden `setAnchorDate` signature (G13)
- `src/lib/site/repos/demoSiteRepo.ts` — mirror the broadened `setAnchorDate` signature (G13)
- `src/lib/site/repos/types.ts` — `setAnchorDate` repo contract (G13)
- `src/lib/site/siteApi.ts` — `setAnchorDate` API helper (G13)
- `src/lib/demo/fixtures/protocols.ts` — add `timezone: null` to demo protocols (G13)

**Migration** (Roger's review):
- `supabase/migrations/20260525000000_protocols_timezone.sql` (NEW) — adds nullable `timezone TEXT` column on `protocols`

## Out of scope (files forbidden)

- All Tier 2/3/4 fix targets — handled in separate branches.
- `supabase/migrations/**` — no schema changes in Tier 1.
- `supabase/functions/**` — no edge-function changes.
- `src/lib/sotr/sourceEvidenceAdapter.ts` — Tier 3 semantic rendering refactor.
- `src/components/dashboard/audit/**`, `src/lib/audit/**` — Audit Mode untouched.

## Architecture layers touched

- [x] migration (`supabase/migrations/20260525000000_protocols_timezone.sql`)
- [ ] RPC
- [x] adapter (`src/lib/site/repos/realSiteRepo.ts`, `demoSiteRepo.ts`)
- [x] context (`src/context/ProtocolContext.tsx`)
- [x] component (`src/components/dashboard/site/`, `src/components/sotr/`)
- [ ] test

## Mock data plan

None. UI edits are conditional rendering on existing real data; demo fixtures get a `timezone: null` default (no toggle).

## Approved-by

- **@ki-dev-piqc** (Kiara) — Site Mode components: `ProtocolTab.tsx`, `TodayTab.tsx`, `VisitFormDrawer.tsx`, `VisitsTab.tsx`, `ParticipantsTab.tsx`, `ParticipantFormDrawer.tsx`, `AnchorDateModal.tsx`.
- **@rv61** (Roger) — `supabase/migrations/20260525000000_protocols_timezone.sql` + the `src/lib/site/**` shared-infra changes around `setAnchorDate` + `timezone` column wiring.
- Shared infra files (`src/context/ProtocolContext.tsx`, `src/lib/demo/fixtures/protocols.ts`) require 2 reviewers per CODEOWNERS — Kiara + Roger between them satisfy this.
- `src/components/sotr/*` — Ishika owns directly.

## Verification

**Tier 1 (already shipped earlier in this branch):**

- [x] Protocol tab: amendment/supplementary upload section is gone (G18).
- [x] Today tab: even with zero visible visits, the week/month grid still renders; empty-state copy moves into a compact banner above the grid (G14).
- [x] Visits drawer: date input pre-fills to today's local date on open (G4b).
- [x] Visits tab: after a successful manual schedule, a green confirmation banner shows the new visit name + date for 5s (G4e).
- [x] Participants tab: HeatIndicator chip only renders for `moderate` / `high` scores (G15).
- [x] SOTR worksheet: ConfidenceBadge tooltip + ReviewActionBar action explanation (G5b/c/d).

**Tier 2 (form rework — Site Mode):**

- [ ] Participants tab: after Add → Save, the new row appears immediately without a page refresh (G1).
- [ ] Visits tab: after Schedule → Save, the new visit appears immediately without a page refresh (G1).
- [ ] VisitFormDrawer: Time field is a native `<input type="time">`, required, blocks submit when blank (G4a).
- [ ] VisitFormDrawer: Study day field is gone; the derived value is shown read-only below the visit-name field (G4c).
- [ ] VisitFormDrawer: Procedures is a multi-select checklist drawn from `protocol_visit_templates.procedures` + an ad-hoc text input (G4d).
- [ ] ParticipantFormDrawer: "Enrolled date *" required on create; blank submit blocks with a validation message (G16).
- [ ] ParticipantsTab: participants without `enrolled_at` show "Not enrolled" in the Day column instead of `—` (G16).
- [ ] VisitsTab: "Group by participant" now also exposes a dropdown to pick a specific participant or "All participants" (G17).
- [ ] AnchorDateModal: prominent amber callout explains that participants with `enrolled_at` aren't shifted by anchor changes (G19).

**Tier 3 (SOTR — Ishika area):**

- [ ] WorksheetItemRow: rows with `field_type = 'visit'` render as "Randomization — Day 0 (±0d · 2 procedures)" instead of raw JSON (G5).

**Tier 4 (timezone — needs migration deploy):**

- [ ] `supabase db push` applies `20260525000000_protocols_timezone.sql` cleanly.
- [ ] AnchorDateModal shows a "Protocol timezone" picker pre-filled from the protocol's stored value.
- [ ] Saving the modal persists both `demo_anchor_date` and `timezone` to the DB.
- [ ] ProtocolTab metadata row shows the protocol's timezone (or "Browser default" if null).

**Discipline:**

- [ ] `/piqc-review` locally + CI `piqc-discipline.yml` green.
