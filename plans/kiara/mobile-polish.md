---
owner: ki-dev-piqc
feature: mobile-polish
status: active
started: 2026-06-04
target_pr:
---

# Mobile polish (PR 6 of 6)

## Context

The workspace-first refactor (PRs 1–5) targeted desktop. Mobile
users currently get a too-narrow LeftRail crowding the canvas and
a right-side chat overlay that covers their work. This PR makes
the new chrome behave well at phone widths.

## Design

### LeftRail — hide on mobile

Below the `md` breakpoint (768px), the rail is hidden. Mobile
users get mode-switching through the Navbar's existing mobile
menu, which gains a new "Workspace" section listing the same
five entries (Workspace · Site · Audit · Sponsor · Chat) with
icons + labels.

The desktop rail stays unchanged. The mobile menu mirrors its
behavior: clicking Site / Audit toggles mode and lands on the
right tab; Workspace routes to OrganizationPage; Sponsor routes
to the sponsor placeholder; Chat opens the overlay.

### ChatOverlayPanel — bottom sheet on mobile

Below `md`, the overlay becomes a slide-up bottom sheet:
full-width, 85% viewport height, top-rounded, with a small drag
handle visual at the top. ESC + outside click still dismiss.

Above `md`, current right-side slide is unchanged.

### Hub grids — responsive

Today tab stats row + mode tiles + Documents tab pinned board
were all `grid-cols-3` — they crush below ~480px. Change to
`grid-cols-1 sm:grid-cols-3` so they stack vertically on phone.
Documents toolbar already wraps; verify it stays usable.

### Sponsor coming-soon

Padding tweaks to keep the page comfortable at narrow widths.
The form input + button switch from side-by-side to stacked
below `sm`.

## Scope (files allowed)

### New

- `plans/kiara/mobile-polish.md` — this file.

### Modified

- `src/components/dashboard/LeftRail.tsx` — `hidden md:flex`.
- `src/components/Navbar.tsx` — add Workspace section to mobile menu.
- `src/components/dashboard/chat-overlay/ChatOverlayPanel.tsx` —
  responsive container.
- `src/components/dashboard/organization/HubTodayTab.tsx` —
  responsive grids.
- `src/components/dashboard/organization/HubDocumentsTab.tsx` —
  responsive grids + toolbar.

## Architecture layers touched

- [x] component

## Mock data plan

None.

## Approved-by

Self.

## Verification

- `npx tsc --noEmit --skipLibCheck -p tsconfig.app.json` → 0 errors
- Manual (Chrome DevTools → iPhone 14 viewport):
  - LeftRail not visible. Hamburger menu shows Workspace section.
  - Tap Chat in mobile menu → overlay slides up from bottom,
    full width, ~85% of viewport.
  - Hub stats row + mode tiles stack vertically.
  - Documents tab toolbar wraps; filter pills stay touchable.
  - Sponsor form is stacked (email + button on separate lines).
- Desktop unchanged from PR 5.
