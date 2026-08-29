---
owner: fable-dev-piqc
feature: review-filter-progress
status: merged
merged: 2026-07-06
started: 2026-07-05
target_pr: #439
---

# Review-loop efficiency — panel filter + progress

## Context

The overview board surfaces the backlog ("25 need review"); this slice makes it
fast to clear. DeliverablePanel renders every block always and shows no progress,
so a reviewer working a long deliverable can't focus on what's outstanding.
Adds a client-side review FILTER + a reviewed/total progress in the panel header
— the "humans review, don't re-type" / collapse-cognitive-load north star made
faster. Founder decision (2026-07-05): filter + progress only, NO bulk
"mark section reviewed" write (per-item sign-off stays deliberate).

## Design

- **Pure `blockReviewFilter.ts`**: `ReviewFilter = all | needs_review | reviewed
  | edited`; `matchesReviewFilter`, `filterBlocks` ('all' returns the same ref),
  `reviewFilterCounts` (all=total; the three state buckets disjoint). needs_review
  = OPEN work (draft + needs_review), matching the board + PDF stats. human_added
  / rejected show only under 'all'. Unit-tested (mockless).
- **DeliverablePanel** (the only React change): a `reviewFilter` state (not reset
  on protocol/artifact switch — a reviewer's focus is theirs); a reviewed/total
  progress bar in the header card (emerald fill + "N need review" in amber when
  >0, aria progressbar); a filter chip row (segmented, neutral selected style so
  it reads right in both the Sponsor purple + CRA amber surfaces) with per-bucket
  counts; the block list receives the FILTERED blocks (empty sections drop out
  via the existing groupBlocksBySection); an all-clear empty state when a filter
  matches nothing. DeliverableBlockList is UNCHANGED (filtering is upstream).

## Scope (files allowed)

- `plans/fable/review-filter-progress.md` — this file.
- `src/components/deliverables/blockReviewFilter.ts` — NEW pure module.
- `src/components/deliverables/__tests__/blockReviewFilter.test.ts` — NEW.
- `src/components/deliverables/DeliverablePanel.tsx` — filter state + progress + filter row + filtered list.

## Out of scope (files forbidden)

- No bulk "mark reviewed" write (founder call). No new RPC / migration.
- `DeliverableBlockList.tsx` — unchanged (filtering happens upstream in the panel).
- The overview board, selection specs, export layer, other modes.

## Architecture layers touched

- [ ] migration / RPC / adapter / context
- [x] component (panel filter + progress)
- [x] test (pure filter buckets + counts)

## Mock data plan

None.

## Approved-by

- No non-Fable codeowner — both files are under `src/components/deliverables/`
  (`@fable-dev-piqc`). No migration, no shared-infra file.

## Verification

- [x] typecheck / build green; 9 new filter tests pass; full suite 19 failed /
  1050 passed — the same pre-existing baseline, zero new failures.
- [x] Adversarial review (3 lenses): filter logic / integration / product clean
  on substance; 2 confirmed low UX papercuts, both fixed — (a) empty-state copy
  claimed "every item reviewed or edited" on a zero-item deliverable (now gated
  on reviewCounts.all > 0 → "No items in this deliverable."); (b) adding a block
  under a non-'all' filter created a human_added block that matched no filter and
  vanished (now the filter drops back to 'all' on add so it stays visible).
- [ ] Manual: header shows reviewed/total + progress bar + "N need review";
  filter chips narrow the list (Needs review / Reviewed / Edited) with counts;
  'all' shows everything; a filter with no matches shows the all-clear state;
  marking an item reviewed moves it between buckets and updates the progress;
  filter persists across protocol/type switches.
- [ ] `/piqc-review` clean (no `any`, semantic tokens, DeliverableBlockList
  untouched, no fetch in the pure module).

## Decisions encoded

1. **Filter is upstream, list stays pure** — the panel filters; DeliverableBlockList
   is unchanged. Empty sections drop out via the existing grouping.
2. **needs_review = open work** — same definition as the board + PDF stats, so
   the three surfaces agree on "what's left".
3. **Neutral selected chip** — the panel is shared (Sponsor + CRA); the filter's
   selected style is the panel's neutral action color, not a surface accent.
4. **No bulk write** (founder) — per-item review stays deliberate; the filter is
   a read-only focus tool.
