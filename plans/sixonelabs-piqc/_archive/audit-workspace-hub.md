---
owner: sixonelabs-piqc
feature: audit-workspace-hub
status: merged
merged: 2026-07-02
started: 2026-07-02
target_pr: #393
---

# Audit Workspace hub — workflow chooser + workload cockpit

## Context

Completes Phase 1 of the two-workflow Audit Workspace (foundation seam merged as PR #391). Two UI
increments: (1) `NewAuditDrawer` gains a workflow chooser — Vendor Audit live, Investigator Site Audit
visible but disabled ("Coming soon") so the vision is legible; (2) `AuditRequiredGate` grows from a
passive list into a workload cockpit — "needs your attention" queue first, workflow segmentation,
differentiated empty states. Derived entirely from data already in `AuditContext` — no new fetches.

## Scope (files allowed)

- src/components/dashboard/audit/AuditRequiredGate.tsx
- src/components/dashboard/audit/onboarding/NewAuditDrawer.tsx
- src/lib/audit/labels.ts
- plans/sixonelabs-piqc/audit-workspace-hub.md

## Out of scope (files forbidden)

- src/context/** (no context changes; hub derives from existing useAudit data)
- supabase/** (no schema/RPC changes; chooser is UI-only, create RPC unchanged)
- src/lib/audit/workflowStages.ts (foundation, merged)
- Any stage workspace component

## Architecture layers touched

- [ ] migration
- [ ] RPC
- [ ] adapter
- [ ] context
- [x] component (AuditRequiredGate, NewAuditDrawer)
- [ ] test

## Mock data plan

none.

## Approved-by

- @karl — `src/**/audit/**`, `src/lib/audit/labels.ts`

## Verification

- [x] New audit drawer shows the workflow pair; Vendor statically selected (no dead state — RPC unchanged, column defaults), Investigator disabled with "Coming soon".
- [x] Hub leads with "Needs your attention" (in-review + overdue audits); rows open the audit.
- [x] Workflow segment chips (All / Vendor / Investigator site) filter the list; Investigator shows an honest coming-soon empty state.
- [x] Empty states differentiated: no audits at all vs. nothing needs your attention vs. per-segment empty.
- [x] Brand tokens only; no raw gray/slate text classes introduced (grep-verified).
- [x] Adversarial 3-lens self-review (correctness / discipline / UX) run pre-PR; 0 blockers; all should-fix findings applied (formatDate UTC off-by-one, dead chooser state, stat-chip signal duplication, empty-state vocabulary).
- [ ] CI: typecheck + tests green (server-side gate).
