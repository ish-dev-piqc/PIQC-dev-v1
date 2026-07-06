import type { DeliverablePacketBlock } from '../../types/deliverables';

// =============================================================================
// blockReviewFilter — the panel's client-side review focus. Pure (no React, no
// I/O) so the filter buckets + counts are testable without rendering, and the
// panel just consumes them.
//
// Buckets follow the same "open work" definition as the overview board + the
// export PDF stats: needs_review = draft + needs_review (a fresh never-reviewed
// draft is open, not done). 'reviewed' and 'edited' isolate their own states.
// human_added / rejected blocks show only under 'all' — rejected is already
// excluded from the packet, and a human-added block is authored, not pending.
// =============================================================================

export type ReviewFilter = 'all' | 'needs_review' | 'reviewed' | 'edited';

/** Ordered filter chips + labels (chip order in the panel). */
export const REVIEW_FILTERS: ReadonlyArray<{ key: ReviewFilter; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'needs_review', label: 'Needs review' },
  { key: 'reviewed', label: 'Reviewed' },
  { key: 'edited', label: 'Edited' },
];

export function matchesReviewFilter(
  block: Pick<DeliverablePacketBlock, 'review_state'>,
  filter: ReviewFilter,
): boolean {
  switch (filter) {
    case 'all':
      return true;
    case 'needs_review':
      return block.review_state === 'draft' || block.review_state === 'needs_review';
    case 'reviewed':
      return block.review_state === 'reviewed';
    case 'edited':
      return block.review_state === 'edited';
  }
}

/** The visible subset for a filter. 'all' returns the input reference so the
 *  common path allocates nothing. */
export function filterBlocks(
  blocks: DeliverablePacketBlock[],
  filter: ReviewFilter,
): DeliverablePacketBlock[] {
  return filter === 'all' ? blocks : blocks.filter((b) => matchesReviewFilter(b, filter));
}

/** Count per bucket for the chip badges + the header progress. `all` is the
 *  total; the three state buckets are disjoint (a block lands in at most one). */
export function reviewFilterCounts(
  blocks: DeliverablePacketBlock[],
): Record<ReviewFilter, number> {
  const counts: Record<ReviewFilter, number> = {
    all: blocks.length,
    needs_review: 0,
    reviewed: 0,
    edited: 0,
  };
  for (const b of blocks) {
    if (b.review_state === 'draft' || b.review_state === 'needs_review') counts.needs_review += 1;
    else if (b.review_state === 'reviewed') counts.reviewed += 1;
    else if (b.review_state === 'edited') counts.edited += 1;
  }
  return counts;
}
