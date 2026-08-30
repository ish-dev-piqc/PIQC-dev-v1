---
owner: sixonelabs-piqc
feature: Lock audits.audit_name + audits.status columns (V1 residue)
status: in-review
started: 2026-08-30
target_pr:
---

# Lock audits.audit_name + audits.status columns (V1 residue)

## Context

Product-owner decision (2026-08-30), option (a) of the audits-grant review: revoke the last
column-level UPDATE grant on `audits` for `authenticated`. `20260721000100` closed V1 for
`current_stage` but re-granted `(audit_name, status, scheduled_date)`; PR-UX1's unmerged
`20260902000000` narrows that to `(audit_name, status)`. Code-verified 2026-08-30: **nothing
in `src/` PATCHes `audits`** (all `.from('audits')` uses on main and on the PR-UX1 branch are
`.select()`s), and every `UPDATE audits` statement in the repo lives inside SECURITY DEFINER
RPCs (`audit_mode_advance_audit_stage` — latest restatement `20260730000000`:845–852 —
and PR-UX1's `audit_mode_reschedule_audit`). The grant is therefore unused — but `status`
drives overdue logic and the REVIEW/CLOSED lifecycle, and a direct PATCH would leave no
`state_history_deltas` row: the exact vulnerability class `20260721000100` was written to
close. Revoking now forces any future close-audit / rename feature through a delta-writing
RPC by construction. Zero breakage today.

## Merge-order dependency — resolved by folding into PR-UX1

Originally authored as a separate branch off main, which created a fragile merge-order
dependency: `20260902000000` runs `REVOKE UPDATE ON audits ...; GRANT UPDATE (audit_name,
status) ...` at apply time — applied *after* this revoke, it would re-open the hole.
**Folded into PR-UX1 (`sixonelabs-piqc/audit-window-reschedule`) on 2026-08-30** to remove
that hazard: within one PR, migration version order (`20260902` → `20260903`) guarantees
the revoke applies last, and the net state is no UPDATE privilege on `audits` for
`authenticated`/`anon` at all.

## Scope (files allowed)

- supabase/migrations/20260903000000_audit_mode_lock_name_status_columns.sql
- plans/sixonelabs-piqc/audit-lock-name-status-columns.md

## Out of scope (files forbidden)

- supabase/migrations/20260721000100_audit_mode_lock_current_stage_column.sql (merged; append-only)
- supabase/migrations/20260902000000_audit_scheduled_window.sql (PR-UX1's file — same branch after the fold, still not edited by this work)
- src/** — no type impact: grants only, no table/column/enum/RPC-signature change
- RLS policy `audits_update_lead_auditor` (`20260427120100`) — left in place, inert for
  `authenticated` once the privilege is gone; future re-grants would want it back

## Architecture layers touched

- [x] migration (`supabase/migrations/`)
- [ ] RPC
- [ ] adapter
- [ ] context
- [ ] component
- [ ] test

## Mock data plan

none

## Approved-by

- @rv61 — `supabase/` (self; codeowner per docs/CODEOWNERS.md)
- @karl-dev-piqc — domain courtesy: no Karl-owned file is in Scope, but the change
  constrains how Audit Mode may ever write `audits.audit_name` / `audits.status`
  (RPC-only from here on). Tag on the PR.

## Verification

No local Postgres/Node — CI + staging verification (never blur "verified" vs "reviewed"):

- [ ] Statically reviewed: no `.update(` / PATCH on `audits` anywhere in `src/`; all
      `UPDATE audits` in migrations are inside SECURITY DEFINER functions (done 2026-08-30)
- [ ] After staging deploy: authenticated `PATCH /rest/v1/audits?id=eq.<own-audit>`
      with `{"status":"CLOSED"}` returns 42501 permission-denied (likewise `audit_name`)
- [ ] Regression: `audit_mode_advance_audit_stage` still advances a gated stage and
      writes its `state_history_deltas` row
- [ ] Regression (post-PR-UX1): `audit_mode_reschedule_audit` still reschedules
- [ ] Audit list still loads (SELECT grants untouched)
