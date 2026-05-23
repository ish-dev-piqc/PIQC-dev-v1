---
owner: ish-dev-piqc
feature: parse-review
status: active
started: 2026-05-23
target_pr:
---

# Parse-failure handling — post-upload routing + signals + missing-org fix

## Context

PR #99 made PDF upload the only protocol-creation path. Four real gaps remain in the failure surface that the merged code doesn't cover: (1) `ProtocolOnboarding.onSuccess` is empty so users always land on Today regardless of whether items need review — even though the UI footnote already promises SOTR routing; (2) the "N awaiting review" chip only renders inside `WorksheetItemsList` (which lives in the Protocol tab body) so users on Today/Visits/Ask have no signal there's work waiting; (3) hard-failure errors show inline but with no recovery copy; (4) the ingest function's B2.4 inline-create silently skips when `user_profiles.organization` is empty, leaving fresh users stuck on the onboarding wall forever. This feature fixes all four in one small PR.

## Scope (files allowed)

- `src/components/dashboard/site/ProtocolOnboarding.tsx` — implement `onSuccess` routing + add "What this means" hint on hard failure
- `src/components/dashboard/Dashboard.tsx` — thread `onTabChange` into ProtocolOnboarding, add awaiting-review badge to the Protocol tab in the tab bar
- `supabase/functions/ingest/index.ts` — fallback to email domain / "Personal Workspace" when `user_profiles.organization` is empty
- `plans/ishika/parse-review.md` — this plan

## Out of scope (files forbidden)

- `src/components/sotr/**` — `WorksheetItemsList` and SourceTruthDrawer are used as-is; no edits to SOTR internals
- `src/lib/sotr/**` — `countWorksheetItemsForStudy` + `isAwaitingReview` are consumed as existing exports; no changes
- Other Site Mode tabs (Today, Visits, Participants, Team, Ask, Reports, ProtocolTab) — no edits required
- Audit Mode, billing, auth — unrelated
- New migrations — none needed
- New components — none; this is wiring on existing ones

## Architecture layers touched

- [ ] migration
- [x] RPC (`supabase/functions/`) — `ingest/index.ts` modified for missing-org fallback
- [ ] adapter
- [ ] context — no new contexts; uses existing ProtocolContext + the sotr lib helpers
- [x] component — `ProtocolOnboarding`, `Dashboard`
- [ ] test — UI changes covered by manual verification + /piqc-review. Edge function fallback mirrors the existing pattern (logged + telemetry).

## Mock data plan

None. Real Supabase, real Reducto, real SOTR queries.

## Approved-by

- **@rv61** (Roger) — for `supabase/functions/ingest/index.ts` (the missing-org fallback edit)
- **@ki-dev-piqc** (Kiara) — second reviewer for `src/components/dashboard/Dashboard.tsx` (shared-infra 2-reviewer rule)
- `src/components/dashboard/site/ProtocolOnboarding.tsx` — Ishika owns; no additional approval needed.

## External prerequisites (Ishika — manual)

1. After merge: `supabase functions deploy ingest` to push the missing-org fallback to prod. Without redeploy, fresh users with no `user_profiles.organization` value will still be stuck.
2. No new secrets, no DB changes.

## Verification

- [ ] Upload a clean PDF where every extracted item is `high` confidence → after parse, user lands on **Today** tab (no items need review)
- [ ] Upload a PDF with at least one `needs_review` item (or temporarily seed one via SQL) → after parse, user lands on **Protocol** tab with the existing "N awaiting review" chip visible inside WorksheetItemsList
- [ ] In the Dashboard tab bar (mode='site', protocol active, items awaiting review > 0): the **Protocol** tab shows a small amber pill with the count next to the label. Switch protocols → badge re-fetches.
- [ ] Trigger a hard parse failure (corrupt PDF, password-protected PDF, or one Reducto returns 0 chunks for) → inline error from `UploadForm` shows AND the new "What this means" hint appears below the form with common causes + contact link
- [ ] As a fresh user with `user_profiles.organization` NULL: upload a PDF → ingest function falls back to `email.split('@')[1]` as `owner_org` → `protocols` row IS created → user gets through onboarding and lands on the dashboard (not stuck on the wall)
- [ ] `/piqc-review` passes locally; CI `piqc-discipline.yml` passes on the PR
