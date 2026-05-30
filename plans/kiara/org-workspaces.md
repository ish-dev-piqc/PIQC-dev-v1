---
owner: ki-dev-piqc
feature: org-workspaces
status: active
started: 2026-05-29
target_pr:
---

# Org workspaces — explicit protocol-level membership, guests, and Organization tier

## Context

PIQC's collaboration model needs three properties the current schema doesn't enforce:

1. **A user belongs to one identity but possibly multiple orgs.** Coordinators move between sponsors/CROs and shouldn't have to sign up twice; each org bills for their own seat.
2. **Joining an org grants zero protocol access.** Members only see protocols they were explicitly added to. This is the inverse of `feature/ish-landing`'s in-review simplification (PRs #94/95), where any org-member sees every protocol owned by that org. Ishika confirmed that v1 behaviour was a simplification, not a target end state.
3. **External collaborators (guests) can be invited per-protocol without holding an org seat.** Free up to a per-protocol cap, then paid via a guest-pack addon.

The schema layers on top of Ishika's `orgs` + `org_members` + `protocols.owner_org_id` foundation (PRs #90/94) without modifying her tables. Her org-scoped RLS becomes a *prerequisite* check; we add an **additional** protocol-scoped check on top. The new authorisation primitive is a single SQL function `user_can_access_protocol(uid, protocol_id)` so future modes (sponsor mode read-across-protocols) extend it without touching every policy.

## Scope (files allowed)

### Migrations

- `supabase/migrations/20260529000000_protocol_members_table.sql` (NEW)
- `supabase/migrations/20260529000100_protocol_access_requests.sql` (NEW)
- `supabase/migrations/20260529000200_protocol_guests.sql` (NEW)
- `supabase/migrations/20260529000300_user_can_access_protocol_fn.sql` (NEW)
- `supabase/migrations/20260529000400_protocol_rls_v3_membership.sql` (NEW — rewrites `protocols` + `site_*` RLS to call the access fn)
- `supabase/migrations/20260529000500_sponsor_relationships_stub.sql` (NEW — empty table referenced by the access fn for forward-compat; no UI)
- `supabase/migrations/20260529000600_protocol_member_first_owner_trigger.sql` (NEW — on `protocols` INSERT, auto-add the inserting user to `protocol_members` as `coordinator`)

### Types

- `src/types/orgs/index.ts` (NEW) — TS mirrors of `protocol_members`, `protocol_access_requests`, `protocol_guests`
- `src/types/sponsor/index.ts` (NEW, empty placeholder) — types for sponsor mode stub

### Lib (pure adapters + Result<T> API)

- `src/lib/orgs/orgsApi.ts` (NEW)
- `src/lib/orgs/protocolMembersAdapter.ts` (NEW)
- `src/lib/orgs/accessRequestsAdapter.ts` (NEW)
- `src/lib/orgs/guestsAdapter.ts` (NEW)

### Context

- `src/context/OrgContext.tsx` (NEW) — active-org selection, list of orgs user belongs to, membership cache for active-org protocols. Realtime channel on `protocol_members` / `protocol_access_requests`.

### Components

- `src/components/dashboard/orgs/MembersDrawer.tsx` (NEW) — per-protocol member roster + add/remove
- `src/components/dashboard/orgs/AccessRequestsList.tsx` (NEW) — pending requests list for coordinators
- `src/components/dashboard/orgs/RequestAccessButton.tsx` (NEW) — appears on protocols you can see metadata of but aren't a member of
- `src/components/dashboard/orgs/InviteGuestModal.tsx` (NEW) — guest invite by email, scoped to current protocol_id from URL
- `src/components/dashboard/orgs/OrgSwitcher.tsx` (NEW) — dropdown in Navbar for users in >1 org

### Shared infra (requires 2 reviewers)

- `src/lib/entitlements.ts` — add `canInviteGuest(sub, protocol, currentGuestCount)`, refactor `canInviteUser` / `canAddProtocol` to take an org_id, add `canUpgradeToOrganizationTier`
- `src/stripe-config.ts` — add `organization_enterprise` PlanKind and `addon_guest_seats` + `addon_viewer_seats` AddonKinds (Stripe products created separately by Roger)
- `src/components/billing/` — add Organization-tier card to the pricing surface, gated behind "Contact sales" CTA (no self-serve checkout)
- `src/context/` — `OrgContext.tsx` (new file) — touches the directory; 2-reviewer rule applies

### Plan + ownership

- `plans/kiara/org-workspaces.md` (this file)
- `docs/CODEOWNERS.md` — add `/src/lib/orgs/`, `/src/components/dashboard/orgs/`, `/src/types/orgs/` → `@ki-dev-piqc`; `/src/types/sponsor/` → 2-reviewer (since sponsor mode crosses domains)

## Out of scope (files forbidden)

- `src/components/dashboard/collaborate/**` — that's the separate `protocol-collaboration` plan
- `src/lib/collaborate/**` — same
- All `src/lib/site/**`, `src/lib/audit/**`, `src/lib/sotr/**`, `src/lib/visit-execution/**` — mode-isolation stays intact; mode contexts read from `OrgContext` for membership filtering but don't change shape here
- Sponsor mode UI (`src/components/dashboard/sponsor/**` etc.) — the placeholder migration creates an empty table the RLS fn references, but no application code touches it in this PR
- Email delivery of invites — v1 is copy-link only (matches Ishika's PR #95 pattern)
- Dropping `protocols.owner_org` or `user_profiles.organization` — Ishika's back-compat columns stay
- Removing or rewriting any of Ishika's PR #90/94/95/96 migrations

## Architecture layers touched

- [x] migration (7 new files)
- [x] RPC (`user_can_access_protocol(uid, protocol_id)`, access-request RPCs, guest-invite RPCs)
- [x] adapter (`src/lib/orgs/`)
- [x] context (`OrgContext`)
- [x] component (drawers, modals, switcher)
- [x] test

## Mock data plan

None. No localStorage toggles. All flows use real Supabase data, including dev/preview environments.

## Approved-by

- @rv61 — `supabase/migrations/**` (Backend / ingest CODEOWNERS rule)
- @ish-dev-piqc — `src/context/`, `src/components/billing/`, `src/lib/entitlements.ts` (shared infra 2-reviewer rule); also for `docs/CODEOWNERS.md` (discipline package owner). Also notify on the layering choice — her in-review PRs #90/94/95/96 are foundation; this PR depends on them landing or being explicitly superseded.
- @karl-dev-piqc — no audit-mode files touched, but `src/lib/entitlements.ts` change affects every mode; courtesy review
- *No protocol_org_access dependency* — confirmed with Roger that cross-org sharing is not the model; ignored Ishika's PR #96.

## Design

### Schema

```sql
-- protocol_members: explicit per-user-per-protocol membership
CREATE TABLE protocol_members (
  protocol_id  UUID NOT NULL REFERENCES protocols(id) ON DELETE CASCADE,
  user_id      UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role         TEXT NOT NULL CHECK (role IN ('coordinator', 'member', 'viewer')),
  added_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  added_by     UUID REFERENCES auth.users(id),
  PRIMARY KEY (protocol_id, user_id)
);

-- protocol_access_requests: user-initiated request flow
CREATE TABLE protocol_access_requests (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  protocol_id     UUID NOT NULL REFERENCES protocols(id) ON DELETE CASCADE,
  user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status          TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'denied', 'withdrawn')) DEFAULT 'pending',
  message         TEXT,
  requested_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at     TIMESTAMPTZ,
  resolved_by     UUID REFERENCES auth.users(id),
  UNIQUE (protocol_id, user_id) WHERE status = 'pending' -- one open request per user per protocol
);

-- protocol_guests: external collaborators, not org_members
CREATE TABLE protocol_guests (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  protocol_id     UUID NOT NULL REFERENCES protocols(id) ON DELETE CASCADE,
  invited_email   TEXT NOT NULL,
  invited_by      UUID NOT NULL REFERENCES auth.users(id),
  user_id         UUID REFERENCES auth.users(id), -- NULL until they accept
  accepted_at     TIMESTAMPTZ,
  invite_token    TEXT NOT NULL UNIQUE,
  expires_at      TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '30 days'),
  is_paid_seat    BOOLEAN NOT NULL DEFAULT FALSE, -- true once org has bought guest-pack overage
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- sponsor_relationships: forward-compat stub; empty in v1
CREATE TABLE sponsor_relationships (
  sponsor_org_id  UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  site_org_id     UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  granted_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (sponsor_org_id, site_org_id)
);
```

### Single authorisation primitive

```sql
CREATE OR REPLACE FUNCTION user_can_access_protocol(uid UUID, pid UUID)
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER AS $$
  SELECT
    -- (a) explicit protocol member
    EXISTS (SELECT 1 FROM protocol_members WHERE protocol_id = pid AND user_id = uid)
    OR
    -- (b) accepted guest
    EXISTS (
      SELECT 1 FROM protocol_guests
      WHERE protocol_id = pid AND user_id = uid AND accepted_at IS NOT NULL
        AND (expires_at IS NULL OR expires_at > NOW())
    )
    OR
    -- (c) sponsor mode: user belongs to a sponsor org that sponsors the protocol's owning site-org
    EXISTS (
      SELECT 1
      FROM org_members om
      JOIN sponsor_relationships sr ON sr.sponsor_org_id = om.org_id
      JOIN protocols p ON p.id = pid
      WHERE om.user_id = uid AND sr.site_org_id = p.owner_org_id
    );
$$;
```

RLS on `protocols`, `site_visits`, `site_participants`, `site_team_members`, and all collaborate tables becomes `USING (user_can_access_protocol(auth.uid(), protocol_id))`. Single point of authorisation; sponsor mode lights up when rows appear in `sponsor_relationships`.

### Visibility model

Two-tier visibility, baked into RLS:

- **Protocol metadata** (`protocols` table SELECT): visible to anyone in the protocol's `owner_org_id` via `org_members`. This lets a new team-member browse a roster of their org's protocols (name, study number, sponsor, indication, status) and click "Request access" without needing someone to tell them the protocol exists.
- **Protocol data** (`site_*`, `protocol_messages`, `protocol_files`, every other protocol-scoped table): gated by `user_can_access_protocol(uid, pid)`. Org membership alone grants zero data access.

This means `protocols` gets its own simpler RLS policy (`auth.uid() IN (SELECT user_id FROM org_members WHERE org_id = owner_org_id)`) and every other table uses the access function. A future "private protocol" flag could narrow the metadata policy on a per-row basis if blinded studies need it — out of scope for v1.

### Access flow

- **First member** of a protocol is the creator. The `protocol_member_first_owner_trigger` adds them as `coordinator` on insert. Without this trigger a protocol would be invisible to its own creator the moment RLS v3 kicks in.
- **Adding members** — coordinators can add any user from any of the protocol-owning org's `org_members`. UI only shows members of the owning org.
- **Requesting access** — a user in the same org as a protocol can request access (they can see the protocol *name* in a public-within-org listing but no participant data). RLS allows the access-request RPC to insert, but reads of the protocol's data fail until they're added to `protocol_members`.
- **Inviting guests** — coordinator submits an email; if that email already has a `user_profiles` row in the same org, fall back to adding as a regular member. Otherwise, generate a token, insert into `protocol_guests`, and surface a copy-link affordance. (No email send in v1; matches Ishika's invite pattern.)
- **Guests don't appear in org_members.** They have a Supabase auth user (created on token acceptance) but no `org_members` row. They only have `protocol_guests` rows. This is what makes them not count toward the org's seat quota.

## Pricing decisions

| Decision | Choice |
|---|---|
| Billable seat unit | An accepted `org_members` row. Pending invites and access requests are free. |
| Guest cap unit | **Per-protocol**. Default cap: **5 free guests per protocol**. Above the cap, the org must hold an `addon_guest_seats` subscription covering the overage; otherwise InviteGuestModal shows the upsell CTA. Cap value can be tuned post-launch. |
| Viewer seat policy | Free up to **10 viewers per protocol**; paid overage via `addon_viewer_seats`. Mirrors the guest model. Viewers are full `org_members` but with `protocol_members.role = 'viewer'` (read-only on that protocol). |
| Organization tier | New PlanKind `organization_enterprise`. Custom-priced, sales-led. Higher seat/protocol quotas, and `organization_enterprise` is the only kind that unlocks the placeholder "sponsor mode" feature flag when we light it up. No self-serve Stripe checkout — the pricing surface shows a "Contact sales" CTA. |
| Multi-org user billing | Each org pays for their copy of a shared user. No global / multi-org discount in v1. (Industry standard; matches Slack/Linear.) |

## Forward-compat for sponsor mode

The placeholder `sponsor_relationships` table and clause (c) in `user_can_access_protocol` mean that lighting up sponsor mode in a future PR requires:

1. UI to populate `sponsor_relationships` (admin-only, gated behind `organization_enterprise` plan).
2. A read-only mode toggle in the dashboard.
3. *Zero* changes to RLS — clause (c) is already there.

This is the consistency-and-scalability lever you flagged: protocol-level membership in v1 generalises to "membership OR guest OR sponsor relationship" without rewriting any policy.

## Open questions

1. **Switch-org UX latency** — when a user switches orgs in the OrgSwitcher, do we soft-reload the dashboard or live-swap the data? Soft-reload is simpler; live-swap requires all mode contexts to subscribe to `OrgContext`. Defer to during implementation.

Resolved during planning (2026-05-29):
- Default free guest cap: 5/protocol (tunable post-launch)
- Viewer-seat policy: 10 free viewers/protocol + `addon_viewer_seats` overage
- Within-org visibility: metadata-public-within-org (Visibility model section above)

## Verification

### Schema + RLS isolation

- [ ] Apply all 7 migrations on a fresh Supabase project; no errors.
- [ ] Three test users: A (in Org X), B (in Org X), C (in Org Y).
- [ ] User A creates Protocol P1 → A appears in `protocol_members` as `coordinator` (trigger).
- [ ] User B (same org as A, not in P1) reads `protocols` → P1 row visible if metadata-public-within-org is the chosen default; else not visible. Either way, reads on `site_visits` for P1 return 0 rows for B.
- [ ] User A adds B as `member` of P1 → B can now read all P1 data.
- [ ] User C (different org) reads `protocols` → never sees P1.
- [ ] B requests access to a *different* protocol P2 → access-request row inserted; coordinator approves → B becomes member of P2.
- [ ] B is removed from P1 → B's reads of P1 immediately return 0 rows.

### Guest flow

- [ ] A invites guest@external.com to P1 → row in `protocol_guests` with token + expires_at.
- [ ] Token URL: signed-in flow accepts → `user_id` set, `accepted_at` set. Signed-out flow: lands on login first, then accepts.
- [ ] Guest can read P1's `site_*` rows; cannot read any other protocol's data; does not appear in Org X's `org_members`.
- [ ] Invite a 6th guest to P1 without `addon_guest_seats` → InviteGuestModal blocks with upsell.
- [ ] With addon active, 6th guest invite succeeds; `is_paid_seat = true`.
- [ ] Guest's invite expires → access immediately revoked at next request (clause (b) checks expires_at).

### Multi-org

- [ ] User A also added to Org Y → `org_members` has 2 rows. OrgSwitcher shows both.
- [ ] Switch to Org Y → A sees only Org Y's protocols she's a member of, not Org X's. Switch back: opposite.

### Sponsor mode stub

- [ ] Insert a row into `sponsor_relationships (sponsor_org_id=Y, site_org_id=X)`. User in Org Y can now read P1 (sponsor clause fires). Confirms forward-compat without touching any other code.
- [ ] Remove the row → access disappears.

### Entitlements

- [ ] canInviteGuest returns `allowed=true` for 1st–5th guest on a protocol.
- [ ] canInviteGuest returns `allowed=false` with `addonProductKind='addon_guest_seats'` for 6th without addon.
- [ ] canUpgradeToOrganizationTier returns the "Contact sales" reason for all non-enterprise plans.

### No regression on Ishika's foundation

- [ ] Existing protocols pre-migration have a single `protocol_members` row added in backfill, with their `owner_id` (from PR #90) as the coordinator.
- [ ] `protocols.owner_org_id`, `org_members`, and Ishika's invite flow remain untouched and functional.
