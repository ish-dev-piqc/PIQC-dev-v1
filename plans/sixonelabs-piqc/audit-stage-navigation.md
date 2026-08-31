---
owner: sixonelabs-piqc
feature: Stage navigation pass (PR-UX2) — prev/next controls, back-to-current, mobile cue, off-current hardening
status: in-review
started: 2026-08-30
target_pr:
---

# Stage navigation pass (PR-UX2)

## Context

Product-owner report (2026-08-30, handover §2b): the user "cannot go back and forth in the workflow like breadcrumbs." Code-verified: the view-any-stage machinery exists — `viewedStage` state + dispatch in `AuditWorkspaceShell`, rail allowing past + current + one ahead — but the affordances fail it: the rail is `hidden md:flex`; below md the only control is an unlabeled native select; there are no prev/next controls anywhere; the "Viewing earlier stage" indicator is dead text, hidden below sm, and factually wrong when previewing *ahead*; and nothing offers "return to current stage."

The quality half (off-current hardening survey, 2026-08-30): only `ScopeReviewWorkspace` is hardened against viewing a stage the audit hasn't reached. Previewing one stage ahead can today fire **mount-time writes and LLM calls** (`ReportDraftingWorkspace` prefill + two auto-refinements; `PreAuditDraftingWorkspace` deliverable prefill), leave stage-advance buttons enabled for dead clicks (`AuditConductWorkspace`), pre-flip the Stage-4 gate (`QuestionnaireReviewWorkspace` approve), and — sharpest — allow **Stage-8 sign-off + export while the audit is still at Stage 7** (`FinalReviewExportWorkspace`; the export RPCs never check `current_stage`).

This PR changes no gating rules and no schema — component/test layers plus one pure lib helper. Deliberately schema-free while the migrations partner is away (merge = auto-deploy in this repo).

## Scope

- `plans/sixonelabs-piqc/audit-stage-navigation.md` (this file)
- `plans/sixonelabs-piqc/audit-lock-name-status-columns.md` → `plans/sixonelabs-piqc/_archive/` (step-0 debt: companion plan of #557; the archive bot only archives the first plan path in a PR body)
- `src/lib/audit/workflowStages.ts` — new pure helper `hasReachedStage`
- `src/lib/audit/__tests__/workflowStages.test.ts`
- `src/components/dashboard/audit/AuditWorkspaceShell.tsx` — chip-row prev/next chevrons, back-to-current chip, mobile position cue, MobileStagePicker label
- `src/components/dashboard/audit/StagePreviewNotice.tsx` — new shared preview banner (presentational)
- `src/components/dashboard/audit/StagePlaceholder.tsx` — **delete** (dead code; shell uses `IsaStagePlaceholder`)
- `src/components/dashboard/audit/stages/ScopeReviewWorkspace.tsx` — **banner only** (scope expanded 2026-08-30 by review finding: Stage 4 was the one stage without the preview banner, making the preview signal inconsistent across the pipeline; its readout-driven guard logic stays untouched)
- `src/components/dashboard/audit/stages/__tests__/ScopeReviewWorkspace.test.tsx` — fixture-only (`workflow_type` added to the mock audits; assertions untouched)
- Stage workspaces gaining the ahead-guard (+ their tests, extended or new):
  - `src/components/dashboard/audit/stages/ReportDraftingWorkspace.tsx` (+ existing test file)
  - `src/components/dashboard/audit/stages/PreAuditDraftingWorkspace.tsx` (+ new test)
  - `src/components/dashboard/audit/stages/FinalReviewExportWorkspace.tsx` (+ existing test file)
  - `src/components/dashboard/audit/stages/QuestionnaireReviewWorkspace.tsx` (+ new test)
  - `src/components/dashboard/audit/stages/AuditConductWorkspace.tsx` (+ new test)
  - `src/components/dashboard/audit/stages/VendorEnrichmentWorkspace.tsx` (+ new test)
  - `src/components/dashboard/audit/stages/investigator/IsaConductWorkspace.tsx` (+ new test)
  - `src/components/dashboard/audit/stages/investigator/IsaReportWorkspace.tsx` (+ new test)
  - `src/components/dashboard/audit/stages/__tests__/` (test files for the above)

## Out of scope

- `supabase/**` — no migrations, no RPC changes (schema freeze while migrations partner is away)
- `src/context/**` — no context changes; `viewedStage` stays shell-local
- `src/lib/audit/**` other than `workflowStages.ts` + its test
- `src/components/dashboard/audit/stages/ScopeReviewWorkspace.tsx` beyond the additive preview banner — its readout-driven guard + tests stay untouched
- `src/components/dashboard/audit/StageNav.tsx` — rail works; UX2 adds what's missing elsewhere
- Site Mode, SOTR, shared infra

## Architecture layers touched

component, test, plus one pure function in the lib layer (`workflowStages.ts` — no Supabase, no React). No migration, no RPC, no adapter, no context.

## Mock data plan

None. Test mocks live in `__tests__/` only (existing house pattern).

## Approved-by

- @karl-dev-piqc — `src/lib/audit/**`, `src/components/dashboard/audit/**` (same precedent as PR-UX1 #557)

## Design summary

**Navigation (shell header chip row — NOT the actions row, which is at its documented ceiling):**
- Prev/next chevron buttons flanking the stage chip; adjacent stage name as muted text on ≥lg, `aria-label`/`title` = "Previous/Next: {label}" always. Prev disabled at index 0; next disabled at end and beyond `currentIdx + 1` (the exact existing StageNav/MobileStagePicker lock rule).
- The dead "Viewing earlier stage" text becomes a clickable **"Back to current stage"** chip, visible at all breakpoints (action phrasing also retires the wrong-direction copy when previewing ahead).
- Mobile (<md, rail hidden): `Stage {viewedIdx+1} of {N}` cue in the chip row; MobileStagePicker gains a visible "Stage" label.

**Off-current hardening — uniform rule:** a PAST stage stays fully editable under its own approve/demote latches (honest model, no artificial read-only). Viewing AHEAD (only ever +1, by the nav lock): the workspace renders content but shows `StagePreviewNotice`, suppresses every mutating action and mount-time write, and never enables advance/sign-off/export. Each workspace self-derives `hasReachedStage(workflow_type, current_stage, OWN_STAGE)` from `useAudit()` — no prop threading, consistent with the ScopeReview pattern.

## Decision debt ledger

- **Server-side `current_stage` check on Stage-8 sign-off/export RPCs** (`20260730000000` has none): needs a migration — deferred while the migrations partner is away. This PR's client gating narrows the UI path; a direct API call can still sign off early. Trigger: partner's return or the next schema PR.
- Viewing beyond current+1 stays locked (empty workspaces mislead more than a lock).
- Hardcoded per-workspace "Stage N · Label" headers left as-is (cosmetic; ISA numbering already matches its own pipeline).
- **Lock-rule triplication** (review finding, accepted): the "viewable ≤ current+1" rule lives in StageNav, MobileStagePicker, and the new header chevrons, plus its ordinal mirror `hasReachedStage` in lib. A `canViewStage()` lib helper unifying all three is deferred — trigger: any revisit of the +1 policy (that revisit is itself in this ledger).
- **`alreadyAdvanced` string-arrays** (review finding, accepted): four workspaces encode "stage passed" as hardcoded downstream-stage arrays instead of an ordinal helper; they drift if the pipeline ever changes. Replace with a `hasPassedStage()` sibling when a pipeline change first forces the edit.
- **Guard is opt-in per workspace** (review finding, accepted): a future stage workspace gets no preview guard by default; the convention is enforced by the shell dispatch comment + this ledger + the D1–D6 roadmap notes, not by lint. Trigger for a mechanical check: the first time a new workspace ships without the guard.
- Stale doc references to deleted `StagePlaceholder.tsx` remain in root `plan.md` (shared-infra-owned, 2-reviewer file — out of scope) and `.claude/skills/fable-audit/surfaces.md`; flagged for a separate cleanup.

## Verification

- **CI is the first execution of typecheck and tests — no Node/tsc/vitest on this machine.** All checks below run on the PR.
- New unit tests: `hasReachedStage` (both workflows, ends, +1); preview-ahead test per guarded workspace following `ScopeReviewWorkspace.test.tsx`'s `'ignores the readout's stage-relative canAdvance while previewing ahead'` shape — notice renders, key mutating control suppressed; ReportDrafting/PreAuditDrafting additionally assert the prefill API is NOT called when ahead.
- E2E (user, deployed after merge — schema-free, so auto-deploy is safe): mid-pipeline vendor audit → chevrons step back/forward, disabled at ends and current+1 → jump back 2+ stages, "Back to current stage" returns → mobile <md: position cue + labeled picker → preview Stage 5/7 one ahead: notice shown, no deliverable/draft rows silently created, no LLM spend → Stage-7 audit previewing Stage 8: sign-off + export disabled → past stages still editable → ISA audit: conduct/report mutations gated when ahead.
