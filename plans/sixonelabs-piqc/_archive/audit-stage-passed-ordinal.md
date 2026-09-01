---
status: merged
merged: 2026-09-01
owner: sixonelabs-piqc
feature: audit-stage-passed-ordinal
target_pr: #577
---

# Audit stage-passed ordinal — one encoding for "already advanced"

PR-4 of the pre-D4 quality-hardening train (quality review 2026-08-31).
Smallest of the train; predicted by the UX2 plan's own debt ledger.

## Problem

Four workspaces hand-encode "the audit has advanced past this stage" as
divergent hardcoded downstream-stage string arrays (AuditConduct:293,
ReportDrafting:497, PreAuditDrafting:789, ScopeReview:142) — four
encodings of one ordinal concept, none ISA-aware, each silently wrong the
day the pipeline changes. `workflowStages.ts` already owns the ordinal
machinery (`hasReachedStage`); its sibling doesn't exist yet. ScopeReview
is also the one workspace calling `hasReachedStage` inline in JSX instead
of the `const hasReached` idiom every sibling uses.

## Fix (code-only; no migrations; deploy-safe)

- Add `hasPassedStage(workflowType, currentStage, stage)` to
  workflowStages.ts: ordinal (`currentIdx > stageIdx`), fail-safe exactly
  like `hasReachedStage` (unknown stage or workflow → false), ISA-aware for
  free via `stagesForWorkflow`.
- Replace the four `alreadyAdvanced` string arrays with
  `hasPassedStage(..., '<own stage>')`.
- Normalize ScopeReview to the standard `const hasReached` + notice shape.
- Truth-table tests in workflowStages.test.ts (both workflows, ends,
  unknown-stage fail-safe, reached-vs-passed boundary).
- `canViewStage` helper deliberately NOT added (zero consumers — StageNav
  owns the one-ahead policy; house rule 5).

## Scope

- src/lib/audit/workflowStages.ts
- src/lib/audit/__tests__/workflowStages.test.ts
- src/components/dashboard/audit/stages/AuditConductWorkspace.tsx
- src/components/dashboard/audit/stages/ReportDraftingWorkspace.tsx
- src/components/dashboard/audit/stages/PreAuditDraftingWorkspace.tsx
- src/components/dashboard/audit/stages/ScopeReviewWorkspace.tsx
- plans/sixonelabs-piqc/audit-stage-passed-ordinal.md

## Out of scope

- supabase/**, engine, contexts, other modes
- Any gating-RULE change: `alreadyAdvanced` consumers keep their exact
  behavior (the ordinal encodes what the arrays meant)
- StageNav / MobilePicker / header chevrons (the view-lock rule triplication
  is separate UX2 ledger debt with its own trigger)

## Architecture layers touched

lib (pure helper), component (call-site swaps), test

## Mock data plan

None.

## Approved-by

@karl-dev-piqc (audit lib + components)

## Verification

- CI: typecheck + vitest green (first execution).
- New truth-table tests pin hasPassedStage for both pipelines including the
  reached-but-not-passed boundary (current === stage → reached true,
  passed false) and unknown-stage fail-safe.
- Existing workspace tests keep pinning the advance-button behavior — a
  wrong swap fails them.
- E2E (user, deployed): advance buttons/messages on Stages 4/5/6/7 behave
  identically before and after for a mid-pipeline audit.
