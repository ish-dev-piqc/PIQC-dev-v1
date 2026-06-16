---
owner: ish-dev-piqc
feature: demo-protocol-list-race
status: merged
merged: 2026-06-16
started: 2026-06-16
target_pr: #369
---

# Fix: demo mode shows real protocols (empty calendar) — ProtocolContext fetch race

## Context

With demo mode on (banner showing, `is_demo_user=true`), the protocol switcher showed the user's **real** protocols and the calendar/visits were empty. Root cause is an async race in `ProtocolContext`, not the demo fixtures: when `demoActive` flips, the provider re-runs `load()` while the active repo is still the **real** repo (the child effect fires before `DemoModeProvider`'s `setSiteRepo`). That slow Supabase fetch is in flight when the repo swaps; a second `load()` returns the fast in-memory demo list, but the slow real fetch resolves **afterward and overwrites it**. The picker then holds real protocols, the selected protocol id is real, and the demo repo has no data for it → empty calendar.

`SiteDataContext` already guards this with a `fetchTokenRef`; `ProtocolContext` did not. Fix mirrors that pattern.

## Approach

- `src/context/ProtocolContext.tsx` — add a monotonic `fetchTokenRef`; in `load()` capture a token and bail (`token !== fetchTokenRef.current`) after the await so only the latest fetch applies its result. No behavior change in real mode.
- Regression test reproduces the race (slow real repo in flight → swap to fast demo repo) and asserts the demo list wins. Verified it **fails without** the guard (`REAL-1,REAL-2`) and **passes with** it (`DEMO-1`).

## Scope (files allowed)

- src/context/ProtocolContext.tsx
- src/context/__tests__/ProtocolContext.race.test.tsx

## Out of scope (files forbidden)

- src/context/SiteDataContext.tsx (already guarded)
- src/components/Navbar.tsx (org-admin path already shows all protocols ungated)
- src/lib/demo/

## Architecture layers touched

- [x] context (`src/context/`)
- [x] test (`src/**/__tests__/`)

## Mock data plan

None. Uses the existing `demoActive` seam.

## Approved-by

- @ki-dev-piqc — `src/context/` is shared infra (2-reviewer: Ishika + Kiara).

## Verification

- [x] `tsc --noEmit` exit 0; context tests pass; race test fails without the guard, passes with it.
- [ ] Demo user, toggle on: switcher shows exactly PP06489 / CLR_18_06 / ND-L02-s0201-005; selecting each populates calendar/visits/Reports.
