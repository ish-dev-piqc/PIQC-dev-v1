---
owner: sixonelabs-piqc
feature: isa-placeholder-advance
status: in-review
started: 2026-09-05
target_pr:
---

# ISA: stage advancement through Report drafting

## Context

After isa-scope-builder (#625) an Investigator Site Audit can advance from
Site intake to Risk assessment and from Risk assessment to Scope builder,
and no further. Audit conduct (Stage 5) and Report drafting (Stage 6) have
full workspaces, but nothing offers the Stage 3 → 4, 4 → 5 or 5 → 6
transition, so both stay FUTURE-locked behind the one-ahead preview. The
server rule (`audit_mode_advance_isa_stage`, 20260916000000) already
permits every +1 ISA step with no content gate. This PR mounts the shared
`StageTransitionCard` on the three stages that lack it — Scope builder,
the Audit prep placeholder, Audit conduct — so the pipeline is walkable
through Report drafting. Frontend only; no migration, no type change.

## Scope (files allowed)

- src/components/dashboard/audit/stages/investigator/IsaStagePlaceholder.tsx
- src/components/dashboard/audit/stages/investigator/IsaScopeBuilderWorkspace.tsx
- src/components/dashboard/audit/stages/investigator/IsaConductWorkspace.tsx
- src/components/dashboard/audit/stages/__tests__/IsaStagePlaceholder.test.tsx
- src/components/dashboard/audit/stages/__tests__/IsaScopeBuilderWorkspace.test.tsx
- src/components/dashboard/audit/stages/__tests__/IsaConductWorkspace.test.tsx
- plans/sixonelabs-piqc/isa-placeholder-advance.md

## Out of scope (files forbidden)

- src/context/** (2-reviewer gate; `advanceStage` already routes ISA targets
  to the ISA RPC since isa-stage-advance #621)
- src/components/dashboard/audit/StageNav.tsx (audit-stage-navigation ruling)
- src/components/dashboard/audit/AuditWorkspaceShell.tsx (dispatch unchanged:
  ISA_PREP and ISA_EXPORT still fall through to the placeholder)
- src/components/dashboard/audit/stages/StageTransitionCard.tsx and
  src/components/dashboard/audit/StagePreviewNotice.tsx (consumed as-is)
- src/components/dashboard/audit/stages/investigator/IsaReportWorkspace.tsx
  (no Report → Export card — see Decisions)
- src/components/dashboard/audit/stages/investigator/SiteIntakeWorkspace.tsx,
  IsaRiskAssessmentWorkspace.tsx (already carry their card)
- src/lib/**, src/types/**, supabase/** (nothing new to read or write)

## Architecture layers touched

- [ ] migration (`supabase/migrations/`)
- [ ] RPC (`supabase/functions/` or `.sql`)
- [ ] adapter (`src/lib/*/*Adapter.ts`)
- [ ] context (`src/context/`)
- [x] component (`src/components/`)
- [x] test (`src/**/__tests__/`)

No type impact: no migration in the diff.

## Mock data plan

none

## Approved-by

- @karl-dev-piqc — for everything under src/components/dashboard/audit/

## Decisions

- **Three cards, not four.** Scope builder → Audit prep, Audit prep → Audit
  conduct, Audit conduct → Report drafting. Report drafting → Review & export
  is left out: Review & export is a placeholder with nothing behind it, and
  advancing an audit into it would make "Review & export" the audit's
  current stage with nothing to do there. The card lands with the Export
  workspace. Ledgered.
- **The placeholder derives its next stage from the pipeline.** No new
  stage map: `stagesForWorkflow('INVESTIGATOR_SITE_AUDIT')` gives the
  successor; the terminal stage (ISA_EXPORT) has none and renders no card.
  Vendor audits never reach the placeholder (the shell dispatches every
  vendor stage to a real workspace) — the placeholder still guards on the
  active audit's workflow rather than assuming ISA.
- **The placeholder gets the house preview treatment.** Viewed one ahead it
  renders StagePreviewNotice above the card's ahead state, as every built
  stage does; the card's terse "Advance from X first." presumes the notice
  explains the preview. Without the notice the placeholder would be the one
  stage where that sentence has no context.
- **Ungated copy is honest today.** The card says "No gate on this
  transition" — true of the ISA server rule. When a content gate lands for
  a target stage it lands server-side (CREATE OR REPLACE of the ISA advance
  RPC, slots ledgered in 20260916000000) and surfaces through the card's
  existing error line; no card change.
- **Preview tests match per element.** A workspace that mounts both the
  notice and the card has two elements naming the current stage. The Scope
  builder preview test's bare `/advance from Risk assessment/` is tightened
  to the notice's own sentence plus the card's exact ahead line — the #619 /
  #625 lesson, applied before CI finds it.
- **Nothing works before db push** for the Stage 3 → 4 click and onward:
  `audit_mode_advance_isa_stage` (20260916000000) is merged but unapplied,
  so every ISA advance fails with the not-applied error in the card's alert,
  exactly as the Site intake card does today.

## Decision-debt ledger

- **Report → Export card.** Trigger: the ISA_EXPORT workspace ships.
- **ISA content gates** (what must be approved before Conduct, before
  Report). Trigger: the first ISA audit run end-to-end by a real auditor;
  candidate gates are "scope approved" (Stage 3 → 4) and "at least one
  finding or a documented clean visit" (Stage 5 → 6).
- **Audit prep workspace.** The placeholder now advances; it still does
  nothing else. Trigger: document-request / subject-sample design.
- **Stage-advance delta visibility.** The ISA RPC writes a delta on every
  advance; no ISA surface lists it (the vendor Lineage view is vendor-only).
  Trigger: an auditor asking when a stage was advanced.

## Verification

Before `db push` (deployed on merge):

- [ ] ISA audit at Scope builder: the bottom of Stage 3 shows "Stage
      transition · Ready to advance" with "Advance to Audit prep" enabled;
      clicking it shows the card's inline alert with the not-applied error
      (the RPC is unapplied) — never a dead click.
- [ ] Viewed one ahead (Stage 4 from Stage 3): the placeholder shows the
      preview notice, then "Ahead of the audit's current stage · Advance
      from Scope builder first." with "Advance to Audit conduct" disabled.
- [ ] Stage 7 (Review & export) viewed from Stage 6: notice, no card.
- [ ] Vendor audits: no change (the placeholder never renders).

After `db push` (20260916000000 applied):

- [ ] Stage 3 → "Advance to Audit prep" → the view snaps to Audit prep; the
      placeholder shows "Ready to advance" with "Advance to Audit conduct"
      enabled; Stage 3 stays editable (Rebuild / Approve still offered).
- [ ] Stage 4 → "Advance to Audit conduct" → Fieldwork notes live: "New
      note" capture visible, no preview notice.
- [ ] Stage 5 → "Advance to Report drafting" → the report workspace live
      (verdict, sections, export bar enabled), no preview notice; Stage 5
      stays editable.
- [ ] Stage 6 shows no advance card; Stage 7 stays a preview.
- [ ] Back navigation is unaffected: StageNav still opens any reached stage.
