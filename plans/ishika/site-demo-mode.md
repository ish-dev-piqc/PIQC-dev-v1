---
owner: ish-dev-piqc
feature: site-demo-mode
status: in-review
started: 2026-05-18
target_pr: 85
---

# Site demo mode — server-gated fixture toggle

## Context

Site Mode today reads from real Supabase tables that are also seeded with three demo protocols (BRIGHTEN-2 / CARDIAC-7 / IMMUNE-14) every authenticated user can see. This blocks production rollout (real customers see fake data) and wastes the existing `MockCalendarToggle` UI on a dev-only fixture path. This feature replaces both: a server-gated `is_demo_user` flag on `user_profiles` controls who sees a demo toggle, and a new in-memory fixture repository serves all site-mode data (protocols, participants, visits, team, documents) only when the toggle is active. Strategy doc: [.claude/plans/goal-complete-production-greedy-thunder.md](../../.claude/plans/goal-complete-production-greedy-thunder.md) §10.

## Scope (files allowed)

- `supabase/migrations/20260518*_user_profiles_is_demo_user.sql` (NEW)
- `src/context/AuthContext.tsx`
- `src/context/DemoModeContext.tsx` (NEW)
- `src/context/SiteDataContext.tsx`
- `src/context/ProtocolContext.tsx`
- `src/lib/site/types.ts`
- `src/lib/site/labels.ts` (NEW — type/label exports relocated out of the mock files)
- `src/lib/site/siteApi.ts`
- `src/lib/site/repos/*` (NEW folder)
- `src/lib/demo/**` (NEW folder)
- `src/lib/heatmap.ts` (swap `CalendarVisit`/`MockParticipant` for canonical `SiteVisit`/`SiteParticipant`)
- `src/components/Navbar.tsx`
- `src/components/dashboard/Dashboard.tsx` (mount the DemoBanner inside the site-mode container)
- `src/components/dashboard/site/AskTab.tsx` (branch on demoActive to render DemoAskPanel)
- `src/components/dashboard/site/DemoAskPanel.tsx` (NEW)
- `src/components/dashboard/site/DemoBanner.tsx` (NEW)
- `src/components/dashboard/site/TodayTab.tsx`
- `src/components/dashboard/site/VisitsTab.tsx`
- `src/components/dashboard/site/ReportsTab.tsx`
- `src/components/dashboard/site/ParticipantsTab.tsx` (import-source updates only)
- `src/components/dashboard/site/ParticipantFormDrawer.tsx` (import-source updates only)
- `src/components/dashboard/site/ParticipantProfileDrawer.tsx` (import-source updates only)
- `src/components/dashboard/site/VisitDetailDrawer.tsx` (`CalendarVisit` → `SiteVisit`)
- `src/components/dashboard/site/TeamTab.tsx` (import-source updates only)
- `src/lib/mockCalendarData.ts` (DELETE after types relocated)
- `src/lib/mockSiteData.ts` (DELETE after types relocated)
- `src/components/dashboard/site/MockCalendarToggle.tsx` (DELETE)
- `src/components/dashboard/site/SitePlaceholder.tsx` (DELETE — unreferenced)
- `src/App.tsx`
- `src/main.tsx` (one-time localStorage cleanup of the old toggle key)
- `plans/ishika/site-demo-mode.md`

## Out of scope (files forbidden)

This feature does **not** touch audit-mode, SOTR, ingest, or the existing site-mode CRUD flows. Specifically forbidden:

- `src/lib/audit/**`, `src/components/dashboard/audit/**`, `src/types/audit/**`
- `src/lib/sotr/**`, `src/components/dashboard/sotr/**`, `src/types/sotr/**`
- `supabase/functions/ingest/**` (separate feature, §9.1 Path B / §4.2)
- `supabase/migrations/20260507000000_protocol_visit_templates.sql` (separate feature, §4.3 fix)
- `src/lib/site/siteApi.ts` write-path semantics — existing real-mode functions keep their current behaviour; refactor is a dispatcher swap, no behaviour change in real mode.
- Any new `protocols` insert path (that's onboarding, §9.1 Path A — separate feature).

## Architecture layers touched

- [x] migration (`supabase/migrations/`) — `is_demo_user BOOLEAN`
- [ ] RPC
- [x] adapter (`src/lib/site/repos/realSiteRepo.ts`, `demoSiteRepo.ts`)
- [x] context (`src/context/DemoModeContext.tsx`, plus extensions to AuthContext / SiteDataContext / ProtocolContext)
- [x] component (`src/components/Navbar.tsx` toggle, new `DemoBanner.tsx`, MockCalendarToggle cleanup)
- [x] test (`src/lib/demo/__tests__/store.test.ts`, `src/lib/site/repos/__tests__/demoSiteRepo.test.ts`)

**No `src/types/` impact.** The DB column `user_profiles.is_demo_user` is
mirrored in `src/context/AuthContext.tsx`'s `UserProfile` interface (the
project's actual convention — auth profile lives in the context module, not
in a `src/types/auth/` folder). The `piqc-discipline` B2 type-mirror check
defaults to `src/types/<domain>/`; calling it out here keeps the rule honest.

## Mock data plan

Follows the CLAUDE.md non-negotiable #1 pattern. New localStorage toggle key: `piq-demo-active-v1`, defaults to OFF, and effective `demoActive` is only true if **both** the localStorage bit AND server-side `user_profiles.is_demo_user = TRUE`. The pre-existing `piq-site-mock-calendar-v1` toggle is removed; a one-time `localStorage.removeItem('piq-site-mock-calendar-v1')` runs on app load so users with stale state get cleared.

Demo fixtures live in `src/lib/demo/fixtures/` (protocols, participants, visits, team, documents, visit templates, ask responses). The in-memory store at `src/lib/demo/store.ts` is sessionStorage-backed so mutations survive page reload during a demo but clear on tab close. **Fixtures never reach Supabase** — `demoSiteRepo` is purely client-side.

## Approved-by

- @rv61 — for `supabase/migrations/20260518*_user_profiles_is_demo_user.sql` (`supabase/` is Roger's domain)
- @ki-dev-piqc — for `src/lib/site/**` and `src/components/dashboard/site/**` (Kiara's domain)

Co-owned context files (`src/context/*`) and shared infra (`src/components/auth/**` style) already list ish-dev-piqc in CODEOWNERS — no extra approval needed beyond standard review.

## Verification

Manual end-to-end walkthrough — every step must pass before opening the PR.

- [ ] `supabase db push` (or `supabase migration up`) applies the new migration locally; `\d user_profiles` shows `is_demo_user BOOLEAN NOT NULL DEFAULT FALSE`.
- [ ] Sign in as a non-demo user → no toggle in user dropdown, no banner, calendar/picker empty (real Supabase, fresh account).
- [ ] `UPDATE user_profiles SET is_demo_user = TRUE WHERE id = '<your-uuid>';` → reload → demo toggle now visible in dropdown, default state OFF.
- [ ] Click toggle ON → banner renders, picker shows 3 demo protocols, Overview calendar populates with realistic visits.
- [ ] Walk all 7 site tabs (Overview / Participants / Visits / Protocol / Team / Ask / Reports) — each renders fixture data without errors.
- [ ] Add a participant via the form → appears in roster. Complete a visit via the procedure checklist → status updates in fixture store.
- [ ] Reload page → mutations survived (sessionStorage), demo mode still active.
- [ ] Close tab, open new tab, sign in → demo mode still on (localStorage), mutations gone (sessionStorage cleared).
- [ ] Click "Reset" in banner → fixtures re-seed, current mutations wiped.
- [ ] Click "Exit demo" → banner gone, real Supabase data returned. Toggle remains.
- [ ] `UPDATE user_profiles SET is_demo_user = FALSE WHERE id = ...` → reload → toggle disappears, `demoActive` auto-falsifies.
- [ ] Sign in as a different non-demo user in the same browser → no toggle visible despite localStorage bit (confirms `canUseDemo` server gating).
- [ ] `grep -rn "MOCK_\|MockCalendar\|mockSiteData\|mockCalendarData" src/` returns zero matches.
- [ ] `grep "piq-site-mock-calendar-v1" src/` returns zero matches.
- [ ] `tsc --noEmit` passes.
- [ ] `piqc-discipline` workflow passes (cross-mode imports, scope check, lint).
- [ ] New unit tests for `src/lib/demo/store.ts` pass (subscribe / mutate / reset / sessionStorage round-trip).
