---
owner: sixonelabs-piqc
feature: Audit stage-gate consolidation — single source of truth + non-silent advance failures
status: merged
merged: 2026-08-27
started: 2026-08-26
target_pr: #541
---

# Audit stage-gate consolidation

## Context

Two related gaps in Audit Mode's (VENDOR_AUDIT workflow) stage-advancement UI, found while auditing what's left before Audit Mode can be called best-in-class:

1. **Gate logic is hand-derived in two places and can disagree with the server.** `ScopeReviewWorkspace`'s `canAdvance`/`blockedReason` and `FinalReviewExportWorkspace`'s 7-item pre-export checklist re-derive approval state from the raw `questionnaires`/`riskSummaries`/`preAuditBundles` stores in `AuditDataContext`. `audit_mode_get_stage_readout` (20260430200000) already computes the same booleans server-side and is already called from other surfaces (`AuditContext.advanceStage` relies on the RPC's gate, just not this readout variant) — but nothing reads it into these two components. If a raw store is stale relative to the server (e.g. after a CAS rejection elsewhere, or a page landed directly on Stage 4), the UI can show "ready to advance" when the RPC would actually refuse, or vice versa.
2. **Two of the four stage-advance call sites still swallow a refused advancement silently.** `#458` (visible on `main` today) added `advanceStageError` to `AuditContext` and wired it into `ScopeReviewWorkspace` and `PreAuditDraftingWorkspace`. `AuditConductWorkspace` and `ReportDraftingWorkspace` still call `advanceStage` without rendering the error — a refused click there gives no visible signal (AUD-301 class). With this PR all four render it.

**Design note — the readout is stage-relative.** `audit_mode_get_stage_readout`'s `can_advance`/`blocked_reason` describe the audit's *current* stage transition, and `StageNav` lets the auditor preview one stage ahead — so `ScopeReviewWorkspace` can mount while the audit is still at `QUESTIONNAIRE_REVIEW`, where the RPC reports the ungated 3→4 transition as `can_advance = TRUE`. The component therefore only uses those two fields when `readout.currentStage === 'SCOPE_AND_RISK_REVIEW'`; while previewing ahead it shows a disabled button with "The audit has not reached this stage yet…". The five approval booleans are stage-independent and used unconditionally (which is why `FinalReviewExportWorkspace`, which consumes only booleans, needs no such guard). Pinned by a dedicated test.

## Scope (files allowed)

- src/context/AuditDataContext.tsx
- src/components/dashboard/audit/stages/ScopeReviewWorkspace.tsx
- src/components/dashboard/audit/stages/FinalReviewExportWorkspace.tsx
- src/components/dashboard/audit/stages/AuditConductWorkspace.tsx
- src/components/dashboard/audit/stages/ReportDraftingWorkspace.tsx
- src/components/dashboard/audit/RiskSummaryPanel.tsx
- src/components/dashboard/audit/stages/QuestionnaireReviewWorkspace.tsx
- src/components/dashboard/audit/stages/__tests__/ScopeReviewWorkspace.test.tsx (new)
- src/components/dashboard/audit/stages/__tests__/FinalReviewExportWorkspace.test.tsx (new)
- plans/sixonelabs-piqc/audit-stage-gate-consolidation.md

## Out of scope (files forbidden)

- `src/lib/audit/auditApi.ts` — `getStageReadout`/`StageReadout` already exist and are unchanged; not touching the RPC wrapper or the RPC itself.
- Any change to `audit_mode_get_stage_readout` or its `stage_position`/`total` computation. **B6 checked and cleared**: that RPC has a documented deferral (20260721000100) for `stage_position`/`total` correctness on `INVESTIGATOR_SITE_AUDIT` audits — "zero frontend callers, fail-safe (can_advance FALSE)". Confirmed via `AuditWorkspaceShell`'s `STAGE_COMPONENTS` dispatch table that every file in this plan's Scope is mounted only for `workflow_type === 'VENDOR_AUDIT'` (ISA audits route to the separate `investigator/Isa*` components, untouched here) — this PR only becomes the RPC's first frontend caller for the vendor-audit path the RPC was written for, and does not touch or re-enable the deferred ISA path.
- No description/copy changes to `describeStageGateFailure`-style friendly-message helpers — out of scope; `advanceStageError`'s raw-message format (shipped in #458) is left as-is rather than introducing a second, competing formatting convention.
- `preAuditBundles` read in `FinalReviewExportWorkspace` — removed as dead code (no longer referenced once its 3 gate booleans move to the readout); not reintroduced elsewhere.
- `advanceStageError` staying a single audit-wide string in `AuditContext` (set by the last refused attempt, cleared on the next attempt or audit switch) — pre-existing #458 design, accepted: a refusal on one stage remains visible if the auditor previews another stage's pane before retrying. Making it per-stage means widening shared-infra context state; deferred until it's an observed problem.
- Adjacent pre-existing latch gaps found during review are fixed in two **separate sibling branches** (RPC-layer, migrations only, based on `main`): `sixonelabs-piqc/risk-summary-demote-on-edit` (edit demotes an APPROVED risk summary, 20260826000000) and `sixonelabs-piqc/audit-approval-latch-followups` (questionnaire approval lock + revoke-on-reopen, risk-link demote; 20260827000000/-000100). This branch carries their UI-cache half: `RiskSummaryPanel.saveEdits` and `QuestionnaireReviewWorkspace.transitionStatus` refresh `stageReadouts` after success, mirroring the approve() pattern — harmless before those migrations merge (the refresh just re-reads unchanged truth), required after (edit/reopen then changes gate state server-side). No ordering constraint between this branch and those two.

## Architecture layers touched

- [x] context (`AuditDataContext` — new `stageReadouts` shared cache)
- [x] component (6 files: read the readout, or add the missing error alert)
- [x] test
- [ ] migration / RPC / adapter — none; `audit_mode_get_stage_readout` and its TS wrapper are pre-existing and unchanged

## Mock data plan

none

## Approved-by

- @karl-dev-piqc — owns `src/components/dashboard/audit/` (all 6 component files in Scope).
- @ish-dev-piqc, @ki-dev-piqc — `src/context/` is shared infra requiring 2 reviewers per CODEOWNERS, even though `AuditDataContext.tsx` is audit-specific content; the path rule is directory-wide with no per-file carve-out.

Tag all three on the PR for review; product owner (@rv61) can merge.

## Verification

- `npm run typecheck && npm run test` clean (not run in this environment — no Node runtime available here; run on the dev machine before merge).
- `ScopeReviewWorkspace.test.tsx`: gate state (both booleans, `canAdvance`, `blockedReason`) reflects `stageReadouts`, not raw stores, even when the two disagree; fails closed ("Gate status unavailable — reload to retry.") when the readout hasn't loaded; the stage-relative `canAdvance` is ignored while previewing ahead of the audit's current stage (disabled button + explicit message); `advanceStageError` renders as `role="alert"`.
- `FinalReviewExportWorkspace.test.tsx`: pins the 5-of-7 split — risk summary / questionnaire / letter / agenda / checklist come from the readout (fail closed to unpassed when null, with an explicit "Gate status unavailable" notice); "all workspace entries classified" and "report draft approved" stay hand-derived from `workspaceEntries`/`reports`.
- Manual QA (dev machine): approve the questionnaire in Stage 3, confirm Stage 4's gate card and the Stage 8 checklist both update without a page reload (shared `stageReadouts` cache refreshed from `RiskSummaryPanel`/`QuestionnaireReviewWorkspace` approve() calls); force a stage-advance refusal on `AuditConductWorkspace` and `ReportDraftingWorkspace` and confirm the red alert now renders instead of a silent no-op.
