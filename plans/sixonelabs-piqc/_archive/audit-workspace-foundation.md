---
owner: sixonelabs-piqc
feature: audit-workspace-foundation
status: merged
started: 2026-07-02
target_pr:
---

# Audit Workspace Foundation — two-workflow seam + workload hub

## Context

Audit Mode's vision is a single Audit Workspace where the auditor initiates a **Vendor Audit** or an
**Investigator Site Audit** workflow and manages their workload across audits. Today it's vendor-only
with a hardcoded stage pipeline and a passive audit list. This feature builds the architectural seam
(workflow-type + stage resolver) and grows the hub into a workload cockpit — **behavior-preserving for
vendor audits**. The investigator workflow itself is deferred; only the seam + a disabled chooser land
now. See the approved build plan (`~/.claude/plans/can-you-access-this-crystalline-cake.md`).

## Scope (files allowed)

- supabase/migrations/*audit_mode_workflow_type*.sql
- src/types/audit/enums.ts
- src/types/audit/objects.ts
- src/types/audit/index.ts
- src/lib/audit/workflowStages.ts
- src/lib/audit/labels.ts
- src/lib/audit/__tests__/workflowStages.test.ts
- src/context/AuditContext.tsx
- src/components/dashboard/audit/AuditWorkspaceShell.tsx
- src/components/dashboard/audit/StageNav.tsx
- src/components/dashboard/audit/AuditRequiredGate.tsx
- src/components/dashboard/audit/onboarding/NewAuditDrawer.tsx
- src/components/dashboard/audit/hub/
- src/components/dashboard/audit/__tests__/
- docs/audit/two-workflow-architecture.md

## Out of scope (files forbidden)

- src/components/dashboard/site/**, src/lib/site/**, src/components/dashboard/sotr/**, src/lib/sotr/** (mode isolation)
- supabase/functions/**audit_mode_create_audit** RPC — NOT modified; the new column defaults to
  VENDOR_AUDIT, so the disabled chooser needs no RPC change this phase.
- Any investigator-specific stage component (deferred initiative).
- The 8 vendor stage workspace components' internals (only the dispatch/nav wiring changes).

## Architecture layers touched

- [x] migration (`supabase/migrations/`)
- [ ] RPC
- [x] adapter (`src/lib/audit/workflowStages.ts` — pure resolver)
- [x] context (`src/context/AuditContext.tsx` — select `workflow_type`)
- [x] component (shell, nav, hub, initiation)
- [x] test (resolver + hub snapshot / regression)

## Mock data plan

none.

## Approved-by

- @karl — `src/**/audit/**`, `src/types/audit/**`, `src/lib/audit/**`
- @roger — `supabase/migrations/**`
- 2 reviewers — `src/context/AuditContext.tsx` (shared infra)

## Status (2026-07-02)

Foundation increment built + self-reviewed. **UI increments (chooser + workload hub) handed to the
Fable/preview session** — they need a live tsc + browser loop this build env lacks (no Node/deps).

## Verification

- [x] Stage resolver added; shell/StageNav/mobile-picker render `stagesForWorkflow(workflow_type)`; regression test pins `VENDOR_AUDIT` to the 8 stages (behavior-preserving).
- [x] `audit.workflow_type` migration (append-only, default/backfill `VENDOR_AUDIT`); TS enum + `Audit`/`AuditWithContext` mirror it; ADR written.
- [ ] `npm run typecheck` + `npm test` + `npm run dev` — **pending** (no toolchain in build env; run on a dev machine / CI).
- [ ] Hub shows workflow-segmented "My review queue" + workload counters + differentiated empty states — **Fable session**.
- [ ] Initiation shows the workflow chooser; Vendor works; Investigator disabled ("Coming soon") — **Fable session**.
