---
owner: ish-dev-piqc
feature: demo-add-efc14833
status: active
started: 2026-07-14
target_pr:
---

# Demo Mode — add EFC14833 (Sotagliflozin) as a 4th fixture protocol

## Context

We just populated EFC14833 (Sotagliflozin, Type 2 Diabetes Mellitus, Sanofi) with real Supabase data on a real account (team members, participants across every status, visits materialized from the 10 real extracted `protocol_visit_templates`). This feature ports that same content into the client-side demo-mode fixture store (`src/lib/demo/`) as a 4th protocol alongside the existing BRIGHTEN-2 / CARDIAC-7 / IMMUNE-14, so demo-flagged users see it too.

## Scope (files allowed)

- src/lib/demo/ids.ts
- src/lib/demo/fixtures/protocols.ts
- src/lib/demo/fixtures/documents.ts
- src/lib/demo/fixtures/participants.ts
- src/lib/demo/fixtures/visits.ts
- src/lib/demo/fixtures/visitTemplates.ts
- src/lib/demo/fixtures/teamMembers.ts
- src/lib/demo/fixtures/askResponses.ts
- src/lib/site/repos/__tests__/demoSiteRepo.test.ts

## Out of scope (files forbidden)

- src/lib/demo/store.ts
- src/lib/site/repos/demoSiteRepo.ts
- src/lib/site/siteApi.ts
- src/context/DemoModeContext.tsx
- src/lib/visit-execution/**

## Architecture layers touched

- [x] test (`src/**/__tests__/`)
- fixtures / demo data (`src/lib/demo/`)

## Mock data plan

Existing `demoActive` seam only — no new toggle. Extends the sanctioned `src/lib/demo/` fixture store (`piq-demo-active-v1` / `piq-demo-store-v1`, defaults off); not a new mock shape.

## Approved-by

- @ki-dev-piqc — for `src/lib/site/repos/__tests__/demoSiteRepo.test.ts` (Site Mode ownership; updating the hardcoded "three demo protocols" assertion to four)

## Verification

- [ ] `npx tsc --noEmit` clean; `npm run test` — `demoSiteRepo.test.ts` passes with the 4th protocol
- [ ] Demo user, toggle ON: protocol switcher shows EFC14833 alongside the existing three; calendar/participants/team/documents/Ask all populate with no empty states
- [ ] Reset re-seeds EFC14833 correctly; Exit returns real data
- [ ] `/piqc-review` clean (scope, Approved-by, no-new-mocks, PHI)

## Note

`plans/ishika/demo-protocols-swap.md` and 5 sibling `demo-*` plans are still `status: active` on stale branches (`ishika/db-remediation`, `ishika/ask-tab-remediation`, `fix/site-mode-ux-gaps`, started 2026-06-16) with the same Scope. Confirmed their described work already shipped to main under a different archived plan (`site-demo-mode`, PR #85) — those branches were never cleaned up. Worth archiving separately; not a live conflict with this feature.
