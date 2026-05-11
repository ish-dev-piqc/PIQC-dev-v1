# PIQClinical — Build Plan & Status

_Last updated: 2026-05-11 (full repo audit — every subsystem, mapped to on-disk evidence)_

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
- **Tests**: `scripts/smoke-rpcs.sh` (12-test bash suite for Audit Mode RPCs); no JS/TS unit-test framework wired in repo today (the `feature/scv-foundation-guardrails` branch adds Vitest but hasn't been merged)
- **CI/CD**: `.github/workflows/deploy.yml` builds + deploys to GitHub Pages
- **Hosting**: GitHub Pages frontend + Supabase cloud project `ygfcjwgsjmathinqkppq`

---

## Build phases — every subsystem

| Phase | What | Status |
|-------|------|--------|
| Auth & sessions | Email/password + magic-link + ForgotPassword + ProfileCompletion + `AuthContext`; auth hardening migration | ✓ Done |
| Theme + Mode + Protocol/Audit pickers | `ThemeContext` (light default), `ModeContext`, `ProtocolContext` (real Supabase + realtime), `AuditContext` (real Supabase), header pickers | ✓ Done |
| Landing page | `Hero`, `ValueProps`, `Pricing` (Starter $10/mo + Enterprise), `Contact`, `Footer`, `Chatbot` (streaming floating widget) | ✓ Done |
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
| Stripe — frontend | `Pricing.tsx` three-state CTA (unauth→login, auth+no-sub→checkout, auth+sub→dashboard); `useCheckout`, `useSubscription`, `usePortal`; `Dashboard.tsx` manage-billing affordance | ✓ Done |
| Stripe — backend | `stripe-checkout` (227 lines), `stripe-portal` (69 lines), `stripe-webhook` (192 lines) edge functions; `stripe_customers` + `stripe_subscriptions` + `stripe_orders` tables; `stripe_user_subscriptions` + `stripe_user_orders` views (security_invoker) | ✓ Done — **needs verification with live/test Stripe keys** |
| Smoke test (Audit Mode) | `scripts/smoke-rpcs.sh` — 12-case bash suite covering stage-advancement + per-stage RPCs (T1–T12) | ✓ Done |
| **— Outstanding —** | | |
| JS/TS unit tests | `scripts/smoke-rpcs.sh` covers SQL only. The `feature/scv-foundation-guardrails` branch adds Vitest + `dateUtils` tests, but isn't merged | ○ Not in main |
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

---

## Edge Functions

| Function | Lines | Purpose |
|----------|-------|---------|
| `chat` | 315 | Lightweight chat helper |
| `dashboard-chat` | 931 | Protocol-scoped RAG chat — hybrid search + chunk citations |
| `ingest` | 1,135 | Reducto Parse + Extract pipeline; SoA extraction; `protocol_visit_templates` upsert; Phase B cross-ref helpers + fan-out; persists `reducto_job_id`; honours caller `protocol_id` |
| `stripe-checkout` | 227 | Creates Stripe checkout session |
| `stripe-portal` | 69 | Creates Stripe billing portal session |
| `stripe-webhook` | 192 | Syncs Stripe subscription/order events to Postgres |

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
- **No frontend unit tests on `main`/`k1`.** Vitest infrastructure + 33 date-utility test cases sit on `feature/scv-foundation-guardrails` but are not merged.
- **No Phase B smoke test yet.** End-to-end Phase B verification (upload protocol PDF → SoA + cross-refs → upload supplementary doc → fan-out merge → drawer renders refs) is manual today.

---

## Open decisions

| ID | Question | Impact |
|----|----------|--------|
| D-004 | When does SOP parsing land? | `checkpoint_ref` is plain text for now |
| D-005 | Trust posture scoring model | Trust assessment enums |
| D-007 | Evidence attachment versioning | Single-version + metadata for now |
| D-009 | PIQC → Vendor PIQC API contract | Protocol payload format; affects auto-link reliability |

---

## What's NOT built (and intentionally so)

- **3-pane shell for Site Mode workspaces** — Site Mode is a flat tab rail today; Audit Mode uses a 3-pane shell.
- **PR notifications / multi-user collaboration** — single-user surfaces for now.
- **Mobile native apps** — web-only.
- **External API for protocols / audits** — `D-009` decides the shape first.

---

## How to test the current build

1. `npm install`
2. `npm run dev` → Vite at `localhost:5173`
3. Sign in (email/password or magic link)
4. **Site Mode**: pick a protocol → Overview, then Participants, Visits, Team, Protocol, Ask, Reports. Click visits, mark one complete (DB row should update via realtime). Upload a doc via Knowledge Base linked to a protocol.
5. **Audit Mode**: pick an audit (3 seeded — `BRIGHTEN-2`, `CARDIAC-7`, `IMMUNE-14`). Walk Stages 1–6, advance via gates. Stage 7–8 produce a draft report + final export (Markdown + .docx).
6. **Stripe**: Pricing CTA on landing — checkout works against the configured Stripe price.
7. **Audit smoke tests**: `bash scripts/smoke-rpcs.sh --cloud` (needs cloud creds).
8. **Phase B end-to-end** (after deploy): upload a protocol PDF with a Schedule of Assessments → confirm rows land in `protocol_visit_templates` with `cross_references` populated; upload a supplementary doc (IB / lab manual) with the same `protocol_number` (or pick the protocol explicitly) → confirm fan-out merges cross-refs onto the existing templates. Open the visit drawer → "From the protocol documents" section renders the merged refs.

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

---

## Deploy queue

Pending pushes to remote Supabase:

```
# Push migrations
SUPABASE_ACCESS_TOKEN=<token> npx supabase db push --project-ref ygfcjwgsjmathinqkppq

# Redeploy ingest edge function (Phase B + protocol_id pass-through)
SUPABASE_ACCESS_TOKEN=<token> npx supabase functions deploy ingest --project-ref ygfcjwgsjmathinqkppq

# Verify
bash scripts/smoke-rpcs.sh --cloud   # T1–T12 pass
```

Local `k1` is 2 commits ahead of `origin/k1` (two merge-from-main commits) —
`git push origin k1` syncs the GitHub side.

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

Product / scope → Kiara.
Build / code → file headers + inline comments (every non-trivial file has a top comment).
