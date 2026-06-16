---
owner: ish-dev-piqc
feature: demo-protocols-swap
status: merged
merged: 2026-06-16
started: 2026-06-16
target_pr: #367
---

# Demo Mode — swap fixture protocols to 3 real studies

## Context

Demo mode (server-gated `is_demo_user` + `piq-demo-active-v1`) swaps Site Mode's data source from Supabase to in-memory fixtures via the `demoSiteRepo` seam, so demo-flagged users can pitch on sample data without touching real rows. Today the fixtures ship 3 invented studies (BRIGHTEN-2 / CARDIAC-7 / IMMUNE-14). We replace those with **3 real protocols from the account** — real identity (study number / title / sponsor / phase) but **synthetic, PHI-safe** participants/visits/team/docs/Ask underneath. The demo renders through the **same Site-Mode UI as prod** (the seam swaps only data, not components), so the work is authoring fixtures rich enough that every screen — including the Reports tab — populates with no empty states.

Target protocols (identity from Supabase `protocols` + `documents.extracted_fields`):

- **PP06489** (PledOx) — PledPharma AB — Phase 3, colorectal CIPN prevention (PledOx IV before each mFOLFOX6 cycle; DFS 12/24mo, CTCAE v4.03)
- **CLR_18_06** (K0706) — Sun Pharma / SPARC — Phase 2, early Parkinson's (oral once-daily 40wk; MDS-UPDRS Parts 2+3 at Wk40)
- **ND-L02-s0201-005** — Nitto Denko — Phase 2, IPF (IV 45/90mg Q2W×24wk; FVC decline, FVC at Day 169, DLCO)

## Approach

Keep the existing fixtures' **exact structure, status coverage, and per-protocol distribution** (so every UI branch stays exercised) but rewrite each protocol's *content* to be accurate to its real indication, grounded in the real `documents.extracted_fields` (study design / dosing / endpoints — not PHI). Participant identities, dates, and clinical specifics stay synthetic. **Keep the `DEMO_PROTOCOL_IDS` object keys as-is** (internal aliases) so nothing downstream changes — no visit-execution edits, no UUID churn.

- **protocols.ts** — real `code` / `name` / `sponsor` / `phase` (Ph3, Ph2, Ph2); keep `id` refs + `demoAnchorDate`.
- **documents.ts** — retitle PDFs + `extracted_fields`; keep `DEMO_DOCS_BY_PROTOCOL` keys.
- **participants.ts** — rebalance to **3-4 participants per protocol** (was 8/2/1); per-protocol status spread + ≥1 open deviation so the Reports tab has compliance %, deviation log, missed visits. Indication-accurate `notes` / `next_visit_name`.
- **visits.ts** — re-theme `visitName` / `procedures` / `priorNote` / `deviationReason` per indication; keep ids/dates/statuses/counts; each protocol's visits reference its own participants.
- **teamMembers.ts** — keep roles/structure; indication-fit `delegated_tasks` / names.
- **visitTemplates.ts** — re-theme template names/procedures, same structure.
- **askResponses.ts** — rewrite the 4 Q&A per protocol grounded in real study design; keep `DEMO_FALLBACK_ASK_RESPONSE`.
- **ids.ts** — add UUIDs for new participants; comment that protocol keys are internal aliases.
- **Reports (Site):** [ReportsTab](../../src/components/dashboard/site/ReportsTab.tsx) derives from `useSiteData()` — no separate fixture; the richer participant/visit data is what populates it.

## Scope (files allowed)

- src/lib/demo/fixtures/*.ts
- src/lib/demo/ids.ts
- src/lib/site/repos/__tests__/demoSiteRepo.test.ts
- src/lib/visit-execution/mockVisitWorkspace.ts
- src/lib/visit-execution/__tests__/visitExecutionApi.test.ts

## Out of scope (files forbidden)

- src/lib/demo/store.ts
- src/lib/site/repos/demoSiteRepo.ts
- src/lib/site/siteApi.ts
- src/context/DemoModeContext.tsx
- src/lib/visit-execution/visitExecutionApi.ts
- src/lib/visit-execution/visitExecutionExportApi.ts

> Note: `mockVisitWorkspace.ts` builds its Sprint-1 enriched workspaces from the demo
> visit templates this PR re-themed, and keys off `tpl.visit_name`. Renaming the
> primary protocol's templates therefore required re-pointing those name matches
> (and the one affected `visitExecutionApi.test.ts` assertion). Both files are
> Ishika-owned (`/src/lib/visit-execution/`), so no extra approval. Checklist item
> *content* was left as-is (re-pointed, not re-authored).

## Architecture layers touched

- [x] test (`src/**/__tests__/`)
- fixtures / demo data (`src/lib/demo/`)

## Mock data plan

Existing `demoActive` seam only — no new toggle. `piq-demo-active-v1` / `piq-demo-store-v1` unchanged (no store-shape change).

## Approved-by

- @ki-dev-piqc — for `src/lib/site/repos/__tests__/demoSiteRepo.test.ts` (Site Mode ownership)

## Verification

- [ ] `npx tsc --noEmit` clean; `npm run test` — `demoSiteRepo.test.ts` passes with new codes; visit-execution tests unaffected.
- [ ] Demo user, toggle ON: switcher shows PP06489 / CLR_18_06 / ND-L02-s0201-005; all 3 populate calendar/participants(3-4)/team/documents with no empty states.
- [ ] Reports tab shows non-trivial compliance %, deviation log, missed visits per protocol; exports fire.
- [ ] Ask tab returns indication-accurate answers; mutate→refresh persists; Reset re-seeds; Exit returns real data.
- [ ] `/piqc-review` clean (scope, Approved-by, no-new-mocks, PHI).
