---
owner: ish-dev-piqc
feature: demo-protocol-picker-request-access
status: active
started: 2026-06-16
target_pr:
---

# Fix: demo protocols show "Request access" in the navbar picker

## Context

In demo mode the navbar protocol picker showed the 3 demo protocols under "Available" with a **Request access** affordance instead of as the user's own. Cause: the picker splits `protocols` (demo-aware) using real org-membership data (`myProtocolIds` / `isAnyOrgAdmin` from OrgContext, which is NOT demo-aware). Demo alias protocol ids are never in real memberships, so unless the session resolves the user as an org admin they fall into "Available" → Request access.

## Approach

`src/components/Navbar.tsx` — when `demoActive`, bypass the membership split: `mine = protocols`, `available = []`. In demo mode the list IS the fixture set and the user owns all of it, so the real-membership distinction doesn't apply. (`demoActive` already in scope from `useDemoMode()`.)

## Scope (files allowed)

- src/components/Navbar.tsx

## Out of scope

- src/context/OrgContext.tsx (real membership loading unchanged)
- src/context/ProtocolContext.tsx

## Architecture layers touched

- [x] component (`src/components/`)

## Mock data plan

None — uses the existing `demoActive` seam.

## Approved-by

- n/a — `src/components/Navbar.tsx` has no CODEOWNERS entry (shared top-level component).

## Verification

- [x] `tsc --noEmit` exit 0.
- [ ] Demo user, demo on: all 3 protocols appear as the user's own in the picker; no "Request access" shown.
