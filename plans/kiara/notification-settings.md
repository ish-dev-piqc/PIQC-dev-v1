---
owner: ki-dev-piqc
feature: notification-settings
status: active
started: 2026-06-04
target_pr:
---

# Notification settings — per-user preferences

## Context

PIQC ships in-app badges (mentions inbox, decision acks) but no
email surface. Coordinators don't always have the app open; they
want a way to opt-in to email pings on important events. This PR
adds the user-prefs surface — actual email-sending wiring is a
follow-up PR (it needs an edge function + chat_mentions trigger
hook + scheduled cron, all easier to review separately).

## Design

### Schema

```sql
create table public.user_notification_preferences (
  user_id                   uuid primary key references auth.users(id) on delete cascade,
  notify_mentions_email     boolean not null default false,
  notify_decisions_email    boolean not null default false,
  daily_digest              boolean not null default false,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);
```

RLS: SELECT / INSERT / UPDATE / DELETE all gated to
`user_id = auth.uid()`. No cross-user reads — even admins don't
get to see other users' prefs.

### Type

```ts
interface NotificationPreferences {
  user_id: string;
  notify_mentions_email: boolean;
  notify_decisions_email: boolean;
  daily_digest: boolean;
  created_at: string;
  updated_at: string;
}
```

### API

- `getMyNotificationPreferences()` — `Result<NotificationPreferences>`.
  Returns default values (all false) when no row exists. Doesn't
  insert; the upsert call handles that.
- `upsertMyNotificationPreferences(patch)` —
  `Result<NotificationPreferences>`. Upserts the user's row with the
  caller's `auth.uid()` server-side via RLS WITH CHECK.

### UI

Adds a `notifications` section to the Dashboard settings page.
Three toggle rows:

1. **Email me when I'm @-mentioned in chat.**
2. **Email me when a decision needs my acknowledgment.**
3. **Daily digest of unread mentions + open decisions.**

Each toggle save-on-change; no Save button. Failure surfaces a
small inline error and reverts the toggle visual.

A footer banner notes that email sending isn't live yet (it's
coming in the follow-up PR). This makes the UI honest while we
ship the prefs surface independently.

## Scope (files allowed)

### New

- `supabase/migrations/20260704000400_user_notification_preferences.sql`
- `src/lib/orgs/notificationPreferencesAdapter.ts`
- `src/lib/orgs/__tests__/notificationPreferencesAdapter.test.ts`
- `plans/kiara/notification-settings.md` — this file.

### Modified

- `src/types/orgs/index.ts` — `NotificationPreferences` type.
- `src/lib/orgs/orgsApi.ts` — two helpers.
- `src/components/dashboard/Dashboard.tsx` — add `notifications`
  section to the union, nav item, render block.

## Architecture layers touched

- [x] migration
- [x] adapter (pure)
- [x] API
- [x] component
- [x] TS type

## Mock data plan

None.

## Approved-by

- `supabase/` — Roger (new table + RLS).

## Verification

- `npx tsc --noEmit --skipLibCheck -p tsconfig.app.json` → 0 errors
- Sibling tests pass.
- Manual:
  - Settings → Notifications → all three toggles default off.
  - Toggle one → row in `user_notification_preferences` upserted.
  - Reload page → toggle state restored.
  - As user B (different auth.uid()) → can't see user A's prefs
    (RLS confirms via direct SELECT).
