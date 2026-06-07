import type { NotificationPreferences } from '../../types/orgs';

// =============================================================================
// notificationPreferencesAdapter — pure mapper from raw
// user_notification_preferences row to NotificationPreferences, plus the
// default-values helper used when no row exists yet for the caller.
// =============================================================================

export interface NotificationPreferencesRow {
  user_id: string;
  notify_mentions_email: boolean;
  notify_decisions_email: boolean;
  daily_digest: boolean;
  created_at: string;
  updated_at: string;
}

export function adaptNotificationPreferences(
  row: NotificationPreferencesRow,
): NotificationPreferences {
  return {
    user_id: row.user_id,
    notify_mentions_email: row.notify_mentions_email,
    notify_decisions_email: row.notify_decisions_email,
    daily_digest: row.daily_digest,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

/** Shape returned to UI when no row exists yet — all toggles off. The
 *  user_id is the current auth user; timestamps are blanked since they
 *  don't correspond to any persisted row. */
export function defaultNotificationPreferences(
  userId: string,
): NotificationPreferences {
  return {
    user_id: userId,
    notify_mentions_email: false,
    notify_decisions_email: false,
    daily_digest: false,
    created_at: '',
    updated_at: '',
  };
}
