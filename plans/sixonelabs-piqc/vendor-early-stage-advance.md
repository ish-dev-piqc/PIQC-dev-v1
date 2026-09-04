---
owner: sixonelabs-piqc
feature: vendor-early-stage-advance
status: in-review
started: 2026-09-04
target_pr: 619
---

# Vendor audit: stage transition on Stages 1–3

## Context

A vendor audit cannot leave Stage 1 from the UI. Only the gated stages
(4 → 5, 5 → 6, 6 → 7, 7 → 8) carry a "Stage transition" card that calls
`advanceStage`; Intake, Vendor enrichment and Questionnaire review never got
one, the stage nav's NEXT click only previews (its "clickable to advance
(Phase B)" comment is stale), and `git log --all -S` shows no such button
ever existed. The server already treats the three early transitions as
ungated — `audit_mode_get_stage_readout` reports `can_advance = TRUE` for
them and `audit_mode_advance_audit_stage` only enforces "+1 forward" — so
the gap is frontend-only. Found 2026-09-04 during the `isa-stage-advance`
intake; both live audits sit at Stage 1 because of it.

**Decision:** one shared `StageTransitionCard` (three identical callers:
stage, next stage; reads `useAudit`) rendered at the bottom of the three
early-stage workspaces in the same shape as Scope review's inline card —
ready copy, "Advance to {next}", already-advanced state, the one-ahead
preview state, and the inline server-rejection alert. No client-side gate
is invented: the card mirrors the server rule.

## Scope (files allowed)

- src/components/dashboard/audit/stages/StageTransitionCard.tsx
- src/components/dashboard/audit/stages/IntakeWorkspace.tsx
- src/components/dashboard/audit/stages/VendorEnrichmentWorkspace.tsx
- src/components/dashboard/audit/stages/QuestionnaireReviewWorkspace.tsx
- src/components/dashboard/audit/stages/__tests__/StageTransitionCard.test.tsx
- src/components/dashboard/audit/stages/__tests__/IntakeWorkspace.test.tsx
- src/components/dashboard/audit/stages/__tests__/VendorEnrichmentWorkspace.test.tsx
- src/components/dashboard/audit/stages/__tests__/QuestionnaireReviewWorkspace.test.tsx
- plans/sixonelabs-piqc/vendor-early-stage-advance.md

## Out of scope (files forbidden)

- src/components/dashboard/audit/stages/ScopeReviewWorkspace.tsx, PreAuditDraftingWorkspace.tsx, AuditConductWorkspace.tsx, ReportDraftingWorkspace.tsx — their inline transition cards are readout-driven (gate headings, blocked reasons); consolidating them onto the shared card is a follow-up, not this fix
- src/components/dashboard/audit/StageNav.tsx — off-limits (audit-stage-navigation); its stale "clickable to advance" comment is ledgered
- src/components/dashboard/audit/AuditWorkspaceShell.tsx — no shell change; the header chevrons keep previewing
- src/context/** — `advanceStage` / `advanceStageError` are consumed as-is
- src/lib/audit/** — no API change; the existing wrapper already reaches the RPC
- supabase/** — no migration: the server permits these transitions today
- src/components/dashboard/audit/stages/investigator/** — the ISA advance path is `isa-stage-advance`, next

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

## Decisions

- **Shared card, three callers.** The three early stages need byte-identical
  behaviour (no gate, one-ahead preview, already-advanced, server error), so
  `StageTransitionCard` is the abstraction — it reads `activeAudit`,
  `advanceStage` and `advanceStageError` itself, takes only `stage` and
  `nextStage`. The four gated stages keep their inline cards (different
  headings, readout-driven) — the ISA Site intake card can be the fourth
  caller.
- **Enabled only at the stage.** `current_stage === stage` enables the
  button; past → "Audit has already advanced past this stage · Current
  stage: {label}"; ahead (the one-ahead preview) → "Ahead of the audit's
  current stage · Advance from {current label} first." — terse on purpose:
  StagePreviewNotice at the top of the page already says "has not reached
  this stage yet", and the sibling workspace tests match on that sentence, so
  the card must not echo it (first CI run of #619 caught exactly that). A +2
  jump is refused by the server anyway; the card just doesn't offer it.
- **No client-side gate.** Intake with zero tagged sections, Enrichment
  without a service, Questionnaire without an instance all advance — that is
  the server rule, and the Stage-4 gate (questionnaire + risk summary
  approved) is where the audit is held. Earlier stages stay editable after
  advancing (`hasReachedStage` is true for past stages), which the ready copy
  says.
- **Questionnaire: card in both branches.** With no instance the workspace
  returns early; the card renders there too, so the server rule is not hidden
  behind "create an instance first".
- **Intake: card sits under ProtocolRiskTagging** and stays visible while
  the tagging form is open (the form hides its own panels, not the page) —
  same as Scope review's card next to its form. Accepted; revisit if it reads
  as noise.
- **`advanceStageError` is audit-wide, not per stage** (AuditContext keeps
  one string, cleared at the next attempt). A Stage-4 gate rejection viewed
  later on this card would read as this card's — the same parity the four
  inline cards already share. Per-stage scoping needs a context change
  (2-reviewer gate); ledgered, trigger: first confused report.
- **Test coverage, honestly.** The card's states, the Intake mount, the
  Enrichment mount (at stage / preview) and the Questionnaire NO-INSTANCE
  mount are test-pinned. The Questionnaire WITH-INSTANCE mount is a one-line
  JSX addition covered by tsc and the owner walk — the existing test has no
  bundle fixture and inventing one for a mount assertion is not worth the
  brittleness.

## Verification

Static review only on this machine (no Node): CI's tsc + vitest is the first
execution. Owner walk on the deployed app (frontend only — live on merge):

- [ ] Vendor audit at Stage 1 (either live audit): Intake ends with "Stage
      transition · Ready to advance" and an enabled "Advance to Vendor
      enrichment". Click → the view snaps to Stage 2 (the shell follows
      current_stage) and the nav marks it current; the Audit history drawer
      shows the transition. Step back to Intake → "Audit has already advanced
      past this stage · Current stage: Vendor enrichment", button disabled,
      and tagging on Stage 1 still works.
- [ ] Stage 2 → "Advance to Questionnaire review"; Stage 3 (no instance yet
      and with one) → "Advance to Scope & risk review"; each lands on the
      next stage and Stage 4's own card then reads its gates as before.
- [ ] Preview one ahead (e.g. view Stage 3 while at Stage 2): the preview
      banner plus the card's "Ahead of the audit's current stage · Advance
      from Vendor enrichment first." state, button disabled.
- [ ] Server refusal path: none reachable from the UI for these transitions
      (ungated, +1 only); the alert markup is pinned by the card test.
- [ ] Tests green in CI: StageTransitionCard (four states + click + alert),
      IntakeWorkspace (card mounted, advances to VENDOR_ENRICHMENT),
      VendorEnrichmentWorkspace and QuestionnaireReviewWorkspace (card at
      stage enabled, disabled in preview).
