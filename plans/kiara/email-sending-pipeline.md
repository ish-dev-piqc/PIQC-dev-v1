---
owner: ki-dev-piqc
feature: email-sending-pipeline
status: active
started: 2026-06-04
target_pr:
---

# Email-sending pipeline — wire notification preferences to Resend

## Context

The previous PR shipped the user prefs surface (`Settings →
Notifications` with three toggles). The banner there says
"email sending isn't live yet" — this PR makes it live for
**mention** and **decision ack** notifications. Daily digest stays
behind a separate PR (it needs a `pg_cron` job + a more
complicated aggregation query).

## Design

### Edge function — `send-notification-email`

`supabase/functions/send-notification-email/index.ts`. Service-role
JWT-authenticated POST endpoint. Request body:

```ts
{
  type: 'mention' | 'decision_ack',
  user_id: string,         // recipient
  context: {
    // mention
    mention_id?: string,
    message_id?: string,
    org_id?: string | null,
    protocol_id?: string | null,
    mentioned_by_user_id?: string | null,
    // decision_ack
    decision_id?: string,
    decision_title?: string,
  }
}
```

Flow:

1. Verify caller is service-role (Authorization header matches the
   Vault `service_role_key`). The pg_net trigger is the only
   intended caller.
2. Look up recipient's auth.users.email + notification preferences.
   Skip if the relevant `notify_*_email` is false (defensive — the
   trigger already gates on this, but a second check costs nothing
   and protects against drift).
3. Compose subject/text/html. Reply-To is set to the actor's email
   when available so replies route to a human, not the no-reply.
4. POST to Resend with `RESEND_API_KEY` from env / Vault. From is
   the canonical `hello@updates.piqclinical.com`.
5. Return 200 on success; 5xx on Resend / lookup failure with a
   structured log line.

### Triggers

Two AFTER-INSERT triggers, each calling `net.http_post` to the edge
function. Self-guarding: the whole block NO-OPS if pg_net / Vault
secrets aren't set, matching the ingest-recover-cron pattern from
`20260703000001_ingest_recover_cron.sql`.

- `chat_mentions_email_trigger` — fires when a row lands in
  `chat_mentions`, after looking up `user_notification_preferences`
  for the mentioned user. Only sends when `notify_mentions_email =
  true`.
- `chat_decision_acks_email_trigger` — same pattern on
  `chat_decision_acks` INSERT.

The triggers run in SECURITY DEFINER context so they can read both
the preferences table (which has self-only RLS) and `auth.users`.
They call `net.http_post` async — the trigger returns immediately;
the HTTP call happens in the background.

### Why pg_net direct, not a queue table

Simpler. At PIQC scale, low message volume means we don't need
retry semantics yet. If a Resend POST fails, the recipient misses
that one email but the audit trail (the underlying chat_mention /
chat_decision_ack row) is preserved. v2 can add an
`email_send_log` table if we need observability or retries.

## Scope (files allowed)

### New

- `supabase/functions/send-notification-email/index.ts`
- `supabase/migrations/20260704000500_notification_email_triggers.sql`
- `plans/kiara/email-sending-pipeline.md` — this file.

### Modified

- `src/components/dashboard/NotificationsSettings.tsx` — drop the
  "email sending isn't live yet" banner (or downgrade to a
  per-toggle note next to "Daily digest" only, since that's still
  not wired).

## Architecture layers touched

- [x] migration (triggers)
- [x] edge function
- [x] component (banner removal)

## Mock data plan

None.

## Approved-by

- `supabase/` — Roger (new triggers + edge function).

## Out of scope

- Daily digest cron — separate follow-up PR with `pg_cron`.
- Per-org / per-protocol unsubscribe links in emails.
- Email template re-use across edge functions (each one inlines
  its own HTML today; refactor into shared module if we get to
  3+).

## Verification

- `npx tsc --noEmit --skipLibCheck -p tsconfig.app.json` → 0 errors
- Edge function deployment via `supabase functions deploy send-notification-email`.
- Migration self-guards (NO-OP NOTICE when pg_net/Vault missing).
- Manual:
  - User A enables "Mention emails" → user B @mentions A in
    #general → A receives an email within ~10s.
  - User A disables "Mention emails" → A doesn't receive emails on
    future mentions.
  - User A is part of a required-acks decision but has
    "Decision acknowledgment emails" off → no email.
  - Resend down (fake by breaking the API key in Vault) → migration
    still applies; trigger fires but logs an error in pg_net's
    response table; chat_mention row still lands intact.
