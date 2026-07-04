---
owner: ki-dev-piqc
feature: rail-narrow-breakpoint-v2
status: merged
merged: 2026-06-13
started: 2026-06-13
target_pr: #355
---

# LeftRail breakpoint v2 — drop to 480px

## Context

PR #341 dropped the rail/hamburger threshold from `md:` (768px) to
`sm:` (640px). That fixed most narrow-laptop cases, but a 1280px
MacBook split exactly in half lands at 640px viewport — right on the
boundary where window chrome / scrollbar reservation push the actual
content width to ~636-639px. The rail flickers off until the window
is moved a few millimeters wider.

Fix: drop to 480px, well below any standard laptop split-screen
width. Phones (iPhone 375-414px, Android 360-412px) still get the
hamburger.

## Design

Same five `sm:` flips from PR #341, replaced with the arbitrary
`min-[480px]:` Tailwind syntax. No config change needed.

| Location | Before | After |
| --- | --- | --- |
| LeftRail container | `hidden sm:flex` | `hidden min-[480px]:flex` |
| Navbar dashboard nav | `hidden sm:flex` | `hidden min-[480px]:flex` |
| Navbar marketing nav | `hidden sm:flex` | `hidden min-[480px]:flex` |
| Navbar hamburger button | `sm:hidden flex` | `min-[480px]:hidden flex` |
| Navbar mobile menu | `sm:hidden` | `min-[480px]:hidden` |

## Scope (files allowed)

### New

- `plans/kiara/rail-narrow-breakpoint-v2.md` — this file.

### Modified

- `src/components/dashboard/LeftRail.tsx`
- `src/components/Navbar.tsx`

## Architecture layers touched

- [x] component

## Mock data plan

None.

## Approved-by

Self (Site Mode / shared chrome).

## Verification

- `npx tsc --noEmit --skipLibCheck -p tsconfig.app.json` → 0 errors
- Manual:
  - MacBook 1280×800 split exactly in half (≈640px viewport) → rail
    visible, hamburger hidden (previously: hamburger visible).
  - Phone widths (iPhone SE 375px, iPhone 14 390px, iPhone 14 Pro
    Max 430px) → rail hidden, hamburger visible (unchanged).
  - Tablet 768px+ → unchanged.

## Mechanical checks

- No new color classes.
- No `: any` in `src/lib/**` — no lib edits.
- Plan MD referenced above.
