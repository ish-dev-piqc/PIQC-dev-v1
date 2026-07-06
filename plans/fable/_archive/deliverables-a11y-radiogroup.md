---
owner: fable-dev-piqc
feature: deliverables-a11y-radiogroup
status: merged
merged: 2026-07-06
started: 2026-07-05
target_pr: #447
---

# A11y: single-select pickers → radiogroup (consistency with the portfolio fix)

## Context

The portfolio-digest review (#443) confirmed a real a11y defect: a single-select
picker using `role=tablist`/`role=tab`/`aria-selected` promises screen-reader
users a tabpanel + arrow-key roving that don't exist. That was fixed on the
portfolio grid. The two sibling single-select pickers still carry the same
mismatched pattern — this makes them consistent.

## Design

- `DeliverablesOverview` (the deliverable card-grid picker) and the
  `DeliverablePanel` review-filter chip row: `role=tablist`→`radiogroup`,
  `role=tab`→`radio`, `aria-selected`→`aria-checked`. Behavior and visuals
  unchanged; only the announced ARIA role. Matches the portfolio grid exactly.
- SponsorPage's sub-tab strip (Portfolio | Protocol Intelligence) is a GENUINE
  tab set (switches panels) and stays `tablist`/`tab` — out of scope.

## Scope (files allowed)

- `plans/fable/deliverables-a11y-radiogroup.md` — this file.
- `src/components/deliverables/DeliverablesOverview.tsx` — role/aria.
- `src/components/deliverables/DeliverablePanel.tsx` — review-filter role/aria.

## Out of scope (files forbidden)

- SponsorPage sub-tabs (real tabs). Any behavior/visual change. New keyboard
  handlers (matches the portfolio grid's role-only fix; roving-tabindex is a
  larger, separate concern not taken on any of the three pickers).

## Architecture layers touched

- [ ] migration / RPC / adapter / context / test
- [x] component (ARIA roles only)

## Mock data plan

None.

## Approved-by

- No codeowner approval required — both files are `@fable-dev-piqc`.

## Verification

- [ ] typecheck / build green; suite unchanged (no test keys off these roles —
  they key off data-testids, which are untouched).
- [ ] Manual: the deliverable picker + review filter announce as a radio group
  with the active option checked; selection still works by click + Tab/Enter.

## Decisions encoded

1. **Role-only fix, consistent with #443** — match the portfolio grid's
   radiogroup/radio/aria-checked; do not add roving-tabindex (none of the three
   pickers have it, keeping them uniform).
2. **Real tabs stay tabs** — SponsorPage sub-tabs are untouched.
