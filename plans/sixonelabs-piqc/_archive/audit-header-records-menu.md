---
owner: sixonelabs-piqc
feature: Header IA pass — the four record surfaces collapse into one Records dropdown
status: merged
merged: 2026-08-30
started: 2026-08-30
target_pr: #555
---

# Header Records menu (IA pass)

## Context

The audit header actions row blew past its documented ceiling when the Evidence button landed (PR-B, the comment in `AuditWorkspaceShell` says so). The four record surfaces — Protocol source, Traceability, Issues & CAPA, Evidence — all answer "show me this audit's records/provenance" and now collapse into one **Records** dropdown (product-owner decision: strongest cognitive-load collapse, one extra click accepted). The row becomes: stage picker (mobile) · New audit · Records · Risk summary (xl-hidden, vendor). Drawer components, their state, and their mounts are untouched — only the trigger surface changes. The menu uses the lightweight local pattern (backdrop for outside-click, wrapper Escape) — deliberately NOT `useOverlay`, which locks body scroll and traps focus (drawer semantics, wrong for a dropdown).

## Scope (files allowed)

- src/components/dashboard/audit/AuditWorkspaceShell.tsx (four buttons → one Records menu; ceiling comment updated to describe the landed state)
- plans/sixonelabs-piqc/audit-header-records-menu.md (this file)
- plans/sixonelabs-piqc/_archive/* (step-0: two completed plans archived)

## Out of scope (files forbidden)

- All four drawer components and their open-state/mount logic (trigger-only change)
- EvidenceOpenContext and the stage affordances (Stage-3 line, Stage-5 chip open the drawer as before)
- src/hooks/useOverlay.ts (drawer semantics; not for menus)
- New audit button, MobileStagePicker, Risk summary button, PiqcDock

## Architecture layers touched

- [ ] migration / RPC / adapter / context
- [x] component (`src/components/`) — one file
- [ ] test — the shell has no test file (house convention); menu behavior is manual-QA'd per below

## Mock data plan

none

## Approved-by

- @karl-dev-piqc — for src/components/dashboard/audit/AuditWorkspaceShell.tsx

## Verification

CI-first: no Node/npm/tsc/vitest on the authoring machine — CI is where the typecheck first runs.

- [ ] CI green
- [ ] Staging: Records opens the menu; each item opens its drawer and closes the menu; Escape and outside-click close the menu
- [ ] Staging: Protocol source item disabled (with title copy) when the audit has no protocol — unreachable today, kept as insurance like the button it replaces
- [ ] Staging: menu closes on audit switch; both workflow types show the same menu; existing data-testids preserved on the menu items
- [ ] Staging: below md the row still wraps cleanly (now 3 controls instead of 6)
