import { describe, expect, it } from 'vitest';
import { adaptNotice, adaptNotices } from '../actionsAdapter';

// =============================================================================
// actionsAdapter (notices) — defensive mapping of protocol_notices_get JSON.
// Same contract as the card mappers: malformed entries are skipped, the closed
// status enum is whitelisted, but notice_type is INTENTIONALLY not whitelisted
// (the server owns the taxonomy — a new kind must render, not vanish).
// =============================================================================

const baseNotice = {
  id: 'notice-1',
  protocol_id: 'prot-1',
  notice_type: 'tight_visit_window',
  severity: 1,
  headline: 'Tight visit windows',
  detail:
    '3 visits allow 2 days or less of scheduling tolerance — protocol deviations are easy to trigger here.',
  observed_count: 3,
  protocol_evidence_ids: ['ev-1', 'ev-2'],
  status: 'active',
  created_at: '2026-07-08T12:00:00Z',
  updated_at: '2026-07-08T12:00:00Z',
};

describe('adaptNotice', () => {
  it('round-trips a full notice', () => {
    const notice = adaptNotice(baseNotice);
    expect(notice).not.toBeNull();
    expect(notice?.notice_type).toBe('tight_visit_window');
    expect(notice?.severity).toBe(1);
    expect(notice?.observed_count).toBe(3);
    expect(notice?.protocol_evidence_ids).toEqual(['ev-1', 'ev-2']);
    expect(notice?.status).toBe('active');
  });

  it('accepts an unknown notice_type (server owns the taxonomy)', () => {
    const notice = adaptNotice({ ...baseNotice, notice_type: 'brand_new_kind' });
    expect(notice?.notice_type).toBe('brand_new_kind');
  });

  it('accepts both status values and rejects anything else', () => {
    expect(adaptNotice({ ...baseNotice, status: 'active' })?.status).toBe('active');
    expect(adaptNotice({ ...baseNotice, status: 'dismissed' })?.status).toBe('dismissed');
    expect(adaptNotice({ ...baseNotice, status: 'acted' })).toBeNull();
    expect(adaptNotice({ ...baseNotice, status: null })).toBeNull();
  });

  it('rejects entries missing required fields', () => {
    expect(adaptNotice({ ...baseNotice, id: null })).toBeNull();
    expect(adaptNotice({ ...baseNotice, notice_type: '' })).toBeNull();
    expect(adaptNotice({ ...baseNotice, headline: 7 })).toBeNull();
    expect(adaptNotice({ ...baseNotice, detail: undefined })).toBeNull();
  });

  it('sorts a missing/garbage severity LAST (large fallback, not 0)', () => {
    expect(adaptNotice({ ...baseNotice, severity: 'high' })?.severity).toBe(
      Number.MAX_SAFE_INTEGER,
    );
    expect(adaptNotice({ ...baseNotice, severity: undefined })?.severity).toBe(
      Number.MAX_SAFE_INTEGER,
    );
    expect(adaptNotice({ ...baseNotice, severity: NaN })?.severity).toBe(
      Number.MAX_SAFE_INTEGER,
    );
  });

  it('degrades a garbage observed_count to 0 and filters bad evidence ids', () => {
    const notice = adaptNotice({
      ...baseNotice,
      observed_count: 'lots',
      protocol_evidence_ids: ['ev-1', null, 9, ''],
    });
    expect(notice?.observed_count).toBe(0);
    expect(notice?.protocol_evidence_ids).toEqual(['ev-1']);
  });

  it('rejects non-object payloads', () => {
    expect(adaptNotice(null)).toBeNull();
    expect(adaptNotice(42)).toBeNull();
    expect(adaptNotice(['notice-1'])).toBeNull();
  });
});

describe('adaptNotices', () => {
  it('skips malformed entries and keeps valid siblings', () => {
    const notices = adaptNotices([baseNotice, null, 42, { ...baseNotice, id: null }]);
    expect(notices).toHaveLength(1);
    expect(notices[0].id).toBe('notice-1');
  });

  it('adapts a non-array payload to an empty list', () => {
    expect(adaptNotices(null)).toEqual([]);
    expect(adaptNotices({})).toEqual([]);
  });
});
