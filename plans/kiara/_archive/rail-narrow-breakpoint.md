---
owner: ki-dev-piqc
feature: rail-narrow-breakpoint
status: merged
merged: 2026-06-13
started: 2026-06-13
target_pr: #341
---

# LeftRail breakpoint — show from sm: (640px) instead of md: (768px)

## Context

PR 1 shipped the LeftRail with `hidden md:flex` and the Navbar hamburger
with `md:hidden` — meaning anything narrower than 768px (split-screen
laptops, tablets, narrow browser windows) was forced into the hamburger
menu. That window is wider than expected, so users running anything
short of full-screen on a 14" MacBook see the hamburger by default.

User feedback: the rail should be the default unless we're actually on a
phone. Drop the threshold to `sm:` (640px) so phones still get the
hamburger but tablets / split-screen / narrow laptop windows get the
rail.

## Design

Tailwind's `sm:` breakpoint is 640px. Change every coupled `md:` /
`md:hidden` that governs the nav chrome to `sm:` / `sm:hidden`. Don't
touch `md:` breakpoints used for content layout (e.g. document preview
pane width, chat overlay desktop variant) — those remain wherever the
component author put them.

## Scope (files allowed)

### New

- `plans/kiara/rail-narrow-breakpoint.md` — this file.

### Modified

- `src/components/dashboard/LeftRail.tsx` — rail container.
- `src/components/Navbar.tsx` — desktop nav surfaces + mobile hamburger
  button + mobile menu drawer.

## Architecture layers touched

- [x] component

## Mock data plan

None.

## Approved-by

Self (Site Mode / shared chrome).

## Verification

- `npx tsc --noEmit --skipLibCheck -p tsconfig.app.json` → 0 errors
- Manual:
  - At 1024px viewport: rail visible, hamburger hidden (unchanged).
  - At 700px viewport: rail visible, hamburger hidden (NEW —
    previously hamburger was visible).
  - At 600px viewport: rail hidden, hamburger visible (unchanged
    phone behavior).
  - Devtools at 640px exactly: rail shows.

## Mechanical checks

- No `text-gray-*` etc — no new color classes.
- No `: any` in src/lib — N/A.
- Plan MD referenced in PR body.
