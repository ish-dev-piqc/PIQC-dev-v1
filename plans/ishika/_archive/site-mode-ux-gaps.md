---
owner: ish-dev-piqc
feature: site-mode-ux-gaps
status: merged
merged: 2026-07-05
started: 2026-07-05
target_pr: #431
---

# Site Mode login/upload/dashboard UX gap fixes (A1-A5, B1, B2, B5, B6, C1-C4)

## Context

A full trace of the Site Mode flow from login through protocol upload, parsing, and dashboard landing surfaced 13 concrete UX gaps — including the two most visible ones: uploading a protocol gives no way to know if it's parsed, and "Go to Dashboard" can land on a screen that's empty with no explanation. This bundles fixes for the auth/session gaps (A1, C1-C4) and the Site Mode data-flow/feedback gaps (A2-A5, B1, B2, B5, B6) into one PR, following the same "bundle the whole post-X experience for one review pass" precedent as `post-ingest-gaps` (#106).

## Scope (files allowed)

- `plans/ishika/site-mode-ux-gaps.md` (this plan)

**Shared infra — auth/session (2 reviewers required):**
- `src/context/AuthContext.tsx` — PASSWORD_RECOVERY/SIGNED_OUT event handling, profile-fetch-error tracking, getSession error handling (A1, C1, C2, C4)
- `src/App.tsx` — SetNewPassword routing gate, labeled loading spinner, ProfileCompletion props (A1, C2, C4)
- `src/components/auth/Login.tsx`, `ForgotPassword.tsx`, `ProfileCompletion.tsx` — session-expired banner, friendly error copy, load-error retry screen (C1, C2, C3)
- `src/components/auth/SetNewPassword.tsx` (NEW) — password-recovery screen (A1)
- `src/lib/authErrors.ts` (NEW) — Supabase error → friendly copy mapping (C3)

**Site Mode (Kiara's review):**
- `src/components/dashboard/KnowledgeBase.tsx` — upload-parsing-state callback (A2)
- `src/components/dashboard/site/ProtocolUploadModal.tsx` — close-during-parse guard (A2)
- `src/components/dashboard/site/ProtocolTab.tsx` — pending/failed document status pills (A4)
- `src/components/dashboard/site/TodayTab.tsx` — parsing-aware empty-calendar copy, loading-flash fix (A3, B5)
- `src/components/dashboard/visit-execution/VisitExecutionTab.tsx` — parsing-aware empty-workspace copy (A3)
- `src/components/dashboard/site/VisitDetailDrawer.tsx` — cancel-visit action, explicit refresh after mutation (A5, B1)
- `src/components/dashboard/site/VisitsTab.tsx`, `ParticipantProfileDrawer.tsx`, `ProtocolDetailDrawer.tsx` — VisitStatus exhaustiveness fan-out from adding 'cancelled' (A5)
- `src/components/dashboard/site/ParticipantFormDrawer.tsx`, `VisitFormDrawer.tsx` — unsaved-work dirty guard (B6)
- `src/components/dashboard/site/AnchorDateModal.tsx` — partial-success notice vs. error fix (B2)

**Shared infra — site data layer (2 reviewers required):**
- `src/lib/site/types.ts` — `ProtocolDocument.status`/`error_message`, `VisitStatus` 'cancelled'
- `src/lib/site/repos/types.ts`, `realSiteRepo.ts`, `demoSiteRepo.ts`, `siteApi.ts` — `cancelVisit`, widened document-status query (A3, A4, A5)
- `src/lib/site/calendarExport.ts` — 'cancelled' → 'CANCELLED' iCal mapping
- `src/lib/site/repos/__tests__/demoSiteRepo.test.ts` — cancelVisit coverage
- `src/lib/demo/fixtures/documents.ts` — `error_message: null` on demo fixtures

**Migration (Roger's review):**
- `supabase/migrations/20260705010000_add_cancelled_visit_status.sql` (NEW) — adds `'cancelled'` to `site_visit_status` enum

## Out of scope (files forbidden)

- `src/components/Navbar.tsx`, the `BACK_LABELS` CRA-mode gap in `App.tsx` — pre-existing typecheck breakage from the already-merged CRA-mode work (#425/#427/#429), unrelated to this PR. Flagged separately to the CRA-mode owner.
- `plans/ishika/post-ingest-gaps.md` — stale (`status: active` despite #106 already merged); housekeeping only, not touched here.
- `src/components/dashboard/audit/**`, `src/lib/audit/**`, `src/lib/sotr/**` — Audit Mode / SOTR untouched.

## Architecture layers touched

- [x] migration (`20260705010000_add_cancelled_visit_status.sql`)
- [ ] RPC
- [x] adapter (`realSiteRepo.ts`, `demoSiteRepo.ts`)
- [x] context (`AuthContext.tsx` — no `SiteDataContext` shape change; documents flow through the existing cache once the adapter filter widened)
- [x] component (`src/components/dashboard/site/`, `src/components/auth/`)
- [x] test (`demoSiteRepo.test.ts`)

## Mock data plan

None. `src/lib/demo/fixtures/documents.ts` gets a static `error_message: null` field added to existing fixtures — no new mock toggle.

## Approved-by

- **@ki-dev-piqc** (Kiara) — Site Mode components and `src/lib/site/**` shared-infra changes listed above.
- **@rv61** (Roger) — `supabase/migrations/20260705010000_add_cancelled_visit_status.sql`.
- Shared infra (`src/context/AuthContext.tsx`, `src/components/auth/**`) requires 2 reviewers per CODEOWNERS — requesting Kiara's review to satisfy this alongside Ishika as author.

## Verification

- [x] `npm run typecheck` — clean except two pre-existing, unrelated errors already present on `main` from the CRA-mode work (`App.tsx` BACK_LABELS/Navbar type gap).
- [x] `npm run lint` on all changed files — clean.
- [x] `npx vitest run src/lib/site/repos/__tests__/demoSiteRepo.test.ts` — 16/16 pass, including new `cancelVisit` coverage.
- [x] Vite dev-server smoke check — every changed file transforms without error.
- [ ] Manual: trigger a password-reset email, confirm landing on `SetNewPassword` not the dashboard, and that the old password stops working after reset.
- [ ] Manual: upload a protocol PDF, close the modal mid-parse, confirm the pending/failed status is visible in the Protocol panel afterward.
- [ ] Manual: schedule and cancel a visit; confirm it drops out of active counts.
- [ ] Manual: set an anchor date with zero participants; confirm the guidance renders as an info notice (not a red error) and the calendar refreshes without a manual reload.

**Discipline:**

- [x] `/piqc-review` locally — scope/ownership/architecture/mock/style/PHI/dead-code/test checks all pass; ownership requires Kiara's review per CODEOWNERS (not yet obtained — flagged in PR).
- [ ] CI `piqc-discipline.yml` green (pending push).
