---
owner: sixonelabs-piqc
feature: findings-report-diverged-banner-copy
status: active
started: 2026-09-01
target_pr:
---

# Findings Report — divergence banner names a control that doesn't exist

## Context

The divergence banner in `FindingsReportSection` only renders when the report
is APPROVED (`diverged = approved && …`), but its copy says "re-review and
approve again to re-pin the report" — and when the report is approved, the
latch row renders the Approved badge *instead of* the Approve button, so the
control the banner names is not on screen. The real path is: **Revise
narrative → Save** (reverts to Draft and clears the pinned observation set)
**→ Approve again**. Fix the copy to name that path, using the same verbs as
the existing in-editor warning ("Saving will revert the report to Draft…").

Copy fix only. A one-click re-pin control (approve-over-approved re-seal) is
deliberately **not** in scope.

## Scope (files allowed)

- src/components/dashboard/audit/stages/FindingsReportSection.tsx
- src/components/dashboard/audit/stages/__tests__/FindingsReportSection.test.tsx

## Out of scope (files forbidden)

- src/lib/audit/findingsReport.ts (digest/latch logic — untouched)
- src/lib/audit/auditApi.ts (no RPC changes; no re-pin/approve-over-approved path)
- src/components/dashboard/audit/stages/ReportDraftingWorkspace.tsx
- src/components/dashboard/audit/stages/FinalReviewExportWorkspace.tsx

## Architecture layers touched

- [ ] migration (`supabase/migrations/`)
- [ ] RPC
- [ ] adapter
- [ ] context
- [x] component
- [x] test

## Mock data plan

none

## Approved-by

- @karl-dev-piqc (`src/components/dashboard/audit/` codeowner; both Scope files)

## Verification

- Unit: existing divergence test extended to assert the banner names the
  controls that actually exist when approved ("Revise narrative", Save →
  Draft, approve again) and no longer claims a direct re-approve control.
- `npx vitest run src/components/dashboard/audit/stages/__tests__/FindingsReportSection.test.tsx` green.
- Manual (dev to confirm): approve a findings report, change a Stage-6
  observation, reopen Stage 7 — banner describes Revise narrative → Save →
  approve again; following those steps re-pins the report.
