---
owner: sixonelabs-piqc
feature: status-badge-promotion
status: active
started: 2026-09-01
target_pr:
---

# Promote the Approved/Draft StatusBadge into the deliverables workbench

## Context

The Approved chip (inline-flex emerald pill, CheckCircle2, uppercase tracking-wider) now
exists in three copies: a named `StatusBadge` in ReportDraftingWorkspace, and inline
approved-arm copies in FindingsReportSection and AuditCertificateSection's latch rows.
Rule of three is met — promote `StatusBadge` into `src/components/dashboard/audit/deliverables/`
(the extracted workbench directory) and replace all three usages. Behavior-frozen
extraction: markup and props (`{approved, isLight}`) unchanged, existing workspace/section
test suites pass unchanged.

**Stacked on `sixonelabs-piqc/audit-certificate` (in-review):** the third call site only
exists on that branch, so this branch is based on it and its PR merges after the
certificate PR. Until then the PR diff shows certificate commits and CI needs a
close/reopen after the base merges.

## Scope (files allowed)

- src/components/dashboard/audit/deliverables/StatusBadge.tsx
- src/components/dashboard/audit/stages/ReportDraftingWorkspace.tsx
- src/components/dashboard/audit/stages/FindingsReportSection.tsx
- src/components/dashboard/audit/stages/AuditCertificateSection.tsx
- plans/sixonelabs-piqc/status-badge-promotion.md

## Out of scope (files forbidden)

- src/components/dashboard/audit/deliverables/DeliverableGenerationPanel.tsx
- src/components/dashboard/audit/deliverables/useDeliverable*.ts
- src/components/dashboard/audit/stages/FinalReviewExportWorkspace.tsx (its latch is a Lock panel, different markup — not a copy)
- src/components/dashboard/audit/stages/__tests__/** (behavior-frozen: suites must pass unchanged)
- src/lib/audit/** (presentation-only change)

## Architecture layers touched

- [ ] migration (`supabase/migrations/`)
- [ ] RPC (`supabase/functions/` or `.sql`)
- [ ] adapter (`src/lib/*/*Adapter.ts`)
- [ ] context (`src/context/`)
- [x] component (`src/components/`)
- [ ] test (`src/**/__tests__/`)

## Mock data plan

none

## Approved-by

- @karl-dev-piqc — for `src/components/dashboard/audit/**` (all Scope source files)

## Verification

- [ ] `grep` shows exactly one definition of the pill markup (deliverables/StatusBadge.tsx); zero inline copies remain in stages/
- [ ] ReportDraftingWorkspace, FindingsReportSection, AuditCertificateSection test suites pass unchanged (no test file edits)
- [ ] `tsc --noEmit` clean
- [ ] Visual spot-check: Approved pill and Draft pill render identically in light/dark at Stages 6/7/8
