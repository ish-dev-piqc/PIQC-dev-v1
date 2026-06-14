---
owner: ki-dev-piqc
feature: site-mode-empty-state-polish
status: active
started: 2026-06-13
target_pr:
---

# Site Mode polish — empty-state CTAs

## Context

Reduced from the original "Site Mode visual polish sweep" after a
recon pass. Three findings:

1. **Loading skeletons** — Site Mode tabs render from `useSiteData`
   which loads once at app boot. No tab-level loading states exist
   to skeleton-ify. Dropped from scope.
2. **Mobile responsive** — most toolbars already use `flex-wrap`,
   stat cards use `grid-cols-2 sm:grid-cols-4`, and recent PRs
   dropped the rail/hamburger threshold to `sm:`. Site Mode looks
   reasonable on narrow viewports already. Dropped from scope.
3. **Empty states** — exist with thoughtful copy, but the two most
   common "you've never done X" states (no visits scheduled yet, no
   participants added yet) are bare text. Both have an "Add" button
   at the top of the page, but a coordinator looking at an empty
   list shouldn't have to scroll back up to discover it.

This PR adds inline CTA buttons to the two key empty states.

## Design

### VisitsTab empty state

When `scoped.length === 0` (no visits on this protocol at all),
the empty card adds a primary "Schedule a visit" button below the
current copy. Same handler as the existing top-of-page button.

### ParticipantsTab empty state

When `scoped.length === 0`, the existing empty card adds a primary
"Add participant" button below the copy. Same handler as the top
button.

Both buttons live inside the existing dashed-border placeholder
card, centered. No new components.

## Scope (files allowed)

### New

- `plans/kiara/site-mode-empty-state-polish.md` — this file.

### Modified

- `src/components/dashboard/site/VisitsTab.tsx` — CTA in empty state.
- `src/components/dashboard/site/ParticipantsTab.tsx` — same.

## Architecture layers touched

- [x] component

## Mock data plan

None.

## Approved-by

Self (Site Mode).

## Verification

- `npx tsc --noEmit --skipLibCheck -p tsconfig.app.json` → 0 errors
- Manual:
  - Open a protocol with zero visits → VisitsTab empty card shows
    a "Schedule a visit" button. Click → existing visit-form drawer
    opens.
  - Open a protocol with zero participants → ParticipantsTab empty
    card shows an "Add participant" button. Click → existing form
    drawer opens.
  - With visits/participants present → no change in behavior.

## Mechanical checks

- No new `.channel(` outside `src/context/`.
- No `@supabase/supabase-js` imports in components.
- No `: any` in `src/lib/**` — no lib edits.
- Plan MD referenced above.
