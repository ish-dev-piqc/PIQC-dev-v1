# PIQClinical — Build Plan & Status

_Last updated: 2026-05-09 (Source of Truth Reviewer PR-1 → PR-7 stacked on `sotr/base`; pending dev-team review and merge)._

This document is the source of truth for "where are we." The codebase is the
source of truth for "what does it do." If the two disagree, the codebase wins
and this document needs updating.

---

## What PIQClinical is

AI-powered protocol intelligence platform for clinical trials. Two distinct
workflows sharing the same auth + protocol data:

- **Site Mode** — for clinical site users. Calendar-first overview of visits
  across protocols, participants, team delegation, compliance reports. Reads
  parsed protocol PDFs to autopopulate visit schedules and cross-references.
- **Audit Mode** — for vendor auditors. Structured 8-stage workflow carrying
  protocol risk context into questionnaire design, scope review, drafting,
  conduct, report draft, and final export.

Mode selection is a header-level toggle. Protocol selection / audit selection
also live in the header.

---

## Stack (as built)

- **Frontend**: Vite 5.4.2 + React 18.3.1 + TypeScript 5.5.3 (strict) + Tailwind 3.4.1
- **Auth + DB**: Supabase (Postgres + RLS + auth.users). Magic-link auth + email/password.
- **Edge Functions** (Deno): `dashboard-chat` (RAG), `chat`, `ingest` (Reducto pipeline + SoA extraction + Phase B fan-out), `stripe-checkout`, `stripe-portal`, `stripe-webhook`
- **Payments**: Stripe via Edge Functions + `useCheckout`/`useSubscription`/`usePortal` hooks
- **Document parsing**: Reducto Parse + Reducto Extract (structured schema for clinical fields)
- **Embeddings + RAG**: pgvector + OpenAI `text-embedding-3-small`; hybrid search via Postgres function
- **Export**: Markdown (Blob), Word `.docx` via `docx` v9.6.1, CSV (Blob)
- **Icons / styling**: lucide-react 0.344.0, pure Tailwind utilities, brand blue `#4a6fa5`
- **Tests**: Vitest 2.0 + `@testing-library/react` (entered `main` with SOTR PR-1) covering SOTR lib + components (16 test files); `scripts/smoke-rpcs.sh` 12-test bash suite for Audit Mode RPCs (T1–T12) + SOTR DB integration (T13–T40). Audit Mode JS/TS unit tests not yet written.
- **CI/CD**: `.github/workflows/deploy.yml` builds + deploys to GitHub Pages
- **Hosting**: GitHub Pages frontend + Supabase cloud project `ygfcjwgsjmathinqkppq`

---

## Build phases — every subsystem

| Phase | What | Status |
|-------|------|--------|
| Auth & sessions | Email/password + magic-link + ForgotPassword + ProfileCompletion + `AuthContext`; auth hardening migration | ✓ Done |
| Theme + Mode + Protocol/Audit pickers | `ThemeContext` (light default), `ModeContext`, `ProtocolContext` (real Supabase + realtime), `AuditContext` (real Supabase), header pickers | ✓ Done |
| Landing page | `Hero`, `ValueProps`, `Pricing` (Pilot / Workspace / Annual + Add-ons + SMO), `Contact`, `Footer`, `Chatbot` (streaming floating widget) | ✓ Done |
| Knowledge base (RAG ingest) | `pgvector` + hybrid search RPC + chunk metadata + status; `KnowledgeBase.tsx` upload UI with PDF (Reducto) and text modes; protocol-link picker (defaults to active protocol) | ✓ Done |
| Dashboard chat (Ask) | `dashboard-chat` edge function (931 lines) — protocol-scoped RAG with hybrid search + chat history | ✓ Done |
| **Site Mode foundation** | Auth + tab architecture (`Overview`, `Participants`, `Visits`, `Protocol`, `Team`, `Ask`, `Reports`) + `ProtocolRequiredGate` | ✓ Done |
| Site Mode calendar (TodayTab) | Week + month, drawers, filters, empty states, mobile vertical stacking, demo-data toggle | ✓ Done |
| Site Mode other tabs | Participants (roster + status filter + profile drawer + form drawer); Visits (sortable list + status filters + search + drawer); Team (delegation log + cert expiry); Protocol (metadata panel); Reports (compliance metrics + deviation/missed log + CSV export) | ✓ Done |
| Site Mode Supabase wire-up | `siteApi.ts` + `SiteDataContext` (realtime subs on participants/visits/team/documents); all 4 main tabs consume `useSiteData()`; demo toggle preserved for offline | ✓ Done |
| **Calendar autopopulate (Phase A)** | Ingest extracts `schedule_of_events` from PDF via Reducto Extract schema → `protocol_visit_templates` upsert → `AnchorDateModal` sets `protocols.demo_anchor_date` → `materialize_protocol_visits` RPC projects (participant × template) into `site_visits` → auto-rematerialise trigger on `site_participants.enrolled_at` changes | ✓ Done |
| **Cross-doc consistency (Phase B)** | `protocol_visit_templates.cross_references` JSONB column; ingest extracts intra-doc cross-refs via extended Reducto schema; persists `reducto_job_id` for re-Extract; `extractCrossReferencesForVisits` + `mergeCrossReferencesIntoTemplates` helpers; fan-out Path A (new SoA → scan siblings) + Path B (non-SoA doc → scan against existing templates); drawer renders "From the protocol documents" section grouped by source section | ✓ Done — **migrations + edge function deploy pending on remote** |
| Start-visit persistence | Procedure checklist → `Complete visit` calls `siteApi.updateVisit({status:'completed'})`; loading/error UX; realtime sub refreshes the visit row | ✓ Done |
| Audit Mode chassis (Phase A) | 25-table schema + RLS + state-history helpers; 3-pane shell (`AuditWorkspaceShell`, `StageNav`, `RiskSummaryPanel`); `AuditRequiredGate`; `AuditDataContext` per-audit cache | ✓ Done |
| Audit Mode Stages 1–6 (Phase B) | All 8 stage workspaces UI-complete; Stages 1–6 wired to per-stage RPCs (intake/enrichment/questionnaire/risk-summary/preAudit/workspaceEntries); stage advancement RPC; delete-protocol-risk RPC | ✓ Done |
| Audit Mode Stages 7–8 | `report_draft_objects` schema + 4 RPCs (`upsert`, `approve`, `final_sign_off`, `mark_exported`); `reportApi.ts`; Markdown + Word (.docx via `docx` v9.6.1) export; gate checklist; sign-off | ✓ Done |
| History drawer (Audit Mode) | `HistoryDrawer` calls `audit_mode_get_object_history` RPC; surfaced in every stage workspace and in `RiskSummaryPanel` (for `VENDOR_RISK_SUMMARY_OBJECT`); per-row + per-instance variants | ✓ Done |
| Heatmap intelligence overlay | `HeatmapContext` (localStorage-persisted toggle, default ON); `HeatIndicator` (bar + chip); `scoreVisit`/`scoreWorkspaceEntry`/`scoreParticipant`/`scoreStage`/`scoreFocusArea`; applied to 5 surfaces (calendar cells, workspace entries, participant rows, StageNav rail, RiskSummaryPanel focus areas) | ✓ Done |
| Mobile responsiveness | StageNav collapse → picker below `xl`; RiskSummaryPanel drawer access below `xl`; calendar week vertical stacking below `sm`; audit context header tightened on phones | ✓ Done |
| Drawer accessibility hooks | `useOverlay` (ESC, body scroll lock, focus trap, focus return); `useSwipeDismiss` (touch swipe-right). Applied across all site + audit drawers | ✓ Done |
| Typography system | Semantic `text-fg-heading` / `-body` / `-sub` / `-muted` / `-label` CSS-variable utilities (dark-mode aware); sweep complete on new code; legacy per-file `isLight ? '#…' : '…'` ternaries remain only where opacity-modified colours need them | ✓ Done |
| Protocol-linked document uploads | `KnowledgeBase` upload form has "Link to protocol" picker (defaults to active protocol); `ingest` honours explicit `protocol_id` body field and skips the auto-tag path | ✓ Done |
| Reducto Extract — clinical fields | Schema covers `protocol_title`, `protocol_number`, `protocol_version`, `sponsor_name`, `compound_name`, `therapeutic_area`, `study_phase`, `amendment` flags, `schedule_of_events` (with `cross_references` per visit) | ✓ Done |
| Auto-tag documents → protocols | `documents.protocol_id` FK + `documents_autotag_protocol_trg` trigger reads `extracted_fields.protocol_number`, normalises via `normalize_protocol_number()`, looks up against `protocols.study_number_normalized` unique index | ✓ Done |
| Magic-link auth + profile completion | `20260504000000_auth_hardening.sql`; `ProfileCompletion.tsx`; login crash fix import (Home icon) | ✓ Done |
| Stripe — frontend | Founder-launch model: 6-product catalog in `stripe-config.ts` (`PlanKind`, copy, grants); `Pricing.tsx` 3 primary + add-ons + SMO tile; `useCheckout` with `appendToSubscription` flag; `useSubscription` surfaces `kind`, `billingMode`, `pilotExpiresAt`, included + addon counts, totals; `usePortal`; `Dashboard.tsx` manage-billing affordance | ✓ Done — **test priceIds wired; swap for live priceIds before launch** |
| Stripe — backend | `stripe-checkout` edge function handles `mode: 'payment'` for Pilot and append-to-subscription for add-ons (creates new `subscriptionItems` or bumps quantity on existing); `stripe-webhook` sets `pilot_expires_at` on `stripe_customers` from Price metadata and recomputes `addon_seat_packs`/`addon_protocols` per subscription update; `stripe-portal` unchanged; tables + views extended via migration `20260511000000_stripe_pilot_and_addon_counts.sql` | ✓ Done — **needs `db push` + `functions deploy stripe-checkout stripe-webhook` + test/live key verification** |
| Entitlement primitives | `src/lib/entitlements.ts` — pure `canInviteUser`, `canAddProtocol`, `pilotStatus`, `pilotDaysRemaining`; `EntitlementGate` component for wrapping gated actions; `PilotCountdownBanner` for Dashboard pilot UX | ✓ Primitives in place; invite-team-member and create-protocol surfaces don't exist yet — gates ready to drop in when they ship |
| Server-side pilot enforcement (decision B) | Pilot expiry check on protected RPCs after early launch | ○ Deferred — frontend gate only for now per founder-launch decision |
| Smoke test (Audit Mode) | `scripts/smoke-rpcs.sh` — 12-case bash suite covering stage-advancement + per-stage RPCs (T1–T12) | ✓ Done |
| **— Outstanding —** | | |
| JS/TS unit tests | Vitest is on `main` (entered with SOTR PR-1); 16 SOTR test files exist. Audit Mode unit tests not yet written; date-utility tests still sit on `feature/scv-foundation-guardrails` | ◐ Partial — SOTR covered, Audit Mode pending |
| Heatmap real-data refinement | Today's scoring is heuristic; swap to aggregated cross-audit signals once enough audits exist | ○ Deferred |
| Subject Command View | A future product surface on `feature/scv-foundation-guardrails` (see SCV branch section below); not on `k1` | ○ Branch only |
| Remote deploys | All Phase A + B migrations + ingest function changes are on disk and on `k1`; cloud Supabase needs `db push` + `functions deploy ingest` | ○ Deploy pending |

---

## Migrations — full inventory (37)

| File | Subsystem |
|------|-----------|
| `20260417221804_enable_pgvector_and_rag_schema.sql` | RAG / KB |
| `20260417223946_allow_anon_read_documents_and_chunks.sql` | RAG / KB |
| `20260417224534_add_document_filter_to_hybrid_search.sql` | RAG / KB |
| `20260420025916_fix_hybrid_search_accept_float_array.sql` | RAG / KB |
| `20260420030419_drop_vector_overload_of_hybrid_search.sql` | RAG / KB |
| `20260420035535_fix_ivfflat_index_lists_for_small_collections.sql` | RAG / KB |
| `20260420235747_peaceful_sky.sql` | Stripe — tables + views |
| `20260423220000_add_chunk_metadata_and_document_status.sql` | RAG / KB |
| `20260423230000_hybrid_search_return_metadata.sql` | RAG / KB |
| `20260423240000_hybrid_search_ivfflat_probes.sql` | RAG / KB |
| `20260423250000_fix_hybrid_search_rank_score_type.sql` | RAG / KB |
| `20260427120000_audit_mode_phase_1_schema.sql` | Audit Mode — 25 tables, 26 enums |
| `20260427120100_audit_mode_phase_1_rls.sql` | Audit Mode — RLS scoping |
| `20260427120200_audit_mode_state_history_helpers.sql` | Audit Mode — state delta helpers |
| `20260429000000_add_extracted_fields_to_documents.sql` | Documents |
| `20260429120000_seed_audit_mock_data.sql` | Audit Mode — 3 seed audits |
| `20260430000000_add_delete_policy_to_documents.sql` | Documents |
| `20260430120000_stage_advancement_rpc.sql` | Audit Mode — stage gating |
| `20260430130000_add_user_id_to_documents.sql` | Documents |
| `20260430140000_audit_mode_vendor_enrichment_rpcs.sql` | Audit Mode Stage 2 |
| `20260430150000_audit_mode_questionnaire_rpcs.sql` | Audit Mode Stage 3 |
| `20260430160000_audit_mode_risk_summary_rpcs.sql` | Audit Mode Stage 4 |
| `20260430170000_audit_mode_pre_audit_rpcs.sql` | Audit Mode Stage 5 |
| `20260430180000_audit_mode_workspace_entry_rpcs.sql` | Audit Mode Stage 6 |
| `20260430190000_audit_mode_intake_rpcs.sql` | Audit Mode Stage 1 |
| `20260430200000_audit_mode_stage_advancement_rpc.sql` | Audit Mode — gating refined |
| `20260430210000_audit_mode_delete_protocol_risk.sql` | Audit Mode Stage 1 — delete |
| `20260501000000_audit_mode_report_draft_schema.sql` | Audit Mode Stages 7–8 |
| `20260501010000_audit_mode_report_draft_rpcs.sql` | Audit Mode Stages 7–8 |
| `20260502000000_site_mode_schema.sql` | Site Mode — participants/visits/team |
| `20260504000000_auth_hardening.sql` | Auth — magic link, profile completion |
| `20260506000000_protocol_number_normalization.sql` | Documents / linking |
| `20260506000100_add_protocol_id_to_documents.sql` | Documents / linking |
| `20260506000200_seed_site_mode_demo.sql` | Site Mode — demo seed |
| `20260507000000_protocol_visit_templates.sql` | Phase A — autopopulate |
| `20260508000000_visit_template_cross_references.sql` | Phase B — cross-doc refs |
| `20260508010000_documents_reducto_job_id.sql` | Phase B — fan-out support |
| `20260511000000_stripe_pilot_and_addon_counts.sql` | Stripe — pilot_expires_at + addon item counts + view extension |

---

## Build phases

| Phase | Scope | Status |
|-------|-------|--------|
| Site Mode foundation | Auth, navbar, shell, protocol picker, theming | ✓ Done |
| Site Mode Overview (calendar) | Week/month calendar, drawers, filters, empty states | ✓ Done |
| Site Mode other tabs | Participants, Visits, Team, Ask, Reports | ✓ Done — all real UI, mock-backed |
| Audit Mode Phase A — chassis | DB schema, 3-pane shell, stage nav, audit picker, state-delta helpers | ✓ Done |
| Audit Mode Phase B — per-stage workspaces | Real UI for all 8 audit stages | ✓ Done |
| Audit Mode Supabase wire-up (Stages 1–6) | RPCs for intake, enrichment, questionnaire, risk summary, pre-audit, conduct | ✓ Done — 39 RPCs across 7 migrations |
| Audit Mode Supabase wire-up (Stages 7–8) | `report_draft_objects` table + 4 RPCs; `reportApi.ts`; both workspaces wired | ✓ Done — 2 migrations; **remote deploy pending** |
| Heatmap / intelligence overlay | Soft-gradient risk indicators per UX spec | ✓ Done (5 surfaces) |
| Ask tab — protocol-grounded copilot | Protocol-anchored Ask with suggested prompts | ✓ Done (per-protocol doc scoping awaits ProtocolContext wire-up) |
| Mobile responsiveness pass | StageNav collapse, drawer access, calendar stacking | ✓ Done |
| History drawer | Per-object change history in each audit stage | ✓ Done — `HistoryDrawer` calls `audit_mode_get_object_history` RPC |
| Polish — semantic text tones | `text-fg-*` utilities; dark-mode-aware; sweep complete | ✓ Done |
| Polish — drawer accessibility | `useOverlay` + `useSwipeDismiss`; all drawers covered | ✓ Done |
| Visit detail drawer — Start Visit flow | Procedure checklist; Complete visit action | ✓ Done |
| ReportsTab → visit detail cross-link | Deviation/missed rows open `VisitDetailDrawer` | ✓ Done |
| Site Mode button fixes | "View in Visits" wired from ReportsTab; VisitsTab uses VisitDetailDrawer | ✓ Done |
| ProtocolContext wire-up | Replace `MOCK_PROTOCOLS` with Supabase query + realtime subscription; `isLoading` exposed | ✓ Done |
| Site Mode schema design | `site_participants`, `site_visits`, `site_team_members` + RLS | ✓ Done — migration written; remote deploy pending |
| Participant profile panel | `ParticipantProfileDrawer` — enrollment, visits, deviations, notes; shared across all surfaces | ✓ Done |
| Reports CSV export | Real CSV download from visit data; scoped to active protocol | ✓ Done |
| Word (.docx) export | Stage 8 — real OOXML via `docx` package; same gate as Markdown | ✓ Done |
| Start visit completion state | "Visit logged as complete" confirmation footer before drawer closes | ✓ Done |
| Protocol tab | Metadata panel (`ProtocolTab`) — code, sponsor, phase; documents-pending callout | ✓ Done |
| Landing page — Pricing section | `Pricing.tsx` — Starter ($10/mo) + Enterprise cards; CTA → login or dashboard | ✓ Done |
| Site Mode Supabase wire-up | API files + UI wire for visits, participants, team | ○ Not started |
| Stripe checkout wiring | Pricing CTA triggers checkout for authenticated users | ○ Not started |
| **Source of Truth Reviewer — PR-1 backend foundation** | `protocol_extracted_items` + `protocol_source_evidence` + link table; pure Reducto adapter; ingest patched to pass citations through | ✓ Done — **awaiting dev-team review on `sotr/pr-1`** |
| **Source of Truth Reviewer — PR-2 review-screen API** | `sotr_get_worksheet_item_evidence` (single + batch, cap 100); deterministic sort | ✓ Done — **awaiting review on `sotr/pr-2`** |
| **Source of Truth Reviewer — PR-3 MVP UI (Site Mode)** | `WorksheetItemsList` in ProtocolTab; right-edge `SourceTruthDrawer`; confidence badge + missing-evidence + missing-coords states | ✓ Done — **awaiting review on `sotr/pr-3`** |
| **Source of Truth Reviewer — PR-4 PDF storage foundation** | Private `protocol-pdfs` bucket + RLS; `documents.storage_path`; ingest uploads PDF; `sotr_get_protocol_pdf_storage_path`; "View cited page" opens new tab | ✓ Done — **awaiting review on `sotr/pr-4`** (embedded viewer deferred — see SOTR open questions) |
| **Source of Truth Reviewer — PR-5 draft review actions** | `worksheet_review_events` + `draft_review_action`/`draft_review_status` enums; `sotr_create_review_event`; ReviewActionBar + FlagSourceButton; version bumps on edit; source-evidence snapshots | ✓ Done — **awaiting review on `sotr/pr-5`** |
| **Source of Truth Reviewer — PR-6 draft confidence export** | `sotr_get_draft_confidence_packet` RPC + client-side CSV; required disclaimer; one row per (item × source) pair; flag fields | ✓ Done — **awaiting review on `sotr/pr-6`** |
| **Source of Truth Reviewer — PR-7 review + hardening pass** | DRY SQL helper; tightened TS types; `docs/sotr/architecture.md` + `docs/sotr/follow-ups.md` | ✓ Done — **awaiting review on `sotr/pr-7`** |

---

## Site Mode tab + Supabase wiring

| Tab | UI | Data source |
|-----|----|-------------|
| Overview (TodayTab) | ✓ Week + month, drawers, filters | `useSiteData().visits` (Supabase) |
| Participants | ✓ Roster, status filter, profile drawer, add/edit form drawer | `useSiteData().participants` (Supabase) |
| Visits | ✓ Sortable list, filters, search, detail drawer | `useSiteData().visits` (Supabase) |
| Team | ✓ Delegation log, cert expiry | `useSiteData().teamMembers` (Supabase) |
| Protocol | ✓ Metadata + documents + AnchorDateModal | `useProtocol()` + `useSiteData().documents` |
| Ask | ✓ Protocol-anchored copilot | `dashboard-chat` edge function (RAG) |
| Reports | ✓ Compliance metrics + CSV export | Derived from `useSiteData().visits` |

Realtime subscriptions cover `site_participants`, `site_visits`,
`site_team_members`, `documents` (filtered by `protocol_id` when a protocol
is active, unfiltered for cross-protocol scope).

---

## Audit Mode — 8 stages

| # | Stage | UI | Supabase | History |
|---|-------|----|----------|---------|
| 1 | INTAKE | ✓ | ✓ `intakeApi` | ✓ |
| 2 | VENDOR_ENRICHMENT | ✓ | ✓ `vendorEnrichmentApi` | ✓ |
| 3 | QUESTIONNAIRE_REVIEW | ✓ | ✓ `questionnaireApi` | ✓ |
| 4 | SCOPE_AND_RISK_REVIEW | ✓ | ✓ `riskSummaryApi` | ✓ (via RiskSummaryPanel) |
| 5 | PRE_AUDIT_DRAFTING | ✓ | ✓ `preAuditApi` | ✓ |
| 6 | AUDIT_CONDUCT | ✓ | ✓ `workspaceEntriesApi` | ✓ |
| 7 | REPORT_DRAFTING | ✓ | ✓ `reportApi` | (drawer not yet wired here) |
| 8 | FINAL_REVIEW_EXPORT | ✓ | ✓ `reportApi` | (drawer not yet wired here) |

Stage advancement is server-gated via the `advance_audit_stage` RPC.
Cross-stage approval propagates through `AuditDataContext`.

---

## Frontend module map

```
src/
  App.tsx                                   Provider tree + view dispatcher
  main.tsx
  index.css                                 Tailwind base + text-fg-* CSS vars + focus-visible rings
  stripe-config.ts                          Product catalog (1 product today)

  components/
    Navbar.tsx                              Header — mode + protocol/audit pickers, theme toggle, heatmap toggle
    Hero.tsx, ValueProps.tsx, Pricing.tsx,
    Contact.tsx, Footer.tsx, Chatbot.tsx    Landing
    auth/
      Login.tsx, ForgotPassword.tsx, ProfileCompletion.tsx
    billing/
      EntitlementGate.tsx                   Drop around a gated action to render blocker + upgrade CTA
      PilotCountdownBanner.tsx              "N days left on your pilot" banner with upgrade CTA
    heatmap/
      HeatIndicator.tsx                     Bar + chip variants
    dashboard/
      Dashboard.tsx                         Mode dispatcher + tab rail
      DashboardChat.tsx                     Chat surface (used by AskTab)
      KnowledgeBase.tsx                     Upload UI — PDF or text; "Link to protocol" picker
      site/
        TodayTab.tsx                        Calendar
        VisitDetailDrawer.tsx               Shared visit drawer — Start visit + completion (persists to Supabase)
        ParticipantProfileDrawer.tsx        View participant profile
        ParticipantFormDrawer.tsx           Add/edit participant
        ParticipantsTab.tsx                 Roster
        VisitsTab.tsx                       Visit list
        ProtocolTab.tsx                     Metadata + documents + anchor-date entry
        TeamTab.tsx                         Delegation log
        AskTab.tsx                          Protocol-grounded copilot
        ReportsTab.tsx                      Compliance metrics + CSV export
        AnchorDateModal.tsx                 Day-0 calendar date → materializeVisits
        MockCalendarToggle.tsx              Dev toggle
        ProtocolRequiredGate.tsx, SitePlaceholder.tsx
      audit/
        AuditWorkspaceShell.tsx             3-pane shell
        StageNav.tsx                        Left rail (with heatmap bars)
        RiskSummaryPanel.tsx                Right rail (drawer below xl) + History
        HistoryDrawer.tsx                   get_object_history RPC drawer
        AuditRequiredGate.tsx, StagePlaceholder.tsx
        stages/                             8 stage workspaces

  context/
    AuthContext.tsx                         Supabase auth + magic link
    ThemeContext.tsx                        Light/dark, light default
    ModeContext.tsx                         Site / Audit toggle
    ProtocolContext.tsx                     Supabase + realtime; "All protocols" support
    SiteDataContext.tsx                     Per-protocol cache + realtime subs (participants/visits/team/docs)
    AuditContext.tsx                        Active audit; localStorage-persisted
    AuditDataContext.tsx                    Per-audit cache (8 slices)
    HeatmapContext.tsx                      Layer toggle, default ON, persisted

  hooks/
    useOverlay.ts                           ESC + scroll lock + focus trap + focus return
    useSwipeDismiss.ts                      Touch swipe-right dismiss
    useCheckout.ts, useSubscription.ts, usePortal.ts     Stripe

  lib/
    supabase.ts
    heatmap.ts                              Scoring + tone tokens
    entitlements.ts                         canInviteUser / canAddProtocol / pilotStatus pure helpers
    mockCalendarData.ts                     Demo-mode visit fixtures + CalendarVisit type
    mockSiteData.ts                         Demo participants + team
    site/
      types.ts                              SiteParticipant / SiteVisit / VisitCrossReference / etc.
      siteApi.ts                            Participants CRUD, visits fetch + updateVisit, team, docs, templates, anchor, materialize
      protocolColors.ts                     Palette literal + hash-to-bucket helpers
    audit/
      intakeApi.ts, vendorEnrichmentApi.ts, questionnaireApi.ts,
      riskSummaryApi.ts, preAuditApi.ts, workspaceEntriesApi.ts,
      reportApi.ts, auditApi.ts             Stage CRUD + stage advancement
      stateHistory.ts                       get_object_history wrapper
      labels.ts                             Enum → display labels
      mock*.ts                              Type definitions + seed fixtures

  types/
    audit/                                  Schema-mirror types

supabase/
  migrations/                               37 SQL files
  functions/
    chat, dashboard-chat, ingest,
    stripe-checkout, stripe-portal, stripe-webhook

scripts/
  smoke-rpcs.sh                             12-case Audit Mode RPC suite (T1–T12)

rv1_code/                                   Legacy reference build — read-only
```

---

## Test coverage

- **`scripts/smoke-rpcs.sh`** — 12 cases (T1–T12) covering stage advancement + per-stage RPCs. Run with `SUPABASE_URL=... SUPABASE_ANON_KEY=... SUPABASE_SERVICE_ROLE_KEY=... SUPABASE_ACCESS_TOKEN=... bash scripts/smoke-rpcs.sh --cloud`.
- **Frontend unit tests via Vitest 2.0** (entered `main` with SOTR PR-1). 16 test files in `src/lib/sotr/__tests__/` and `src/components/sotr/__tests__/`. Run with `npm run test`. Audit Mode unit tests not yet written. The 33 date-utility test cases on `feature/scv-foundation-guardrails` are not merged (separate branch).
- **No Phase B smoke test yet.** End-to-end Phase B verification (upload protocol PDF → SoA + cross-refs → upload supplementary doc → fan-out merge → drawer renders refs) is manual today.

---

## Current state — Source of Truth Reviewer (SOTR)

**SOTR is a draft review aid** that lets a user inspect a parsed protocol field, see where it came from in the original PDF, and accept / edit / reject / flag it while preparing a draft worksheet. It is **not** a final approval system, electronic signature system, Part 11 system, or GxP system of record. Final approval, authentication, and controlled release happen outside PIQC.

### PR stack (all on `sotr/base`, NOT on `main`)

```
sotr/pr-7 ◀─ PR-7 review + hardening (this is the head; review here)
sotr/pr-6 ◀─ PR-6 CSV export
sotr/pr-5 ◀─ PR-5 draft review actions
sotr/pr-4 ◀─ PR-4 PDF storage foundation
sotr/pr-3 ◀─ PR-3 MVP UI (Site Mode)
sotr/pr-2 ◀─ PR-2 review-screen API
sotr/pr-1 ◀─ PR-1 backend data foundation
sotr/base ◀─ untouched; dev team merges into here, never into main
```

Each PR is independently reviewable. They merge in order into `sotr/base`. The dev team merges `sotr/base` into `main` after all 7 are reviewed.

### What ships in this stack

| Layer | What it does | Where to look |
|---|---|---|
| Schema + RPCs | 8 SOTR migrations: items, evidence, links, review events, PDF storage, export | `supabase/migrations/2026050{8,9}*_sotr_*.sql` |
| Parser adapter | Pure function `mapReductoExtractToSotr` | `src/lib/sotr/sourceEvidenceAdapter.ts` |
| Ingest patches | (1) passes Reducto citations through, (2) uploads PDF to bucket | `supabase/functions/ingest/index.ts` |
| TypeScript wrappers | One per concern: read, review, PDF URL, export | `src/lib/sotr/*Api.ts` |
| Mode-agnostic UI | 10 components in `src/components/sotr/` | `WorksheetItemsList`, `SourceTruthDrawer`, `ReviewActionBar`, `DownloadDraftPacketButton`, etc. |
| Site Mode wiring | Single line added to ProtocolTab; Audit Mode wiring is an open question (see below) | `src/components/dashboard/site/ProtocolTab.tsx` |
| Tests | 90+ cases across 15 test files + smoke T13–T40 | `src/**/__tests__/`, `scripts/smoke-rpcs.sh` |
| Docs | Architecture map + 10-item follow-ups list | `docs/sotr/architecture.md`, `docs/sotr/follow-ups.md` |

### What's left to review (dev-team checklist)

For each `sotr/pr-N` branch, the commit message documents acceptance criteria + "manual verify after deploy" steps. The dev team should:

1. **Review each PR independently** in the order PR-1 → PR-7. Each one is small enough to read in a sitting.
2. **Confirm the migration ordering** is safe: `2026050800XXXX` (PR-1→PR-6) then `20260509000000` (PR-7 cleanup). All `CREATE OR REPLACE` calls are additive.
3. **Run the test suite** — `npm install && npm run typecheck && npm test`. Should pass on every PR in the stack.
4. **Run the smoke tests** — `bash scripts/smoke-rpcs.sh --cloud`, T13 through T40 cover SOTR end-to-end against a real Supabase.
5. **Verify the Site Mode UX manually** — open ProtocolTab on a seeded protocol, walk through the 5 review actions + the CSV export.
6. **Confirm the language sweep** — `grep -rniE "approve|signed|certif|gxp|part 11" src/components/sotr src/lib/sotr` should turn up only negative usage and unrelated technical terms ("signed URL").
7. **Decide on the open questions below** before the stack merges or as immediate follow-ups.

### SOTR open questions (need dev/product decisions)

| ID | Question | Options | Recommendation |
|---|---|---|---|
| **S-001** | Should the embedded PDF viewer ship now or be a separate PR? | (a) build PR-8 with `react-pdf` + page jump now; (b) ship the stack as-is — "View cited page" opens a new tab; defer the viewer to a later sprint | **(b)** — the storage foundation is in place; the viewer is meaningful work and should not block the rest of the stack |
| **S-002** | Audit Mode wiring of the SOTR drawer — when? | (a) include in this stack as PR-8; (b) defer to a dedicated PR after Audit Mode stage UX is reviewed | **(b)** — components are mode-agnostic by design; wiring is purely additive but each audit stage has its own context |
| **S-003** | Reducto coordinate system for highlights | unverified — top-left vs. bottom-left origin, points vs. normalized | upload a known protocol, inspect raw response, write the conversion helper, verify against viewer **before** rendering any highlights |
| **S-004** | Backfill `documents.storage_path` for pre-PR-4 documents | (a) accept the gap and document; (b) re-ingest from source; (c) bulk-delete pre-PR-4 docs in dev/staging | dev-team call. Production: probably (a). Staging: probably (c) |
| **S-005** | Review history display in the SOTR drawer | events are stored + exported; not yet shown in UI | low-priority follow-up — events are durable in DB and visible via the CSV |
| **S-006** | Optimistic concurrency on `edit_draft_item` | concurrent edits silently overwrite (both events recorded; latest `current_text` wins) | accept for now — review event log preserves both attempts |
| **S-007** | Bulk review mode | not built; explicitly out of Sprint 7 scope | revisit if reviewers consistently work through hundreds of items per study |

### SOTR — UX/UI decisions to make

These came up during the build but were resolved with a default; flagging so design can confirm or override:

| Area | Default chosen | Alternative to consider |
|---|---|---|
| **Action bar placement** | Bottom of `SourceTruthPanel` (below sources) | Sticky bar at top; per-source rather than per-item |
| **Status badge for `draft`** | Hidden (reduces visual noise — only non-default statuses show) | Always visible — would flag every untouched item |
| **Edit form** | Inline textarea inside the drawer (not a separate modal) | Full-screen modal for longer edits |
| **Reviewer note** | Optional for all actions; encouraged via placeholder copy on reject/flag | Required for reject/flag |
| **Source navigation** | Prev/Next + "Source 1 of 3" counter | Tab list of all sources |
| **Drawer close after action** | Stays open after Accept/Edit/Reject/Flag (user can review further) | Auto-close + toast confirmation |
| **Status pill colors** | Emerald (accepted) / Blue (edited) / Rose (rejected) / Amber (flagged) | Match Site Mode's existing status palette if different |
| **"View cited page" target** | Opens in new tab with `noopener,noreferrer` | Embedded viewer (S-001) |
| **CSV format** | One row per (item × source) pair | One row per item with sources joined into a text column |
| **Disclaimer placement** | Top 5 lines of the CSV as `# `-prefixed metadata | A `disclaimer` column repeated on every row |

### SOTR — alignment questions for product / legal / compliance

These need a non-engineer's call before the feature is shown to customers:

1. **Disclaimer wording.** The CSV exports include this exact string:
   > "This export was generated by PIQC as a source-backed draft review aid. Final approval, authentication, signature, and controlled release occur outside PIQC in the customer's designated process or system."
   
   Does compliance / legal / product approve this wording? Should it be configurable per customer?

2. **Feature naming.** Is "Source Truth Panel" the right user-facing name? "Download Draft Confidence Packet" the right CTA? Marketing should sign off before this hits a customer-facing release.

3. **Reviewer notes — privacy posture.** Notes are stored in the DB unredacted (the user wrote them; the user can see them). They are scoped via RLS to the document owner. Notes are **never logged**. Is this acceptable, or should reviewer notes be encrypted-at-rest separately, redacted in the export, or scoped more narrowly?

4. **Multi-user studies.** Right now the RLS gate is `documents.user_id = auth.uid()`. If a study has multiple reviewers (a coordinator + a PI), only the document uploader sees their items. Is that the intended product behavior, or should the gate be team-based (matches Site Mode `site_team_members`)?

5. **Reviewer ID display.** Review events store `reviewer_id` (UUID) but no name. The CSV export currently shows the UUID. Should the export resolve to a friendly name (requires a join to `auth.users` or a profile table)?

6. **Disclaimer in audit-mode reports.** The Audit Mode Stage 8 final report (Markdown + .docx) does **not** currently carry the SOTR disclaimer. Should it, given that audit reports may cite parsed protocol content?

7. **Per-study export filters.** The CSV is whole-study only. Should there be filters (per-visit, per-field-type, only-flagged, only-needs-review)?

8. **PDF retention policy.** PR-4 stores the original PDF in `protocol-pdfs` bucket indefinitely. What is the retention policy — keep forever, or auto-purge after a study closes?

### SOTR — dev/architecture follow-ups

Captured in `docs/sotr/follow-ups.md` (full detail with options + trade-offs):

- **F-001** — Embedded PDF viewer + page jump + highlight overlay
- **F-002** — Verify Reducto's coordinate system (paired with F-001)
- **F-003** — Audit Mode wiring of the SOTR drawer
- **F-004** — Backfill decision for pre-PR-4 documents
- **F-005** — Review history display in the drawer
- **F-006** — Optimistic concurrency on edit
- **F-007** — Bulk review mode (out of scope unless re-prioritized)
- **F-008** — Convert `field_type` to enum once vocabulary stabilizes
- **F-009** — Surface `created_at` / `updated_at` in item RPCs
- **F-010** — PDF / DOCX export alternatives

**Explicitly out of scope** unless product re-approves: electronic signature, final approval, Part 11 / GxP audit-trail features, protocol chat in the SOTR drawer, amendment diffing, analytics dashboards, writing annotations back to the source PDF.

---

## Open decisions

| ID | Question | Impact |
|----|----------|--------|
| D-004 | When does SOP parsing land? | `checkpoint_ref` is plain text for now |
| D-005 | Trust posture scoring model | Trust assessment enums |
| D-007 | Evidence attachment versioning | Single-version + metadata for now |
| D-009 | PIQC → Vendor PIQC API contract | Protocol payload format; blocks Protocol tab |
| S-001…S-007 | SOTR product/UX questions | See "Source of Truth Reviewer" section above |

---

## What's NOT built (and intentionally so)

- **Site Mode Supabase wire-up** — schema is designed (`20260502000000`); API files + UI wire still needed.
- **Protocol tab documents** — metadata panel is live; full document content blocked on D-009 (Reducto pipeline).
- **"Start visit" persistence** — checklist completion and confirmation state are local only; no DB write.
- **Stripe checkout wiring** — `Pricing.tsx` CTA goes to login; `useCheckout` hook exists but checkout not triggered from the landing page yet.
- **Participant profile — full page** — `ParticipantProfileDrawer` is mock-backed; no dedicated route or Supabase-backed profile page.
- **SOTR — embedded PDF viewer** — PR-4 ships only the storage foundation. "View cited page" opens a new tab. Embedded viewer + page jump + highlight overlay deferred (S-001 / F-001).
- **SOTR — Audit Mode wiring** — Site Mode only. Components are mode-agnostic; Audit Mode wiring is a separate PR (S-002 / F-003).
- **SOTR — review history display in drawer** — events are stored + included in the CSV; not yet shown in the UI (S-005 / F-005).

---

## How to test the current build

1. `npm install`
2. `npm run dev` (Vite → `localhost:5173`)
3. Sign in (Supabase auth)
4. **Site Mode**: pick a protocol or use "All protocols" → Overview calendar. Navigate, filter, click visits. From ReportsTab, click a deviation row to open the visit drawer, then "View in Visits."
5. **Audit Mode**: pick an audit from the header picker. Three seeded audits:
   - **CRO QC oversight — BRIGHTEN-2** (Aurora): Stage 3, mid-flow
   - **Central lab data integrity — CARDIAC-7** (Helix Diagnostics): Stage 1, fresh
   - **ePRO platform GxP audit — IMMUNE-14** (PatientPulse): Stage 5, mostly approved
6. **Smoke test Audit RPCs** (requires migrations deployed + cloud credentials):
   ```
   SUPABASE_URL=https://ygfcjwgsjmathinqkppq.supabase.co \
   SUPABASE_ANON_KEY=<anon> \
   SUPABASE_SERVICE_ROLE_KEY=<service> \
   SUPABASE_ACCESS_TOKEN=<bearer> \
     bash scripts/smoke-rpcs.sh --cloud
   ```
7. **Test the SOTR feature** (`sotr/pr-7` head):
   - `git checkout sotr/pr-7 && npm install && npm run typecheck && npm test` — all 90+ test cases.
   - Deploy SOTR migrations: `npx supabase db push --project-ref <ref>` (8 SOTR migrations land in order).
   - Smoke tests T13–T40 cover SOTR end-to-end and run as part of `bash scripts/smoke-rpcs.sh --cloud`.
   - Manual: Site Mode → Protocol tab → "Parsed protocol items" panel. Open the drawer on any item, walk through Accept / Edit / Reject / Flag / Flag Source. Click "Download Draft Confidence Packet" → CSV downloads with disclaimer at top. "View cited page in protocol" opens the signed URL in a new tab (only for freshly-ingested PDFs — see S-004).

---

## Branches in repo

| Branch | Purpose | State |
|--------|---------|-------|
| `main` | Production target | At `b8cdd68` (= `k1`) |
| `k1` | Active dev branch | Current; matches `main` |
| `fix-duplicate-billing` | Local-only fix branch | Stale |
| `origin/feature/scv-foundation-guardrails` | Six One Labs Sprint 0.5 — Vitest, feature flag, dateUtils extraction + 3 planning docs (`SUBJECT_COMMAND_CANVAS.md`, `REPO_CONTEXT_REPORT.md`, `CODE_REVIEW_REPORT.md`) | Open for review; not merged |
| `origin/feature/ish-chat1` | RAG chat work | Archived |
| `origin/feature/ishika-auth`, `feature/ishika-oauth` | Auth iterations | Archived |
| `origin/feature/ishika-reducto` | Reducto pipeline | Merged into main |
| `origin/feature/ishika-stage-2-6` | Audit stages 2–6 | Merged into main |
| `origin/bug/login-fix` | Login crash | Merged into main |
| `origin/ish-database` | Schema work | Merged into main |
| `origin/rv1`, `origin/original-upstream` | Legacy references | Read-only |

```
src/
  components/
    Navbar.tsx                              Header — mode + protocol/audit pickers
    Hero.tsx                                Landing — hero section
    ValueProps.tsx                          Landing — how it works + why it matters + modes
    Pricing.tsx                             Landing — Starter ($10/mo) + Enterprise pricing cards
    Contact.tsx                             Landing — contact form
    Footer.tsx                              Landing — footer nav
    Chatbot.tsx                             Landing — floating AI chatbot (streaming)
    dashboard/
      Dashboard.tsx                         Mode dispatcher + tab rail
      site/
        TodayTab.tsx                        Calendar (week + month, drawers)
        VisitDetailDrawer.tsx               Shared visit detail panel; Start Visit checklist + completion state
        ParticipantProfileDrawer.tsx        Participant profile — enrollment, visits, deviations, notes
        ParticipantsTab.tsx                 Participant roster, status filter; row click → ParticipantProfileDrawer
        VisitsTab.tsx                       Visit list, status filters + search; uses VisitDetailDrawer
        ProtocolTab.tsx                     Protocol metadata panel — code, sponsor, phase; documents callout
        TeamTab.tsx                         Delegation log, cert expiry
        AskTab.tsx                          Protocol-anchored copilot
        ReportsTab.tsx                      Compliance metrics, deviation/missed logs; real CSV export
        ProtocolRequiredGate.tsx            Gate for per-protocol tabs
      sotr/                                 SOURCE OF TRUTH REVIEWER — mode-agnostic UI (PR-3 + PR-4 + PR-5 + PR-6)
        ConfidenceBadge.tsx                 4-state pill (high/medium/low/needs_review)
        ReviewStatusBadge.tsx               Draft review status pill (PR-5)
        WorksheetItemRow.tsx                Item row + value + badges + "View Source"
        WorksheetItemsList.tsx              List grouped by field_type; hosts drawer + download button
        SourceTruthDrawer.tsx               Right-edge drawer; ESC/swipe/backdrop close
        SourceTruthPanel.tsx                Drawer content: confidence header, source nav, fallback states
        ViewCitedPageButton.tsx             Per-source — opens signed PDF URL in new tab (PR-4)
        FlagSourceButton.tsx                Per-source flag action (PR-5)
        ReviewActionBar.tsx                 4-button action bar with inline edit/note states (PR-5)
        DownloadDraftPacketButton.tsx       Triggers CSV export with disclaimer (PR-6)
      audit/
        AuditWorkspaceShell.tsx             3-pane layout
        StageNav.tsx                        Left rail
        RiskSummaryPanel.tsx                Right rail
        HistoryDrawer.tsx                   Change history drawer (calls getObjectHistory RPC)
        stages/
          IntakeWorkspace.tsx               Stage 1 — ✓ Supabase
          VendorEnrichmentWorkspace.tsx     Stage 2 — ✓ Supabase
          QuestionnaireReviewWorkspace.tsx  Stage 3 — ✓ Supabase
          ScopeReviewWorkspace.tsx          Stage 4 — ✓ Supabase
          PreAuditDraftingWorkspace.tsx     Stage 5 — ✓ Supabase
          AuditConductWorkspace.tsx         Stage 6 — ✓ Supabase
          ReportDraftingWorkspace.tsx       Stage 7 — ✓ Supabase
          FinalReviewExportWorkspace.tsx    Stage 8 — ✓ Supabase
  context/
    AuthContext, ThemeContext, ModeContext
    ProtocolContext.tsx                     Protocol picker — Supabase ✓ (SELECT + realtime)
    AuditContext.tsx                        Audit picker — Supabase ✓
    AuditDataContext.tsx                    Per-stage cache; all 8 stages load from Supabase
    HeatmapContext.tsx                      Heatmap layer toggle
  lib/
    supabase.ts                             Supabase client
    sotr/                                 SOURCE OF TRUTH REVIEWER — wrappers (PR-1 + PR-2 + PR-4 + PR-5 + PR-6)
      sourceEvidenceAdapter.ts              Pure Reducto → SOTR mapper (PR-1)
      sourceEvidenceApi.ts                  Read-side: list items + single/batch evidence fetch
      protocolPdfApi.ts                     Signed-URL fetch (60s TTL) (PR-4)
      reviewApi.ts                          createReviewEvent — all 5 draft actions (PR-5)
      exportApi.ts                          Draft Confidence Packet CSV builder + download (PR-6)
    audit/
      intakeApi.ts                          Stage 1 — Supabase RPCs
      vendorEnrichmentApi.ts                Stage 2 — Supabase RPCs
      questionnaireApi.ts                   Stage 3 — Supabase RPCs
      riskSummaryApi.ts                     Stage 4 — Supabase RPCs
      preAuditApi.ts                        Stage 5 — Supabase RPCs
      workspaceEntriesApi.ts                Stage 6 — Supabase RPCs
      reportApi.ts                          Stages 7–8 — Supabase RPCs
      auditApi.ts                           advance_audit_stage RPC
      stateHistory.ts                       getObjectHistory (wraps audit_mode_get_object_history)
      labels.ts                             Enum → display label maps
      mock*.ts                              Type definitions + seed fixtures (all live data now from Supabase)
    mockCalendarData.ts                     Site Mode calendar mock data
    mockSiteData.ts                         Participants + Team mock data
    heatmap.ts                              Heat scoring + tone tokens
  hooks/
    useOverlay.ts                           ESC close, scroll lock, focus trap, focus return
    useSwipeDismiss.ts                      Touch swipe-right-to-dismiss
    useCheckout.ts                          Stripe checkout hook
    useSubscription.ts                      Subscription state hook
    useWorksheetItemEvidence.ts             SOTR drawer fetch state (PR-3)
  types/
    audit/                                  TS mirrors of the audit schema
    sotr/                                   SOURCE OF TRUTH REVIEWER types (PR-1 + PR-2 + PR-5)

supabase/
  migrations/                               40 migrations total — schema, RLS, RPCs, seeds
                                            (8 SOTR migrations: 2026050800XXXX–20260509000000)
  functions/
    dashboard-chat/                         RAG chat edge function
    ingest/                                 Document ingestion edge function (patched in PR-1 + PR-4)

docs/
  sotr/                                     SOURCE OF TRUTH REVIEWER docs (PR-7)
    architecture.md                         Layer boundaries, authorization, privacy, naming policy
    follow-ups.md                           10-item deferred-work list (F-001…F-010) + out-of-scope

scripts/
  smoke-rpcs.sh                             RPC smoke tests — Audit Mode T1–T12, SOTR T13–T40

# Redeploy ingest edge function (Phase B + protocol_id pass-through)
SUPABASE_ACCESS_TOKEN=<token> npx supabase functions deploy ingest --project-ref ygfcjwgsjmathinqkppq

# Verify
bash scripts/smoke-rpcs.sh --cloud   # T1–T12 pass
```

---

## Next up

In priority order:

**Immediate — review + merge the SOTR PR stack:**
1. Dev team reviews `sotr/pr-1` → `sotr/pr-7` in order, each merging into `sotr/base` (NOT `main`).
2. Decide S-001 → S-007 (see SOTR open questions).
3. Push all SOTR migrations to remote Supabase (8 migrations: `20260508000000` → `20260509000000`).
4. Run `bash scripts/smoke-rpcs.sh --cloud` — T13–T40 cover SOTR end-to-end.
5. Merge `sotr/base` → `main` once review + smoke pass.

**Immediate — deploy other pending migrations (independent of SOTR):**
6. Push pending pre-SOTR migrations to remote Supabase:
   - `20260501000000` + `20260501010000` — Stage 7–8 report draft schema + RPCs
   - `20260502000000` — Site Mode schema (`site_participants`, `site_visits`, `site_team_members`)
   - `20260508000000` — `protocol_visit_templates.cross_references` JSONB column
   - `20260508010000` — `documents.reducto_job_id` text column
   ```
   SUPABASE_ACCESS_TOKEN=<token> npx supabase db push --project-ref ygfcjwgsjmathinqkppq
   ```
7. Run `bash scripts/smoke-rpcs.sh --cloud` — T11 + T12 cover Stage 7–8 RPCs.

**Track C — Site Mode Supabase wire-up (schema deployed; ready to build):**
8. **API files** — `visitsApi.ts`, `participantsApi.ts`, `teamApi.ts` — mirror the audit API pattern.
9. **Wire UI** — swap mock reads in TodayTab, ParticipantsTab, VisitsTab, TeamTab. ReportsTab + ParticipantProfileDrawer derive automatically once sources are live.

**Track D — Stripe checkout:**
10. Wire `Pricing.tsx` "Get started" CTA to `useCheckout` for authenticated users (currently sends to login).
11. Post-login redirect to checkout (or dashboard-level upgrade flow).

**Track E — SOTR follow-ups (after the stack merges; see `docs/sotr/follow-ups.md`):**
12. **F-001 + F-002** — embedded PDF viewer + coordinate-system verification (paired).
13. **F-003** — Audit Mode wiring of the SOTR drawer (additive; mode-agnostic components ready).
14. **F-005** — review history display in the drawer (events already stored).
15. Lower-priority follow-ups F-004, F-006, F-008, F-009, F-010 as prioritized.

**Deferred:**
- Heatmap real-data refinement — swap heuristics once enough audits exist.

After resolving merge commits locally, sync GitHub with `git push origin <branch>` (for example `git push origin k1`).

---

## Claude model guidance

| Task | Model |
|------|-------|
| ProtocolContext wire-up | Sonnet — `protocols` table already exists; straightforward SELECT |
| Site Mode schema design | **Opus** — new schema with RLS, foreign keys, scope decisions |
| Site Mode API + UI wire-up (once schema set) | Sonnet |
| Bug fixes in a single file | Sonnet |
| Schema migrations (new tables, indexes) | **Opus** |
| Stripe integration | **Opus** |
| Landing page / marketing UI | Sonnet |
| SOTR — embedded PDF viewer (F-001) + coordinate verification (F-002) | **Opus** — viewer infra + verified coordinate translation |
| SOTR — Audit Mode wiring (F-003) | Sonnet — additive; components are mode-agnostic |
| SOTR — review history UI (F-005) | Sonnet — read-only RPC + collapsed list |

---

## Polish system reference

- **Text tones**: `text-fg-heading`, `text-fg-body`, `text-fg-sub`, `text-fg-muted`,
  `text-fg-label`. CSS variables in `src/index.css`; `fg.*` in `tailwind.config.js`;
  auto-switches with `html.dark`. Sweep complete — opacity-modified variants
  (e.g. `text-[#374152]/25`) remain as per-file constants by design.
- **Drawer pattern**: every right-edge drawer composes `useOverlay({ isOpen, onClose, containerRef })`
  with the panel's ref + `useSwipeDismiss({ onClose })` spread on the panel element.
  This handles ESC, scroll lock, focus trap, focus return, and touch swipe-right.

---

## Subject Command View (SCV) — future work

A separate product surface scoped on `origin/feature/scv-foundation-guardrails`. Per
SCV's own `SUBJECT_COMMAND_CANVAS.md`:

- **What it IS**: a coordinator-facing visit-readiness + protocol-anchored research
  assistant. Reads protocol_visit_templates, site_participants, site_visits,
  protocol_risk_objects, document_chunks.
- **What it is NOT**: not a CTMS, not EDC/eSource, not Part 11, no PHI/PII, not
  clinical decision support, not source documentation, not deviation
  adjudication.
- **Sprint 0.5 (on branch)**: pure infrastructure — feature flag (`FLAGS.SUBJECT_COMMAND_VIEW`),
  Vitest framework, shared `dateUtils` extracted from TodayTab + VisitDetailDrawer
  with 33 test cases. Zero product UI, zero migrations, zero runtime change.
- **Status on `k1`**: not present.

---

## Questions

Product / scope questions → Kiara.
Build / code questions → file headers and inline comments.
SOTR-specific questions → `docs/sotr/architecture.md` (boundaries + invariants), `docs/sotr/follow-ups.md` (deferred work + open questions S-001…S-007), and the per-PR commit messages on `sotr/pr-{1..7}`.
