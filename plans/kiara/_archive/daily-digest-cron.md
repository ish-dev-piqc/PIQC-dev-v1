---
owner: ki-dev-piqc
feature: daily-digest-cron
status: merged
merged: 2026-06-13
started: 2026-06-13
target_pr: #343
---

# Daily digest cron — morning roll-up email

## Context

`user_notification_preferences.daily_digest` exists since migration
`20260704000400`, but no job sends the digest. PR 101 wired
mention + decision emails via the existing `send-notification-email`
edge function but left the digest as a follow-up.

This PR ships the cron + edge function + Vault-secret read pattern so
users who opted in get a 9am-ET morning roll-up of: unread mentions,
decisions awaiting their ack, and overdue deviation sign-offs.

## Design

### Architecture (mirrors `ingest-recover-safety-net`)

- pg_cron job `daily-digest-send` runs once a day at 13:00 UTC
  (~9:00am ET / 6:00am PT).
- The cron entry POSTs to `/functions/v1/send-daily-digest` with a
  service-role JWT (Vault: `service_role_key`).
- The edge function loops users where `daily_digest = TRUE`,
  computes their three buckets, and sends a Resend email per user
  if any bucket has ≥1 row. Empty digests skip — no "you have
  nothing" emails.

### Buckets per user

1. **Unread mentions** — `chat_mentions` where
   `mentioned_user_id = user.id AND read_at IS NULL`, capped to 20.
2. **Decisions awaiting ack** — `chat_decision_acks` where
   `user_id = user.id AND acked_at IS NULL`, capped to 20.
3. **Overdue deviations** — visits on protocols the user can access
   (`user_can_access_protocol(uid, pid) = true`) where
   `status = 'deviation' AND deviation_reason IS NULL` in the last
   30 days, capped to 20.

Each row in the email links to a deep-link via the existing
`PIQC_APP_URL` env var (the same one the per-event emails use).

### Idempotency

The cron is a fire-and-forget HTTP call; the function itself doesn't
write to any state. If the cron double-fires (network retry, etc.),
the worst case is a duplicate email — Resend caps that automatically
to a single delivery per unique subject within a short window. No
need for a queue table or a sent-log.

## Scope (files allowed)

### New

- `plans/kiara/daily-digest-cron.md` — this file.
- `supabase/migrations/20260704001000_daily_digest_cron.sql` — pg_cron
  job + Vault-guarded setup.
- `supabase/functions/send-daily-digest/index.ts` — edge function.

### Modified

- None.

## Architecture layers touched

- [x] migration
- [x] edge function

No app-layer changes — the existing Notification Settings UI already
toggles `user_notification_preferences.daily_digest`. The cron just
acts on that pref.

## Mock data plan

None.

## Approved-by

- Roger (`supabase/migrations/*`, edge function)

## Verification

- `npx tsc --noEmit --skipLibCheck -p tsconfig.app.json` → 0 errors
  (no app code changes — should be a no-op).
- Manual:
  - Set Vault secrets `project_url` + `service_role_key`.
  - `supabase db push` — cron entry installed.
  - Enable `daily_digest` for a test user with ≥1 unread mention.
  - Trigger the cron manually:
    `SELECT cron.schedule('daily-digest-manual-test', '* * * * *', ...);`
    OR invoke the edge function directly with the service-role JWT.
  - Confirm the test user receives one digest email.
  - Repeat with all three buckets empty → no email sent.

## Mechanical checks

- No `.channel(` outside `src/context/` — N/A, no app code.
- No `@supabase/supabase-js` in components — N/A.
- Migration is append-only (new file).
- Edge function is service-role-auth gated.
- Plan MD referenced in PR body.
- No new API/adapter files — no sibling tests required.
- `no type impact` — schema-touching migration but no new tables/columns.
