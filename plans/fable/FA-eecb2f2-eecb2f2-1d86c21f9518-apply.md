---
owner: fable
feature: FA-eecb2f2-eecb2f2-1d86c21f9518-apply
status: active
started: 2026-07-06
target_pr:
---

# Fable apply — FA-eecb2f2-eecb2f2-1d86c21f9518

## Context

Applies findings AUD-M1, AUD-301, AUD-401 from audit run FA-eecb2f2-eecb2f2-1d86c21f9518 per
approval-FA-eecb2f2-eecb2f2-1d86c21f9518.md. Dedicated worktree, branch fable-apply/FA-1d86c21f9518.

## Scope (files allowed)

- supabase/migrations/20260719000000_audit_mode_isa_stage_gates.sql
- src/lib/audit/intakeApi.ts
- src/lib/audit/reportApi.ts
- src/lib/audit/workspaceEntriesApi.ts
- src/components/dashboard/audit/stages/AuditConductWorkspace.tsx
- src/components/dashboard/audit/stages/ReportDraftingWorkspace.tsx
- src/components/dashboard/audit/stages/IntakeWorkspace.tsx
- src/components/dashboard/audit/AuditWorkspaceShell.tsx   # scope exception, founder-approved 2026-07-06

## Out of scope (files forbidden)

- website/
- supabase/migrations/<all existing files>  # append-only — never edit merged migrations
- src/lib/entitlements.ts
- .claude/

## Architecture layers touched

- [x] migration (`supabase/migrations/`) — new file only
- [x] RPC (function replace in new migration)
- [ ] adapter
- [ ] context
- [x] component (`src/components/dashboard/audit/stages/`)
- [x] test (only if adjusting an assertion broken by the Result-shape change)

## Mock data plan

none

## Approved-by

- @rv61 — supabase/migrations/** (batch 1)
- @karl-dev-piqc — src/lib/audit/** + src/components/dashboard/audit/** (batch 2)

## Verification

- [ ] AUD-M1: new migration replaces audit_mode_stage_index with ISA_* branches and makes
      audit_mode_advance_audit_stage fail closed (RAISE) on NULL index.
- [ ] AUD-301: three api fns return discriminated results; call sites surface a visible error.
- [ ] AUD-401: IntakeWorkspace empty-state gated on !loading; loading indicator present.
- [ ] npm run typecheck / lint / test (or honest note if node unavailable locally — CI covers on PR).
- [ ] Diffs reviewed before any merge; two owner batches = two commits.
