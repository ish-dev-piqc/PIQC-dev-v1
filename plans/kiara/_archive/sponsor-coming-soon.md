---
owner: ki-dev-piqc
feature: sponsor-coming-soon
status: merged
merged: 2026-06-12
started: 2026-06-04
target_pr: #321
---

# Sponsor mode — coming-soon page (PR 3 of 6)

## Context

PR 1 added the rail's Sponsor icon, routing to a tiny inline
placeholder. This PR replaces that placeholder with the real
coming-soon page: purple-themed surface, roadmap pill, hero text,
capability bullets, notify-me email capture.

Marketing surface for current users — they see we're building
Sponsor mode and can self-identify as interested. Capture rows
feed into a simple lead list we can email when Sponsor lands.

## Design

### Schema

New `sponsor_interest` table — bare bones:

```sql
create table public.sponsor_interest (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid references auth.users(id) on delete set null,
  email       text not null,
  message     text,
  created_at  timestamptz not null default now()
);
```

RLS:

- **INSERT** — any authenticated user. `user_id` defaults to
  `auth.uid()` server-side via a trigger so the client doesn't get
  to forge it. `email` is free-form (lets a user enter a team
  inbox, not just their own auth email).
- **SELECT / UPDATE / DELETE** — no client policies. PIQC team
  reads the list via the Supabase Dashboard (service-role).

### API

`addSponsorInterest({ email, message? })` → `Result<void>` in
`orgsApi.ts`. Validates email shape client-side (presence + `@`),
trims, defends against empty payloads. Returns success on insert.

### Component — `SponsorComingSoonPage.tsx`

Replaces the inline placeholder in `Dashboard.tsx`'s
`case 'sponsor'` branch. Layout (matches the brainstorm mock):

- Purple-tinted background panel
- Roadmap pill ("Targeting Q4 2026") — static for now; update when
  we have a real date
- Hero h2: "Roll up site activity across protocols and orgs"
- Lead paragraph
- Capability bullets (4 items)
- Notify-me form: email input + optional message + submit button
- On success: form replaced with "Thanks — we'll email you when
  Sponsor mode ships." inline confirmation

Errors surface inline below the form; submit button shows a small
spinner while inserting.

## Scope (files allowed)

### New

- `supabase/migrations/20260704000600_sponsor_interest.sql`
- `src/components/dashboard/SponsorComingSoonPage.tsx`
- `plans/kiara/sponsor-coming-soon.md` — this file.

### Modified

- `src/lib/orgs/orgsApi.ts` — `addSponsorInterest()` helper.
- `src/components/dashboard/Dashboard.tsx` — replace the inline
  placeholder with `<SponsorComingSoonPage />`.

## Architecture layers touched

- [x] migration
- [x] API
- [x] component

## Mock data plan

None.

## Approved-by

- `supabase/` — Roger (new table + RLS).

## Verification

- `npx tsc --noEmit --skipLibCheck -p tsconfig.app.json` → 0 errors
- Manual:
  - Click Sponsor rail icon → full coming-soon page renders.
  - Submit a valid email → form replaced with success state; row
    appears in `sponsor_interest` (check Supabase Dashboard).
  - Submit without an email or with malformed email → inline
    error.
  - Second submission on the same browser tab works (different
    email).
  - RLS: SELECT from `sponsor_interest` as a regular user returns
    nothing (or RLS error) — service-role SELECT in Dashboard
    works.
