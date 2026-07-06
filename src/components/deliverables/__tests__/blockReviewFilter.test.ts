import { describe, expect, it } from 'vitest';
import type { DeliverablePacketBlock } from '../../../types/deliverables';
import {
  REVIEW_FILTERS,
  filterBlocks,
  matchesReviewFilter,
  reviewFilterCounts,
  type ReviewFilter,
} from '../blockReviewFilter';

// A block with only the field the filter reads — the rest is irrelevant here.
const b = (id: string, review_state: DeliverablePacketBlock['review_state']) =>
  ({ id, review_state }) as DeliverablePacketBlock;

const SAMPLE: DeliverablePacketBlock[] = [
  b('1', 'draft'),
  b('2', 'needs_review'),
  b('3', 'reviewed'),
  b('4', 'reviewed'),
  b('5', 'edited'),
  b('6', 'human_added'),
];

describe('matchesReviewFilter', () => {
  it("'all' matches every state", () => {
    for (const block of SAMPLE) expect(matchesReviewFilter(block, 'all')).toBe(true);
  });

  it("'needs_review' is open work = draft + needs_review", () => {
    expect(matchesReviewFilter(b('x', 'draft'), 'needs_review')).toBe(true);
    expect(matchesReviewFilter(b('x', 'needs_review'), 'needs_review')).toBe(true);
    expect(matchesReviewFilter(b('x', 'reviewed'), 'needs_review')).toBe(false);
    expect(matchesReviewFilter(b('x', 'edited'), 'needs_review')).toBe(false);
    expect(matchesReviewFilter(b('x', 'human_added'), 'needs_review')).toBe(false);
  });

  it("'reviewed' and 'edited' isolate their own state", () => {
    expect(matchesReviewFilter(b('x', 'reviewed'), 'reviewed')).toBe(true);
    expect(matchesReviewFilter(b('x', 'edited'), 'reviewed')).toBe(false);
    expect(matchesReviewFilter(b('x', 'edited'), 'edited')).toBe(true);
    expect(matchesReviewFilter(b('x', 'reviewed'), 'edited')).toBe(false);
  });
});

describe('filterBlocks', () => {
  it("'all' returns the same reference (no allocation on the common path)", () => {
    expect(filterBlocks(SAMPLE, 'all')).toBe(SAMPLE);
  });

  it('narrows to the bucket for each non-all filter', () => {
    expect(filterBlocks(SAMPLE, 'needs_review').map((x) => x.id)).toEqual(['1', '2']);
    expect(filterBlocks(SAMPLE, 'reviewed').map((x) => x.id)).toEqual(['3', '4']);
    expect(filterBlocks(SAMPLE, 'edited').map((x) => x.id)).toEqual(['5']);
  });

  it('returns [] when nothing matches', () => {
    expect(filterBlocks([b('x', 'human_added')], 'needs_review')).toEqual([]);
  });
});

describe('reviewFilterCounts', () => {
  it('all = total; state buckets are disjoint and sum to the non-human/added rows', () => {
    const c = reviewFilterCounts(SAMPLE);
    expect(c).toEqual({ all: 6, needs_review: 2, reviewed: 2, edited: 1 });
    // human_added (id 6) is counted only in `all`.
    expect(c.needs_review + c.reviewed + c.edited).toBe(5);
  });

  it('handles an empty deliverable', () => {
    expect(reviewFilterCounts([])).toEqual({ all: 0, needs_review: 0, reviewed: 0, edited: 0 });
  });
});

describe('REVIEW_FILTERS', () => {
  it('leads with All and every key is a valid ReviewFilter', () => {
    expect(REVIEW_FILTERS[0].key).toBe('all');
    const keys = REVIEW_FILTERS.map((f) => f.key);
    expect(keys).toEqual(['all', 'needs_review', 'reviewed', 'edited'] satisfies ReviewFilter[]);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
