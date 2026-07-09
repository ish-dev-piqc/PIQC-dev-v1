---
owner: fable
feature: fa-1a6e663-1a6e663-5746f13dedbb-apply
status: merged
started: 2026-07-07
target_pr:
---

# Fable apply — FA-1a6e663-1a6e663-5746f13dedbb (Sponsor audit)

## Context

Applies finding M1 from the full-surface sponsor audit per
approval-FA-1a6e663-1a6e663-5746f13dedbb.md: SponsorProtocolDrawer hand-rolls dismiss;
wire it onto the shared useOverlay + useSwipeDismiss hooks (same fix shape as site's
ProtocolDetailDrawer in #469; hooks stack-aware since #468).

## Scope (files allowed)

- src/components/dashboard/sponsor/SponsorProtocolDrawer.tsx

## Out of scope (files forbidden)

- src/hooks/useOverlay.ts
- src/hooks/useSwipeDismiss.ts
- src/components/dashboard/sponsor/SponsorPage.tsx
- website/
- supabase/

## Architecture layers touched

- [x] component (one file)

## Mock data plan

none

## Approved-by

- @fable-dev-piqc — sponsor components (docs/CODEOWNERS.md)

## Verification

- [ ] Drawer: Esc closes (topmost-aware), focus trapped, body scroll locked, focus restored to
      trigger on close, swipe-dismiss on the panel; ad-hoc Esc effect removed
- [ ] npm run typecheck · npm run test (scratchpad node)
