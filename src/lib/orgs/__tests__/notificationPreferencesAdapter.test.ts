import { describe, expect, it } from 'vitest';
import {
  adaptNotificationPreferences,
  defaultNotificationPreferences,
  type NotificationPreferencesRow,
} from '../notificationPreferencesAdapter';

const row: NotificationPreferencesRow = {
  user_id: 'u-1',
  notify_mentions_email: true,
  notify_decisions_email: false,
  daily_digest: true,
  created_at: '2026-06-04T00:00:00Z',
  updated_at: '2026-06-04T01:00:00Z',
};

describe('adaptNotificationPreferences', () => {
  it('passes every column through', () => {
    const out = adaptNotificationPreferences(row);
    expect(out.user_id).toBe('u-1');
    expect(out.notify_mentions_email).toBe(true);
    expect(out.notify_decisions_email).toBe(false);
    expect(out.daily_digest).toBe(true);
    expect(out.created_at).toBe('2026-06-04T00:00:00Z');
    expect(out.updated_at).toBe('2026-06-04T01:00:00Z');
  });
});

describe('defaultNotificationPreferences', () => {
  it('returns all-off with empty timestamps for a fresh user', () => {
    const out = defaultNotificationPreferences('u-2');
    expect(out.user_id).toBe('u-2');
    expect(out.notify_mentions_email).toBe(false);
    expect(out.notify_decisions_email).toBe(false);
    expect(out.daily_digest).toBe(false);
    expect(out.created_at).toBe('');
    expect(out.updated_at).toBe('');
  });
});
