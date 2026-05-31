---
owner: ki-dev-piqc
feature: invite-accept-banner
status: merged
merged: 2026-05-31
started: 2026-05-30
target_pr: #196
---

# Invite accept → dashboard banner (replace `alert()`)

## Context

After a recipient clicks an org invite link and the `accept_org_invite` RPC succeeds, the previous implementation surfaced the outcome via a native browser `alert("You're now a <role> of <org>")`. UX call: that's jarring and gives the recipient zero next-step guidance. Replace with a non-modal dashboard banner that adapts to the outcome.

The accept-invite handler in `App.tsx` already strips `?invite=<token>` from the URL after the RPC runs, so a refresh doesn't re-fire. This PR keeps that behavior; only the post-RPC notification surface changes.

## Banner copy (adapts to outcome)

| Outcome | Banner |
|---|---|
| `role='admin'` | "You're now a site administrator of \<org\>. You have access to every protocol the org owns." |
| `role='member'`, protocol_count > 0 | "Welcome to \<org\>. You've been added to N protocol(s) — open one from the protocol picker above." |
| `role='member'`, protocol_count === 0 | "Welcome to \<org\>. No protocols assigned yet — request access from the protocol picker above." |
| RPC error | "Couldn't accept invite — \<error message\>" |

All four variants render dismissible via an X button. Success variants use the existing emerald palette; error variant uses rose. Pattern matches `DemoBanner` (top-of-app banner).

## Scope (files allowed)

- `src/components/dashboard/orgs/InviteWelcomeBanner.tsx` (NEW) — banner component with the four copy branches above.
- `src/App.tsx` — replace the two `alert()` calls in the accept-invite useEffect with `setInviteResult()`; render `<InviteWelcomeBanner />` below the Navbar in the dashboard view when `inviteResult` is non-null; dismiss via `setInviteResult(null)`.
- `plans/kiara/invite-accept-banner.md` — this file.

## Out of scope (files forbidden)

- `src/lib/orgs/orgsApi.ts` — the `acceptOrgInvite` API surface is unchanged; only its consumer in App.tsx changes.
- All other org/site/audit/etc files.

## Architecture layers touched

- [ ] migration
- [ ] RPC
- [ ] adapter
- [ ] context
- [x] component (new banner; App.tsx render site)
- [ ] test

## Mock data plan

None.

## Approved-by

- `@ish-dev-piqc` — for the `src/App.tsx` edit (shared infra; 2-reviewer rule applies to root-level App.tsx changes). The change is additive (new state + new conditional render) and removes two `alert()` calls; no provider chain change.

## Verification

- `npx tsc --noEmit --skipLibCheck -p tsconfig.app.json` → 0 errors
- Manual: open an invite token URL in incognito, sign in. After accept, instead of a browser alert:
  - Admin invite: green banner reads "You're now a site administrator of \<org\>. You have access to every protocol the org owns."
  - Member invite with protocol assignments: green banner reads "Welcome to \<org\>. You've been added to N protocol(s) — open one from the protocol picker above."
  - Member invite with no assignments: green banner reads "Welcome to \<org\>. No protocols assigned yet — request access from the protocol picker above."
  - Error (e.g., expired token): rose banner reads "Couldn't accept invite — \<message\>"
- Banner dismissible via X button; doesn't re-appear on refresh (`?invite=` is stripped from URL by the existing handler).
