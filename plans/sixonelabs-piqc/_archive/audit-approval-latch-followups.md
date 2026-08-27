---
owner: sixonelabs-piqc
feature: Audit Mode approval-latch follow-ups (questionnaire lock + risk-link demote)
status: merged
merged: 2026-08-27
started: 2026-08-26
target_pr: #539
---

# Audit Mode approval-latch follow-ups

## Context

Two confirmed latch-integrity gaps deferred from the risk-summary demote-on-edit PR
(plans/sixonelabs-piqc/audit-risk-summary-demote-on-edit.md "Decision debt"), now with
workflow decisions made (team decision 2026-08-26):

1. **Questionnaire → lock.** `audit_mode_upsert_questionnaire_response` (20260430150000)
   can still edit answers after `audit_mode_approve_questionnaire` stamped
   approved_at/approved_by, and the PRE_AUDIT_DRAFTING gate (20260430200000) checks only
   `qi.approved_at IS NULL`, so post-approval edits leave the gate green. The UI already
   renders approved instances read-only (QuestionnaireReviewWorkspace `readOnly = approved`),
   so the DB enforces the lock: response upserts and inconsistency-flag writes on an
   approved instance raise APPROVAL_LOCKED. Reopening is the explicit status transition,
   which now also clears approved_at/approved_by — closing the adjacent hole where
   `audit_mode_transition_questionnaire_status` could move COMPLETE → VENDOR_RESPONDED
   while leaving the approval stamps (and the gate) green.

2. **Risk-summary protocol links → demote.** `audit_mode_link_protocol_risk_to_summary` /
   `unlink` (20260430160000) mutate the junction without demoting the summary or bumping
   `vendor_risk_summary_objects.updated_at`, so neither the gate nor the approve CAS
   (20260730000000) can see it. The approver sees the linked-risk list in the panel and the
   approve dialog promises "Edits after approval revert it to Draft" — so the approval
   attests to the risk set: link/unlink on an APPROVED summary demotes to DRAFT and clears
   approved_at/approved_by. Every successful link/unlink touches the summary row, so the
   updated_at trigger fires and the approve CAS sees mid-review link changes too.
   (No UI call sites exist for these RPCs today; they are reachable via PostgREST.)

Both are new append-only migrations following the demote-on-edit pattern in
20260826000000 (branch sixonelabs-piqc/risk-summary-demote-on-edit — no function overlap,
mergeable in either order).

## Scope (files allowed)

- supabase/migrations/20260827000000_audit_mode_questionnaire_approval_lock.sql
- supabase/migrations/20260827000100_audit_mode_risk_link_demote_on_change.sql
- plans/sixonelabs-piqc/audit-approval-latch-followups.md

## Out of scope (files forbidden)

- src/lib/audit/questionnaireApi.ts, src/lib/audit/riskSummaryApi.ts — RPC signatures
  unchanged; UI is already read-only for approved questionnaires, and link/unlink have no
  component call sites, so no TS change
- src/components/dashboard/audit/** — no UI change needed
- supabase/migrations/20260430150000 / 20260430160000 / 20260730000000 — merged, append-only
- supabase/migrations/20260826000000_* — belongs to the in-review parent PR

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

None needed — only supabase/ migrations (owner: @rv61, this dev).

## Decision debt (named, deliberately deferred)

- **Approve CAS blind to response edits**: response upserts don't bump
  `questionnaire_instances.updated_at`, so `audit_mode_approve_questionnaire`'s
  STALE_CONTENT check can't see answer edits made while the reviewer reads. Fixing it
  requires the workspace to refetch the instance after each save (else approve-after-edit
  false-positives as stale) — a UI + context slice, not bundled here. The lock closes the
  post-approval half; the mid-review half remains open.
- **Stale merged plans in plans/sixonelabs-piqc/**: audit-export-readiness.md and
  audit-hardening-batch.md are still `status: active` locally though their PRs merged;
  they should be archived (they also currently win the scope-check "first active plan"
  race). Separate hygiene task.

## Verification

- [ ] Apply migrations on a dev stack.
- [ ] Questionnaire: approve an instance, then call
      `audit_mode_upsert_questionnaire_response` → error with HINT APPROVAL_LOCKED;
      same for `audit_mode_set_questionnaire_inconsistency`. Gate stays green only while
      no edits are possible.
- [ ] Transition COMPLETE → VENDOR_RESPONDED → approved_at/approved_by cleared,
      state_history_deltas records the change, advancing to PRE_AUDIT_DRAFTING now blocked
      with GATE_QUESTIONNAIRE_NOT_APPROVED; response edits allowed again.
- [ ] Pre-approval response edits behave exactly as before (no lock, statuses derive).
- [ ] Risk summary: approve, then `audit_mode_link_protocol_risk_to_summary` → returns
      true, summary row approval_status DRAFT, approved_at/approved_by NULL, updated_at
      bumped, delta records both the link and the demotion; advancing blocked with
      GATE_RISK_SUMMARY_NOT_APPROVED. Same for unlink.
- [ ] Already-linked link / no-op unlink → returns false, summary row untouched (still
      APPROVED, updated_at unchanged).
- [ ] Link/unlink on a DRAFT summary → stays DRAFT, updated_at bumped (CAS visibility).
- [ ] CI piqc-discipline checks pass.
