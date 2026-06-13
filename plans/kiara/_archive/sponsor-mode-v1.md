---
owner: ki-dev-piqc
feature: sponsor-mode-v1
status: merged
merged: 2026-06-13
started: 2026-06-13
target_pr: #339
---

# Sponsor mode v1 — portfolio view

## Context

PR 3 shipped `SponsorComingSoonPage` — purple-themed marketing surface
with a notify-me form writing to `sponsor_interest`. The
`sponsor_relationships` table was created in migration
`20260618000300_sponsor_relationships_stub.sql` as an empty placeholder
that the `user_can_access_protocol` fn already references — meaning
populating it lights up sponsor access transparently with zero RLS
changes.

This PR lights it up the rest of the way: a real read-only sponsor mode
page that shows the user's portfolio of sponsored protocols across all
the site-orgs they sponsor.

## Design

### What a sponsor user sees

1. They click the Sponsor icon in the LeftRail.
2. `SponsorPage` loads — calls `list_my_sponsor_portfolio()`.
3. If zero rows → fall back to the existing `SponsorComingSoonPage`
   (so prospects still see marketing + capture form).
4. If ≥1 rows → render a header (`Sponsor portfolio · N protocols`),
   then a grid of cards, one per protocol. Each card shows:
   - Protocol code (study_number) + title
   - Site-org name (the org running the trial)
   - Participant count
   - Last visit date (or "no activity yet")
   - "View details" — disabled stub in v1 with a tooltip; the actual
     drawer lands in v2.

No actions, no edits. Sponsors are observers in v1.

### Data path

New migration `20260704000900_list_my_sponsor_portfolio.sql` adds
`list_my_sponsor_portfolio()` — SECURITY DEFINER (since
`sponsor_relationships` has no RLS read policy). Logic:

```sql
SELECT
  p.id, p.study_number, p.title,
  so.id AS site_org_id, so.name AS site_org_name,
  COUNT(DISTINCT sp.id) AS participant_count,
  MAX(sv.date) AS last_visit_at
FROM sponsor_relationships sr
JOIN org_members om
  ON om.org_id = sr.sponsor_org_id AND om.user_id = auth.uid()
JOIN protocols p ON p.owner_org_id = sr.site_org_id
JOIN orgs so ON so.id = sr.site_org_id
LEFT JOIN site_participants sp ON sp.protocol_id = p.id
LEFT JOIN site_visits sv ON sv.protocol_id = p.id
GROUP BY p.id, p.study_number, p.title, so.id, so.name
ORDER BY MAX(sv.date) DESC NULLS LAST, p.title ASC;
```

Returns a table-typed result; `sponsorAdapter` shapes it to TS.

### Mode isolation

Sponsor mode is its own area like Site/Audit/SOTR. New folders:

- `src/components/dashboard/sponsor/SponsorPage.tsx`
- `src/lib/sponsor/sponsorApi.ts` (Result<T>)
- `src/lib/sponsor/sponsorAdapter.ts` (pure mapper)
- `src/types/sponsor/` already exists — add `SponsorPortfolioEntry`.

`Dashboard.tsx` swaps the `case 'sponsor'` render — calls SponsorPage,
which decides internally whether to show the portfolio or the coming-soon
marketing fallback.

`SponsorComingSoonPage` stays where it is — SponsorPage falls through
to it on the empty state.

## Scope (files allowed)

### New

- `plans/kiara/sponsor-mode-v1.md` — this file.
- `supabase/migrations/20260704000900_list_my_sponsor_portfolio.sql` —
  new RPC.
- `src/lib/sponsor/sponsorApi.ts` — Result<T>-shaped API layer.
- `src/lib/sponsor/sponsorAdapter.ts` — pure adapter.
- `src/lib/sponsor/sponsorApi.test.ts` — sibling test.
- `src/lib/sponsor/sponsorAdapter.test.ts` — sibling test.
- `src/components/dashboard/sponsor/SponsorPage.tsx` — portfolio + empty
  state fallback.

### Modified

- `src/types/sponsor/index.ts` — add `SponsorPortfolioEntry`.
- `src/components/dashboard/Dashboard.tsx` — route `case 'sponsor'` to
  `SponsorPage` instead of `SponsorComingSoonPage`.

## Architecture layers touched

- [x] migration
- [x] RPC
- [x] adapter
- [x] API layer
- [x] component

## Mock data plan

None. Empty-state UX is the coming-soon page.

## Approved-by

- Roger (`supabase/migrations/*`)
- Self (everything else — sponsor is greenfield, no existing owner)

## Verification

- `npx tsc --noEmit --skipLibCheck -p tsconfig.app.json` → 0 errors
- Both new test files run green.
- Manual:
  - User with zero `sponsor_relationships` rows → Sponsor mode shows
    coming-soon page (unchanged behavior).
  - User belonging to an org that's `sponsor_org_id` in at least one
    relationship → Sponsor mode shows portfolio with one card per
    sponsored protocol.
  - Aggregates render — participant count matches `site_participants`
    count; last visit date matches max `site_visits.date`.
  - Mobile (<lg): cards stack one per row; desktop: 2-up at `lg`,
    3-up at `xl`.

## Mechanical checks

- Mode isolation: sponsor doesn't import from site/audit/sotr; uses
  `src/lib/sponsor/` for its data layer.
- No `.channel(` outside `src/context/`.
- No `@supabase/supabase-js` imports in components.
- Adapter is pure (no supabase import).
- API layer returns `Result<T>` — no `throw` outside guards.
- Migration is append-only (new file).
- No `: any` in `src/lib/sponsor/**`.
- Sibling tests for the new `sponsorApi.ts` + `sponsorAdapter.ts`.
- Plan MD referenced in PR body.
