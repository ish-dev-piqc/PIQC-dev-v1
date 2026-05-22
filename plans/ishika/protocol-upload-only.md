---
owner: ish-dev-piqc
feature: protocol-upload-only
status: active
started: 2026-05-21
target_pr:
---

# Protocol-upload-only ingestion — Site Mode auto-populated by Reducto

## Context

Today PIQC has two protocol-ingestion paths: (1) a manual `AddProtocolModal` opened from the Navbar protocol picker that creates an empty `protocols` row with no PDF, and (2) a PDF upload form inside the Protocol tab that runs the existing `supabase/functions/ingest/` edge function (Reducto Extract → `documents` + `chunks` + `protocol_visit_templates` + `protocol_extracted_items` + `protocol_source_evidence`). Path 1 is the loophole — users who take it end up with empty Site Mode tabs because every tab is driven by parsed content. This feature deletes path 1, replaces it with a full-screen onboarding wall for users with zero protocols, and updates the ingest function to create the protocol row inline from extracted metadata. Reducto + parse infrastructure already exists; this is wiring + UX.

## Scope (files allowed)

- `src/components/dashboard/site/ProtocolOnboarding.tsx` (NEW)
- `src/components/dashboard/site/AddProtocolModal.tsx` (DELETE)
- `src/components/dashboard/site/ProtocolTab.tsx`
- `src/components/dashboard/site/ParticipantsTab.tsx`
- `src/components/dashboard/site/TeamTab.tsx`
- `src/components/dashboard/site/SiteWelcomePanel.tsx` — collateral: previously imported the deleted `AddProtocolModal`; updated to point users at the new upload flow
- `src/components/dashboard/site/ProtocolUploadModal.tsx` (NEW) — replaces AddProtocolModal; wraps the existing UploadForm in a modal shell
- `src/lib/site/repos/types.ts` — collateral: remove `NewProtocolInput` + `createProtocol` from `SiteRepo` interface
- `src/lib/site/repos/realSiteRepo.ts` — collateral: remove `createProtocol` impl
- `src/lib/site/repos/demoSiteRepo.ts` — collateral: remove `createProtocol` impl + PHASE_LABEL_FOR_DEMO
- `src/lib/site/repos/__tests__/demoSiteRepo.test.ts` — collateral: drop `createProtocol` test cases
- `src/components/dashboard/KnowledgeBase.tsx`
- `src/components/dashboard/Dashboard.tsx`
- `src/components/Navbar.tsx`
- `src/lib/site/uploadProtocolApi.ts` (NEW)
- `src/lib/site/__tests__/uploadProtocolApi.test.ts` (NEW — required sibling test)
- `src/lib/site/siteApi.ts`
- `src/lib/site/repos/realSiteRepo.ts`
- `supabase/functions/ingest/index.ts`
- `plans/ishika/protocol-upload-only.md` — this plan

Optional (may defer):
- `supabase/migrations/<timestamp>_protocol_required_pdf.sql` — enforce every protocol has a linked `document_id`. Decide during impl.

## Out of scope (files forbidden)

- `src/lib/audit/**`, `src/components/dashboard/audit/**`, `src/types/audit/**` — Audit Mode is Karl's; mode isolation.
- `src/lib/sotr/**`, `src/components/dashboard/sotr/**`, `src/types/sotr/**` — SOTR drawer internals stay as-is; we only ROUTE to SOTR on parse failure, not modify it.
- `src/lib/supabase.ts` — Roger's, no changes needed (uploadProtocolApi imports from it).
- `src/context/**` — no new contexts; existing ProtocolContext + SiteDataContext handle the data refresh on protocol insert.
- `src/components/billing/**`, `src/components/auth/**`, `src/lib/entitlements.ts` — unrelated.
- Other `supabase/functions/*` — only `ingest/` is touched.
- Realtime / RLS / context plumbing — covered by existing SiteDataContext refresh on `protocols` INSERT.

## Architecture layers touched

- [ ] migration (`supabase/migrations/`) — only if we decide to add the NOT-NULL document_id constraint (deferred decision)
- [x] RPC (`supabase/functions/`) — `ingest/index.ts` modified to create protocol row inline
- [ ] adapter (`src/lib/*/*Adapter.ts`) — N/A
- [ ] context (`src/context/`) — N/A (existing refresh covers the new path)
- [x] component (`src/components/`) — ProtocolOnboarding (NEW), Dashboard, Navbar, ProtocolTab, ParticipantsTab, TeamTab, KnowledgeBase, AddProtocolModal (DELETE)
- [x] test (`src/**/__tests__/`) — sibling test for `uploadProtocolApi.ts`

## Mock data plan

None. Real Reducto, real Supabase, real PDF uploads. No localStorage `piq-*-v1` toggles introduced.

## Approved-by

- **@ki-dev-piqc** (Kiara) — for `src/components/dashboard/site/*`, `src/lib/site/*`. Most of the diff lives here.
- **@ki-dev-piqc** (Kiara) — second reviewer for `src/components/dashboard/Dashboard.tsx` (shared-infra 2-reviewer rule).
- **@rv61** (Roger) — for `supabase/functions/ingest/`. If we add a migration, also Approved-by for `supabase/migrations/`.
- `src/components/Navbar.tsx`, `src/components/dashboard/KnowledgeBase.tsx` — no explicit codeowner per `docs/CODEOWNERS.md`. No additional Approved-by required.

## External prerequisites (Ishika — manual, outside Claude)

1. **Pre-flight check + DB wipe** (SQL in approved plan at `/Users/ishikakulkarni/.claude/plans/i-am-planning-to-hashed-gadget.md`) — run in Supabase SQL editor *before* merging to confirm nothing real depends on existing test protocols, then wipe.
2. **Reducto API key** — verify `REDUCTO_API_KEY` is still set via `supabase secrets list`. The existing `ingest/` function expects it.
3. **Deploy after merge** — `supabase functions deploy ingest`.

## Verification

End-to-end on the feature branch (Ishika expands before review):

- [ ] DB wipe complete: `protocols` table is empty
- [ ] Log in fresh → full-screen `<ProtocolOnboarding />` wall renders (no dashboard tabs)
- [ ] Upload a real test PDF → parse-in-progress state shows → on success, routed into Site Mode dashboard
- [ ] Protocol tab: metadata header populated (study #, title, sponsor), document listed, visit templates table populated
- [ ] Set anchor date + click "Project visits" → `site_visits` materialize → Today and Visits tabs show the calendar grid
- [ ] Participants tab: empty state with "Add participant" CTA (parse doesn't populate this — copy makes that clear)
- [ ] Team tab: empty state with "Add team member" CTA
- [ ] Ask tab: protocol-contextual suggested prompts visible; ask one and confirm citation links land on the right PDF page
- [ ] Reports tab: zeros across the board (no visits completed yet)
- [ ] Navbar "+ Upload protocol" entry works for adding a second protocol from an active session
- [ ] Corrupt or unparseable PDF → routed to SOTR with parse-failure banner
- [ ] `/piqc-review` passes locally; CI `piqc-discipline.yml` passes on the PR
