---
owner: ish-dev-piqc
feature: site-onboarding
status: active
started: 2026-05-18
target_pr:
---

# Site Mode onboarding: Add-protocol form + PDF upload + ingest auto-create + welcome panel

## Context

PR #90 (Track B1) added ownership columns and scoped RLS. With those in place, real users can finally have their own data — but only if there's a way to create a protocol in the first place. Today there's none: the navbar shows "No protocols found" with no CTA, and no UI surface inserts into the `protocols` table.

This PR adds the five onboarding entry points from the master plan §9.1:

1. **Add-protocol form** — modal opened from the navbar, manual flow (Path A)
2. **`siteApi.createProtocol`** — stamps `owner_id` and `owner_org` from the active session
3. **PDF upload embedded in Protocol tab** — moves the audit-mode KnowledgeBase ingest UI into site mode
4. **Ingest auto-creates protocol** — when Reducto extracts a `study_number` with no matching protocol for the caller's org, the edge function inserts a new `protocols` row stamped with caller ownership (Path B)
5. **First-run welcome panel** — replaces the empty Overview tab with a friendly two-CTA pane when `protocols.length === 0`

## Scope (files allowed)

- `src/lib/site/repos/types.ts`
- `src/lib/site/repos/realSiteRepo.ts`
- `src/lib/site/repos/demoSiteRepo.ts`
- `src/lib/site/siteApi.ts`
- `src/components/Navbar.tsx`
- `src/components/dashboard/site/AddProtocolModal.tsx` (NEW)
- `src/components/dashboard/site/SiteWelcomePanel.tsx` (NEW)
- `src/components/dashboard/site/ProtocolTab.tsx`
- `src/components/dashboard/site/TodayTab.tsx`
- `src/components/dashboard/KnowledgeBase.tsx` (extract the upload form for reuse)
- `supabase/functions/ingest/index.ts`
- `src/lib/site/repos/__tests__/demoSiteRepo.test.ts` (extend with createProtocol cases)
- `plans/ishika/site-onboarding.md`

## Out of scope (files forbidden)

- `protocols` migrations — B1 covers them; this PR uses the columns but doesn't alter the schema
- Audit-mode files outside `KnowledgeBase.tsx` extraction
- B3 reliability fixes (Reducto failure surfacing, materialize-RPC durability) — separate PR
- B4 Team CRUD + manual visit scheduling

## Architecture layers touched

- [ ] migration
- [x] RPC (ingest edge function)
- [x] adapter (repo `createProtocol`)
- [ ] context
- [x] component (Modal + welcome panel + Protocol tab upload + Navbar wire-up)
- [x] test (demoSiteRepo extension)

No `src/types/<domain>/` impact. `Protocol` type lives in `ProtocolContext.tsx` (mode-specific), already mirrors the schema shape.

## Mock data plan

None. The new createProtocol goes through the existing real/demo repo dispatcher — demo mode mutations stay client-side, real mode hits Supabase with the new RLS in place.

## Approved-by

- @ki-dev-piqc — `src/lib/site/**` + `src/components/dashboard/site/**`
- @rv61 — `supabase/functions/ingest/**` (edge function changes)

## Verification

- [ ] Sign in as a fresh user with no protocols → first-run welcome panel renders with two CTAs (Add protocol / Upload PDF)
- [ ] Click "Add protocol" → modal opens → fill study_number/title/sponsor/phase → submit → row appears in picker, set as active
- [ ] Verify SQL: `SELECT owner_id, owner_org FROM protocols WHERE study_number = '<test>';` returns the user's uuid and org
- [ ] Sign in as a different-org user → can't see the protocol
- [ ] In Protocol tab, embedded PDF upload accepts a real PDF → ingest runs → schedule of events populates
- [ ] Upload a PDF whose extracted `protocol_number` doesn't match any existing protocol → the ingest function creates a new `protocols` row tagged with the caller's ownership; document gets auto-tagged
- [ ] Demo mode: createProtocol still works against the in-memory store
- [ ] tsc + lint clean, all tests pass (existing + new demoSiteRepo cases)
