---
owner: sixonelabs-piqc
feature: Risk summary demote-on-edit (latch integrity)
status: in-review
started: 2026-08-26
target_pr:
---

# Risk summary demote-on-edit (latch integrity)

## Context

Editing an APPROVED vendor risk summary does not demote it to DRAFT, even though the
RiskSummaryPanel UI promises exactly that ("Saving demotes to Draft"). The UPDATE branch of
`audit_mode_upsert_risk_summary` (20260430160000, never redefined) only sets
study_context / narrative / focus_areas and never touches `approval_status`, so
`approved_at` / `approved_by` keep attesting to content the approver never saw, and the
PRE_AUDIT_DRAFTING advance gate stays green. This is the same H-class latch lie that
migration 20260730000000 fixed for the report object; the three Stage-5 deliverables
(letter / agenda / checklist) already demote on edit since 20260430170000. The risk
summary was the one object the H-list missed.

## Scope (files allowed)

- supabase/migrations/20260826000000_audit_mode_risk_summary_demote_on_edit.sql
- plans/sixonelabs-piqc/audit-risk-summary-demote-on-edit.md

## Out of scope (files forbidden)

- src/lib/audit/riskSummaryApi.ts — no TS change needed; the RPC signature is unchanged and
  the panel already re-renders from the returned row (badge flips to Draft automatically)
- src/components/dashboard/audit/RiskSummaryPanel.tsx — UI copy already promises demote;
  the migration makes it true
- supabase/migrations/20260430160000_audit_mode_risk_summary_rpcs.sql — merged, append-only
- src/lib/audit/questionnaireApi.ts and questionnaire RPC migrations — adjacent gap, see debt

## Architecture layers touched

- [x] migration (`supabase/migrations/`)
- [x] RPC (`.sql`)
- [ ] adapter
- [ ] context
- [ ] component
- [ ] test

## Mock data plan

none

## Approved-by

None needed — the only code file is a supabase/ migration (owner: @rv61, this dev).

## Decision debt (named, deliberately deferred)

- **Questionnaire**: `audit_mode_upsert_questionnaire_response` can edit answers after
  `audit_mode_approve_questionnaire` stamped the instance, without demoting it. Needs a
  workflow decision (which status COMPLETE reverts to) — not bundled here.
- **Protocol-risk links**: link/unlink after approval neither demotes the summary nor bumps
  its `updated_at`, so the approve CAS cannot see it either. Workflow decision: does the
  approved narrative attest to the linked risk set?
- **Stage-readout cache**: the unmerged stage-gates branch (audit/stage-gates-v2, not on
  origin) caches `audit_mode_get_stage_readout` in AuditDataContext; when it lands, its
  RiskSummaryPanel.saveEdits should refresh that cache the same way its approve() does.

## Verification

- [ ] Apply migration; approve a risk summary (badge shows Approved, approved_at set).
- [ ] Edit narrative or focus areas and save → row returns approval_status DRAFT,
      approved_at/approved_by NULL; badge flips to Draft; advancing to
      PRE_AUDIT_DRAFTING is blocked with GATE_RISK_SUMMARY_NOT_APPROVED.
- [ ] Save with no actual change (open edit, save unmodified) → stays APPROVED.
- [ ] state_history_deltas row for the edit records the approval_status
      APPROVED→DRAFT transition alongside the content diff.
- [ ] CI piqc-discipline checks pass.
