---
owner: ish-dev-piqc
feature: resend-guest-invite-emails
status: active
started: 2026-06-03
target_pr:
---

# Send protocol-guest invite emails via Resend

## Context

The protocol-guest invite flow (`inviteGuest` in `orgsApi.ts`, surfaced by
`InviteGuestModal.tsx`) is link-only: the coordinator gets the invite URL
auto-copied to their clipboard and has to paste it into their own email
client. Same gap Kiara just closed for **org** invites in PR `org-invite-emails`
(`send-org-invite-email` Edge Function) — this is the parallel fix for the
**guest** surface.

Resend is already configured for the contact form and the org-invite email:
`hello@updates.piqclinical.com` is DNS-verified and `RESEND_API_KEY` is set in
Edge Function secrets. This reuses that infrastructure.

This is deliberately the guest-only half — the org half shipped in main while
this was being planned, so building it again would duplicate Kiara's work. This
function does **not** modify or generalize `send-org-invite-email`; it's a clean
parallel.

## Design

### New Edge Function: send-guest-invite-email

POST endpoint. Body: `{ guestId: string; inviteUrl: string }`. Mirrors
`send-org-invite-email/index.ts` structure (CORS, validation, structured logs,
Resend POST, 502 on send failure).

Auth (cleaner than the org function's manual check — leans on RLS):
1. Require `Authorization: Bearer <jwt>`; verify via anon-key client +
   `auth.getUser`.
2. Fetch the guest row by `guestId` through the **RLS-enforced user client**.
   The `protocol_guests_coordinator_or_self_select` policy only returns the row
   to a coordinator of the protocol (or the guest themselves), so a non-empty
   result *is* the authorization check — no manual membership lookup needed.
   Reject if used (`accepted_at` set).
3. Use the service-role client only for the protocol name (`protocols.title` /
   `study_number`) and inviter name/email (`user_profiles.name` +
   `auth.admin.getUserById`).

Body composition:
- Recipient: `protocol_guests.invited_email`.
- Subject: `"{Inviter Name} invited you to {Protocol Label} on PIQClinical"`.
- Plain-text + simple branded HTML with an "Accept invite" button + raw-link
  fallback. `Reply-To`: inviter's `auth.users.email`. `From`: canonical
  `hello@updates.piqclinical.com`.

No `config.toml` entry needed — the function verifies the JWT itself and the
default `verify_jwt=true` is correct for authenticated callers (matches
`send-org-invite-email`).

### Client wiring

`inviteGuest` in `orgsApi.ts` invokes the Edge Function after the INSERT
succeeds and returns `ProtocolGuest & { emailSent: boolean }`. Best-effort — a
failed invoke doesn't fail invite creation; the link is still clipboard-copied.

### InviteGuestModal feedback

After a successful invite: on `emailSent === true` show a small inline
confirmation ("✓ Invite emailed to guest@example.com"); on `false` show a
warning ("Invite created, but email failed — the link was copied, send it
manually."). Clipboard auto-copy still happens in both cases.

## Scope (files allowed)

### New
- `supabase/functions/send-guest-invite-email/index.ts`
- `plans/ishika/resend-guest-invite-emails.md` — this file.

### Modified
- `src/lib/orgs/orgsApi.ts` — `inviteGuest` invokes the function; return type
  gains `emailSent`.
- `src/components/dashboard/orgs/InviteGuestModal.tsx` — inline send feedback.

### Out of scope (forbidden)
- New DB migration / type change — `protocol_guests` schema is unchanged.
- "Resend email" button on pending guests — deferred to match Kiara's org
  decision; keeps the two invite surfaces consistent. Paired follow-up later.
- Modifying `send-org-invite-email` or generalizing it into one function.
- The two untracked `brighten-2_week-6-visit_*.pdf` files (possible PHI) — leave
  untracked, never commit.

## Architecture layers touched
- [ ] migration
- [ ] RPC
- [ ] adapter
- [ ] context
- [x] component (Edge Function backend code + InviteGuestModal UI)
- [ ] test

## Mock data plan
None.

## Approved-by
- `@rv61` (Roger) — `supabase/functions/**` is Roger's domain per CODEOWNERS.
  Edge Function mirrors the just-merged `send-org-invite-email` (same Resend
  key, same From address) — minimal blast radius.
- `@ki-dev-piqc` (Kiara) — `/src/lib/orgs/` and `/src/components/dashboard/orgs/`
  are Kiara's per CODEOWNERS. This guest flow is the direct parallel to her
  just-merged org-invite-email work, so she's the natural reviewer. Tag her on
  the PR.

## Verification
- Deploy: `npx supabase functions deploy send-guest-invite-email`.
- Confirm `RESEND_API_KEY` present: `npx supabase secrets list`.
- End-to-end: coordinator opens Invite guest, enters a real test email, submits
  → recipient gets the invite email within ~30s; clicking the link redeems via
  `accept_protocol_guest_invite`.
- Failure mode: temporarily break `RESEND_API_KEY` → invite still creates, modal
  shows the "email failed" warning, clipboard copy still works.
- `npx tsc --noEmit --skipLibCheck -p tsconfig.app.json` → 0 errors.
