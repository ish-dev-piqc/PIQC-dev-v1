---
owner: ish-dev-piqc
feature: site-team-and-visit-crud
status: active
started: 2026-05-18
target_pr:
---

# Site Mode: Team CRUD + manual visit scheduling

## Context

The two remaining gaps in Site Mode from the master plan §4.4 and §9.3 build-list:

**B4.1 — Team CRUD.** `TeamTab` is read-only today. There's no UI for adding, editing, or deactivating team members; the seeded fixtures are the only data. `siteApi` has `fetchTeamMembers` but no create/update/delete. For real customers to actually use the Team tab beyond viewing, they need a form.

**B4.2 — Manual visit scheduling.** Visits today only enter `site_visits` via the `materialize_protocol_visits` RPC, which requires templates extracted from a parsed PDF. A coordinator can't create a one-off visit (e.g., an unscheduled assessment, a make-up visit, a screening before templates are in place). This blocks the demo path "real user creates a protocol manually → adds participant → schedules first visit" because templates don't exist yet.

## Scope (files allowed)

- `src/lib/site/repos/types.ts`
- `src/lib/site/repos/realSiteRepo.ts`
- `src/lib/site/repos/demoSiteRepo.ts`
- `src/lib/site/siteApi.ts`
- `src/components/dashboard/site/TeamFormDrawer.tsx` (NEW)
- `src/components/dashboard/site/TeamTab.tsx`
- `src/components/dashboard/site/VisitFormDrawer.tsx` (NEW)
- `src/components/dashboard/site/VisitsTab.tsx`
- `src/lib/site/repos/__tests__/demoSiteRepo.test.ts`
- `plans/ishika/site-team-and-visit-crud.md`

## Out of scope (files forbidden)

- Migrations — both features use existing tables (`site_team_members`, `site_visits`), no schema change.
- Adding `template_id` linkage for manually-scheduled visits — they stay `template_id IS NULL`, which means the materialize RPC will not touch them (only template-derived rows are recomputed).
- Bulk import of team members or visits — single-row form is enough for v1.
- Participant detail page link to "schedule a visit" — possible polish, not required.

## Architecture layers touched

- [ ] migration
- [ ] RPC
- [x] adapter (siteApi extends with 4 functions, both repos implement)
- [ ] context (no shape changes; existing useSiteData refresh triggers cover both)
- [x] component (2 new drawers + edits to TeamTab and VisitsTab)
- [x] test (demoSiteRepo gets team CRUD + visit creation coverage)

No `src/types/<domain>/` impact — Team and Visit types already mirror schema.

## Mock data plan

None. Both features use the existing real/demo repo dispatcher.

## Approved-by

- @ki-dev-piqc — `src/lib/site/**` + `src/components/dashboard/site/**`

## Verification

### B4.1 Team CRUD

- [ ] On a real protocol, click "Add team member" in TeamTab → form opens → fill name / role / email / delegated tasks → submit → row appears
- [ ] Click an existing row → form pre-fills → change a field → submit → row updates
- [ ] Click delete on a row → confirms → row removed from list
- [ ] Cross-user isolation: a different-org user can't see or modify any of these rows (RLS from B1 covers this)
- [ ] Demo mode: same flow works against the in-memory store

### B4.2 Manual visit scheduling

- [ ] On a protocol with no templates yet (fresh manual-create flow), add a participant, then click "Schedule visit" → form opens → fill participant / date / visit name / study day / procedures → submit → visit appears on the calendar and in the Visits tab
- [ ] Trigger `materialize_protocol_visits` (e.g., add a template via PDF ingest, then update a participant's `enrolled_at`) → the manually-scheduled visit is NOT wiped (template_id IS NULL means it's outside the materialize rewrite)
- [ ] Demo mode: same flow works

### Mechanical

- [ ] `npm test` — new tests pass, existing tests still pass
- [ ] `tsc --noEmit` — no new errors
- [ ] `piqc-discipline` CI green
