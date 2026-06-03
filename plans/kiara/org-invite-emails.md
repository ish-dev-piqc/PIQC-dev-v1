---
owner: ki-dev-piqc
feature: org-invite-emails
status: active
started: 2026-06-02
target_pr:
---

# Send org invite emails via Resend

## Context

The org invite flow was link-only by design — see the comment in
`20260520010000_org_invites_table_and_rpcs.sql`: "v1 model: no email
delivery here; the admin gets the shareable URL back and sends it
out-of-band. Future PR can wire Resend / Supabase Auth invite."

Kiara just hit this in production — invited two people, expected them
to receive emails, neither did. The clipboard auto-copy is helpful but
admins don't reliably notice and paste it into their own email client.

Resend is already configured for the contact form:
`hello@updates.piqclinical.com` is DNS-verified and the
`RESEND_API_KEY` is set in Edge Function secrets. Reusing the same
infrastructure for invite emails is a straight extension.

## Design

### New Edge Function: send-org-invite-email

POST endpoint. Body: `{ inviteId: string; inviteUrl: string }`.

Auth:
1. Require `Authorization: Bearer <jwt>` from a signed-in user.
2. Verify the JWT via an anon-key client + `auth.getUser`.
3. Look up the invite by `inviteId` (service role; bypasses RLS).
4. Verify the caller is `admin` of the invite's `org_id` via an
   `org_members` lookup. Forbid otherwise.

Body composition:
- Recipient: `org_invites.email`.
- Subject: `"{Inviter Name} invited you to {Org Name} on PIQClinical"`.
- Plain-text + HTML versions; HTML is a simple branded card with an
  "Accept invite" button and the raw link below it as a fallback.
- `Reply-To`: the inviter's email (from `auth.users.email`) so the
  recipient can reply to a human. `From`: the canonical
  `hello@updates.piqclinical.com`.

Failure mode: if Resend returns non-2xx, return 502 with `{ error }`
and a structured log entry. The invite row already exists; the admin
can copy the link manually from the pending-invites list.

### Client wiring

`createOrgInvite` in `orgsApi.ts` invokes the Edge Function after the
RPC succeeds and threads an `emailSent: boolean` into the returned
data. Best-effort — a failed function call doesn't fail the overall
invite creation; the admin still gets the link in the clipboard.

### ManageTab feedback

Today's flow:
1. Admin fills email + role + protocol assignments.
2. Clicks "Create invite + copy link".
3. URL gets copied to clipboard. No confirmation surface.

After this PR:
- On success with `emailSent === true`: show a small inline confirmation
  next to the invite form ("✓ Invite sent to maya@example.com"). The
  clipboard copy still happens.
- On success with `emailSent === false`: show a warning ("Invite
  created, but email failed. Copy the link below to send it manually.")
  alongside the pending invite row.

### Domain considerations

`buildInviteUrl` uses `window.location.origin + import.meta.env.BASE_URL`,
so the URL reflects whatever environment the admin is using. Dev
admins → dev links; prod admins → prod links. This is intentional —
testing in dev doesn't send links pointing at prod.

## Scope (files allowed)

### New

- `supabase/functions/send-org-invite-email/index.ts` — Edge Function.
- `plans/kiara/org-invite-emails.md` — this file.

### Modified

- `src/lib/orgs/orgsApi.ts` — `createOrgInvite` invokes the Edge
  Function after the RPC; return type gains `emailSent: boolean`.
- `src/components/dashboard/organization/ManageTab.tsx` — inline
  feedback after invite creation; per-row warning if email failed.

### Out of scope (forbidden)

- New DB migration. The `org_invites` schema is unchanged; the function
  just reads it.
- "Resend invite" button on pending invites. Useful follow-up but adds
  surface area; admin can revoke + recreate for now.
- `auth.admin.inviteUserByEmail` integration. Supabase's built-in
  invite flow does signup-with-magic-link, which doesn't carry the org
  invite token through naturally. The custom Resend path keeps the
  existing token-redemption flow intact.
- Email templates beyond the v1 plain-text + simple HTML.

## Architecture layers touched

- [ ] migration
- [ ] RPC
- [ ] adapter
- [ ] context
- [x] component (Edge Function counts as backend code, plus the
      ManageTab UI feedback)
- [x] test (the existing orgsApi test will continue to pass; the
      function-call mock can be added if we need stricter coverage,
      but the test only checks the function exists today)

## Mock data plan

None. Edge Function shouldn't be reachable in demo mode (the admin
flow gates on `!demoActive`).

## Approved-by

- `@rg-dev-piqc` — `supabase/functions/**` and any environment config
  is in Roger's domain per CODEOWNERS (shared infra). Edge Function
  pattern mirrors the existing `contact/index.ts`, same Resend key,
  same from address — minimal blast radius.

## Verification

- Deploy the Edge Function: `npx supabase functions deploy send-org-invite-email`.
- Manual end-to-end:
  - Admin opens Manage tab, fills email + role, clicks Create invite.
  - Recipient receives an email within ~30 seconds with the invite link.
  - Clicking the link from the email lands on the app and consumes the
    token (existing accept-invite flow).
  - If recipient is an existing PIQClinical user, the invite is
    accepted and they're added to the org.
  - If they're new, the link should prompt them to sign up (existing
    behavior; not part of this PR).
- Failure mode:
  - Temporarily set a bad `RESEND_API_KEY` → invite still creates,
    inline UI shows "email failed" warning, clipboard copy still works.
- `npx tsc --noEmit --skipLibCheck -p tsconfig.app.json` → 0 errors.
