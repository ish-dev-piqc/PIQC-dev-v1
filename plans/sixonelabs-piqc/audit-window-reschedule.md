---
owner: sixonelabs-piqc
feature: Audit window & reschedule (PR-UX1) — scheduled_end_date + reschedule RPC + header popover
status: in-review
started: 2026-08-30
target_pr:
---

# Audit window & reschedule (PR-UX1)

## Context

Product-owner report (2026-08-30): audit dates can't be reset though real audits get rescheduled, and a date should optionally be a window (from dd/mm/yy to dd/mm/yy). Code-verified: `audits.scheduled_date DATE` is written exactly once at creation (`audit_mode_create_audit`, current 7-param version in `20260709000100`), **no update path exists anywhere** — no RPC, no API writer, no UI — and there is no end-date column, so a 3-day on-site audit cannot be represented. Rescheduling is an expected workflow event (v8 convention: generated deliverables describe dates as PROPOSED until the auditee confirms), which makes an immutable date a real defect.

Smallest safe change: one append-only migration (column + CHECK + `audit_mode_reschedule_audit` + create-RPC extension), the DB→TS mirror, an optional end-date field in the New-audit drawer, and a small reschedule popover opened from a new date line in the workspace header — no new always-on actions-row button (the header IA ceiling from #555 stands; the date itself is the affordance).

Key posture decision: the reschedule RPC is **SECURITY DEFINER and becomes the sole writer of both date columns** — the migration restates the column grant as `GRANT UPDATE (audit_name, status)` (dropping `scheduled_date`, never granting `scheduled_end_date`), continuing `20260721000100`'s doctrine that a provenance-relevant column's every change necessarily writes its `'AUDIT'` delta. Nothing in `src/` PATCHes audits directly (verified — reads only), so nothing breaks. Companion in this same PR: `20260903000000` (plan: audit-lock-name-status-columns.md) then revokes the remaining `(audit_name, status)` grant too — folded in on 2026-08-30 to avoid a cross-PR merge-order dependency; final state is no client UPDATE privilege on `audits` at all.

Because `'AUDIT'` deltas have no UI surface today (no `HistoryDrawer` mount uses that object type — stage-advance deltas are already written but invisible), the Records menu gains a 5th item, "Audit history", mounting the existing generic `HistoryDrawer` with `objectType="AUDIT"`. Trigger-only IA, same as #555.

## Scope (files allowed)

### New

- supabase/migrations/20260902000000_audit_scheduled_window.sql
- src/lib/audit/dateWindow.ts
- src/lib/audit/__tests__/dateWindow.test.ts
- src/components/dashboard/audit/RescheduleAuditPopover.tsx
- src/components/dashboard/audit/__tests__/RescheduleAuditPopover.test.tsx
- plans/sixonelabs-piqc/audit-window-reschedule.md — this file.

### Modified

- src/types/audit/objects.ts — `Audit` gains `scheduled_end_date` (DB→TS mirror)
- src/context/AuditContext.tsx — field through the row type, `AuditWithContext`, `flatten()`, select list
- src/context/__tests__/AuditContext.advanceStageError.test.tsx — fixture completeness only
- src/lib/audit/auditCreationApi.ts — `createAudit` input + RPC param + `AuditRow`
- src/lib/audit/auditApi.ts — new `rescheduleAudit` wrapper (advanceAuditStage result shape)
- src/lib/audit/isaReportModel.ts — comment on `auditDate` only
- src/lib/audit/__tests__/lineageApi.test.ts — fixture completeness only
- src/lib/audit/__tests__/lineageAdapter.test.ts — fixture completeness only
- src/components/dashboard/audit/onboarding/NewAuditDrawer.tsx — optional end-date field
- src/components/dashboard/audit/onboarding/__tests__/NewAuditDrawer.test.tsx — first date-field case
- src/components/dashboard/audit/AuditWorkspaceShell.tsx — header date line, popover mount, Records "Audit history"
- src/components/dashboard/audit/AuditRequiredGate.tsx — window-aware overdue + window display
- src/components/dashboard/audit/__tests__/AuditRequiredGate.test.tsx — overdue-with-window cases
- src/components/dashboard/audit/stages/FinalReviewExportWorkspace.tsx — export lines render the window
- src/components/dashboard/audit/stages/investigator/IsaReportWorkspace.tsx — pre-formatted `auditDate`

## Out of scope (files forbidden)

- src/context/** other than AuditContext.tsx + its listed test
- supabase/functions/** (no engine changes; deliverable date-drift currency is deferred debt)
- Stage workspaces other than the two export consumers listed
- Stage-5 prefill migration/template (merged; append-only rule; single-date wording still valid)
- Editable `audit_name` / `audit_type` post-intake (deliberately dates-only, per v8 gate-bypass reasoning)
- StageNav / MobileStagePicker / navigation affordances (that's PR-UX2)

## Architecture layers touched

- [x] migration (`supabase/migrations/`)
- [x] RPC (in-database functions; no edge functions)
- [ ] adapter (`src/lib/*/*Adapter.ts`)
- [x] context (`src/context/AuditContext.tsx`)
- [x] component
- [x] test

## Mock data plan

None. Real Supabase data only; existing rows are valid under the new CHECK without backfill.

## Approved-by

- @karl-dev-piqc — for src/lib/audit/**, src/components/dashboard/audit/**, src/types/audit/**
- @roger — for supabase/migrations/ (append-only; new migration file only)
- Shared-infra note: src/context/AuditContext.tsx requires 2 reviewers on the PR.

## Verification (expand before review)

- CI green — **first execution of typecheck + tests + mechanical checks (no Node/tsc/vitest on the authoring machine)**.
- **Deploy order is one-directional: apply migration 20260902000000 BEFORE deploying the frontend.** The context select and createAudit params name `scheduled_end_date`; a frontend deployed first takes all of Audit Mode down (missing column on every SELECT, PGRST202 on create). Migration-first is safe — old clients' 7 named args still resolve against the 8-param create RPC via the default.
- Unit (new): `dateWindow` formatting (UTC `T00:00:00` anchor, cross-month, cross-year, null end, null start); `AuditRequiredGate` overdue respects `(end ?? start)`; `NewAuditDrawer` submits `scheduledEndDate`; popover save / end-before-start validation / clear-dates path.
- E2E (user, after deploy — migration cannot execute locally): create audit with window → header date line shows range → reschedule via popover → delta visible under Records → Audit history → overdue chip respects end date → Stage-8 export renders the window → single-date and no-date audits unaffected → clearing dates records a delta.
