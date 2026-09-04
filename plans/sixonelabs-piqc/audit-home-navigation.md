---
owner: sixonelabs-piqc
feature: audit-home-navigation
status: in-review
started: 2026-09-04
target_pr:
---

# Audit Mode: a way back to all audits

## Context

Once an audit is open there is no control that clears it: `setActiveAudit(null)`
(src/context/AuditContext.tsx:203-205) has zero callers, the selection persists in
`piq-audit-v1` across reloads and mode switches, and the hub that already exists
(`AuditRequiredGate` — attention queue, worklist, Start a new audit) is unreachable
until the key is cleared by hand. PR-1 of the approved protocol → risks → scope
plan; owner decision 2026-09-04: header link + top-bar picker item, not the rail.
This is the audit-level exit sitting above the stage-level prev/next stepping
shipped in #559.

## Scope (files allowed)

- src/components/dashboard/audit/AuditWorkspaceShell.tsx
- src/components/Navbar.tsx
- src/components/__tests__/Navbar.test.tsx
- plans/sixonelabs-piqc/audit-home-navigation.md

## Out of scope (files forbidden)

- src/context/AuditContext.tsx — `setActiveAudit(null)` already exists; 2-reviewer gate
- src/components/dashboard/audit/AuditRequiredGate.tsx — the hub is already built
- src/components/dashboard/audit/StageNav.tsx, MobileStagePicker.tsx — stage-level navigation (#559)
- src/components/LeftRail.tsx — rail-icon home declined by the owner
- src/components/Navbar.tsx mobile menu region (`mobileOpen` block) — untouched

## Architecture layers touched

- [ ] migration (`supabase/migrations/`)
- [ ] RPC (`supabase/functions/` or `.sql`)
- [ ] adapter (`src/lib/*/*Adapter.ts`)
- [ ] context (`src/context/`)
- [x] component (`src/components/`)
- [x] test (`src/**/__tests__/`)

## Mock data plan

none

## Approved-by

- @karl-dev-piqc — for src/components/dashboard/audit/AuditWorkspaceShell.tsx
- src/components/Navbar.tsx and src/components/__tests__/ have no CODEOWNERS entry

## Decisions

- Back link on its own line above the chip row. Not in the chip row (reads as a
  stage step and orphan-wraps at <md next to "Stage N of M"); not in the actions
  row (IA ceiling, AuditWorkspaceShell header comment).
- `handleBackToAudits` clears `pendingNewAuditId` before `setActiveAudit(null)`:
  the activation effect runs above the `!activeAudit` early return, so a parked
  id (post-create `refreshAudits()` that errored) would re-open the audit on the
  next AuditContext refetch minutes after the auditor went home.
- The audit-switch reset effect also closes the <xl Risk summary drawer — every
  other drawer/menu was reset there; this one leaked across a switch.
- No dirty-state confirm: no audit stage registers `useDirty`, and the picker /
  hub rows already switch audits unguarded. Ledgered in the chain plan.
- Picker mirrors Site Mode's "All protocols" exactly (trigger icon + label,
  "Scope" header, home option, "Your audits" sub-header) so the two modes read
  as one control.

## Verification

Static review only on this machine (no Node): CI's `npm run test` is the first
execution of the new test file. Owner walk on the deployed app after merge:

- [ ] Open an audit (vendor and investigator site) → "‹ All audits" sits on its own
      line above the stage chips → click → hub with attention queue, worklist,
      Start a new audit.
- [ ] Reload on the hub → still the hub (`piq-audit-v1` removed from localStorage).
- [ ] Top-bar picker reads "All audits" with the home icon; open → "Scope" header,
      "All audits" highlighted first, then "Your audits"; pick an audit → workspace;
      picker → All audits → hub.
- [ ] Hub → Start a new audit → lands on Stage 1 → "‹ All audits" → stays on the hub
      (no bounce-back from the parked new-audit id).
- [ ] Switch Site Mode → Audit Mode from the hub → still the hub; from inside an
      audit → still that audit.
- [ ] Vendor audit at <xl: open the Risk summary drawer → "‹ All audits" → open
      another vendor audit → the drawer is closed.
- [ ] Keyboard: Tab to "‹ All audits", Enter → hub. Screen reader name: "Back to
      all audits".
- [ ] `src/components/__tests__/Navbar.test.tsx` green in CI (3 cases: home trigger
      + selected home option; choose home from inside an audit clears + closes;
      empty library keeps the home option and "No audits yet.").
