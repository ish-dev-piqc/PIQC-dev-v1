# PIQClinical — Build Plan & Status

_Last updated: 2026-05-02 (participant profiles live; CSV + docx exports real; pricing section added; completion state wired)_

This document is the source of truth for "where are we." The codebase is the
source of truth for "what does it do."

---

## What PIQClinical is

PIQC is an AI-powered protocol intelligence platform for clinical trials. The
product carries structured risk context from a parsed protocol forward into
two distinct workflows:

- **Site Mode** — for clinical site users. Calendar-first overview of visits
  across protocols, participants, team delegation, compliance reports. Replaces
  ad-hoc spreadsheets.

- **Audit Mode** — for vendor auditors. Structured 8-stage workflow carrying
  protocol risk context into questionnaire design, scope review, drafting, and
  audit conduct. Replaces free-text note-taking with a relational,
  evidence-linked workspace.

Both modes share the same codebase, login, and protocol data once Supabase is
fully wired. Mode selection is a header-level toggle.

---

## Stack

- **Frontend**: Vite + React 18 + TypeScript + Tailwind CSS
- **Auth + DB**: Supabase (Postgres with RLS + auth.users)
- **AI**: Supabase Edge Functions — `dashboard-chat` (RAG), `ingest` (document pipeline)
- **Payments**: Stripe via `stripe-checkout` Edge Function; `useCheckout` + `useSubscription` hooks in place
- **Export**: Markdown (Blob download); Word (.docx) via `docx` npm package (v9)
- **Components**: lucide-react icons; pure Tailwind styling
- **Tests**: `scripts/smoke-rpcs.sh` covers Audit Mode RPCs (T1–T12); broader test suite not yet in place

---

## Upstream context

PIQC ingests parsed protocol data via Reducto (third-party document parsing)
once that pipeline is wired. The upstream API contract is unresolved (**D-009**)
— both modes read mock data so the UI can land ahead of the pipeline.

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

---

## Current state — Audit Mode

### Foundation (Phase A) — ✓ done

- Schema + RLS migrations deployed to local and remote Supabase
- `seed_audit_mock_data` seeds 3 audits for testing
- `AuditContext` reads live audits from Supabase with auth + localStorage persistence
- 3-pane workspace shell, stage nav, risk summary panel, audit-required gate

### Per-stage workspaces — ✓ all done, all wired

| # | Stage | UI | Supabase |
|---|-------|----|----------|
| 1 | INTAKE | ✓ | ✓ — `intakeApi.ts` |
| 2 | VENDOR_ENRICHMENT | ✓ | ✓ — `vendorEnrichmentApi.ts` |
| 3 | QUESTIONNAIRE_REVIEW | ✓ | ✓ — `questionnaireApi.ts` |
| 4 | SCOPE_AND_RISK_REVIEW | ✓ | ✓ — `riskSummaryApi.ts` |
| 5 | PRE_AUDIT_DRAFTING | ✓ | ✓ — `preAuditApi.ts` |
| 6 | AUDIT_CONDUCT | ✓ | ✓ — `workspaceEntriesApi.ts` |
| 7 | REPORT_DRAFTING | ✓ | ✓ — `reportApi.ts` |
| 8 | FINAL_REVIEW_EXPORT | ✓ | ✓ — `reportApi.ts` |

### Supabase wire-up detail

All 8 stages load real data on `activeAudit` change and write through atomic
RPCs that insert a `state_history_deltas` row in the same transaction.
`advance_audit_stage` RPC has server-side gating. History drawer calls
`audit_mode_get_object_history` across all wired stages.

Stages 7–8 (added 2026-05-01): `report_draft_objects` table (1:1 with audit),
RLS, 4 RPCs (`upsert`, `approve`, `final_sign_off`, `mark_exported`).
`reportApi.ts` handles fetch + all mutations. `mockReport.ts` still defines
the `MockReportDraft` type but `MOCK_REPORTS` data is dead.

**Remote migration deploy pending:**
```
SUPABASE_ACCESS_TOKEN=<token> npx supabase db push --project-ref ygfcjwgsjmathinqkppq
```

---

## Current state — Site Mode

### Foundation — ✓ done

Auth, theme switcher, mode switcher, protocol picker (`ProtocolContext`),
per-protocol gate, tab architecture.

**ProtocolContext** queries `protocols` with a join on `protocol_versions` for
phase. Realtime subscription re-fetches on table changes. `MOCK_PROTOCOLS` is
gone. Maps `study_number` → `code`, `title` → `name`, `clinical_trial_phase`
→ display label. Exposes `isLoading: boolean` — Navbar protocol picker shows
"Loading protocols…" / "No protocols found" while fetching.

### Tabs

| Tab | UI | Supabase |
|-----|----|----------|
| Overview (calendar) | ✓ Week + month views, drawers, filters | ✗ — `mockCalendarData.ts` |
| Participants | ✓ Roster, status filter; row click → `ParticipantProfileDrawer` | ✗ — `mockSiteData.ts` |
| Visits | ✓ Sortable list, status filters, search; Start Visit → checklist → completion state | ✗ — `mockCalendarData.ts` |
| Team | ✓ Delegation log, cert expiry callouts | ✗ — `mockSiteData.ts` |
| Ask | ✓ Protocol-anchored copilot | ◐ — AI real; doc scoping needs Reducto pipeline |
| Reports | ✓ Compliance metrics, deviation/missed logs; CSV export real | ✗ — derived from mock data |
| Protocol | ✓ Metadata panel — code, sponsor, phase; documents-pending callout | ✗ — blocked on D-009 |

### Button state

| Button | Surface | Status |
|--------|---------|--------|
| View in Visits | `VisitDetailDrawer` from TodayTab | ✓ navigates to Visits tab |
| View in Visits | `VisitDetailDrawer` from ReportsTab | ✓ navigates to Visits tab |
| Start visit | `VisitsTab` detail panel | ✓ opens `VisitDetailDrawer` with checklist |
| Start visit | `VisitDetailDrawer` (TodayTab / ReportsTab) | ✓ checklist → completion confirmation state |
| View participant profile | `VisitDetailDrawer` (all surfaces) | ✓ opens `ParticipantProfileDrawer` |
| Participant row | `ParticipantsTab` | ✓ opens `ParticipantProfileDrawer` |
| Export CSV | `ReportsTab` | ✓ real download — visits scoped to active protocol |
| Export Markdown | `FinalReviewExportWorkspace` Stage 8 | ✓ real `.md` download |
| Export Word (.docx) | `FinalReviewExportWorkspace` Stage 8 | ✓ real `.docx` via `docx` package |

---

## Open decisions

| ID | Question | Impact |
|----|----------|--------|
| D-004 | When does SOP parsing land? | `checkpoint_ref` is plain text for now |
| D-005 | Trust posture scoring model | Trust assessment enums |
| D-007 | Evidence attachment versioning | Single-version + metadata for now |
| D-009 | PIQC → Vendor PIQC API contract | Protocol payload format; blocks Protocol tab |

---

## What's NOT built

- **Site Mode Supabase wire-up** — schema is designed (`20260502000000`); API files + UI wire still needed.
- **Protocol tab documents** — metadata panel is live; full document content blocked on D-009 (Reducto pipeline).
- **"Start visit" persistence** — checklist completion and confirmation state are local only; no DB write.
- **Stripe checkout wiring** — `Pricing.tsx` CTA goes to login; `useCheckout` hook exists but checkout not triggered from the landing page yet.
- **Participant profile — full page** — `ParticipantProfileDrawer` is mock-backed; no dedicated route or Supabase-backed profile page.

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

---

## Code map

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
  types/
    audit/                                  TS mirrors of the audit schema

supabase/
  migrations/                               32 migrations — schema, RLS, RPCs, seeds
  functions/
    dashboard-chat/                         RAG chat edge function
    ingest/                                 Document ingestion edge function

scripts/
  smoke-rpcs.sh                             Audit Mode RPC smoke test suite (T1–T12)

rv1_code/                                   Reference Next.js build. Read-only.
```

---

## Next up

In priority order:

**Immediate — deploy all pending migrations:**
1. Push 3 pending migrations to remote Supabase:
   - `20260501000000` + `20260501010000` — Stage 7–8 report draft schema + RPCs
   - `20260502000000` — Site Mode schema (`site_participants`, `site_visits`, `site_team_members`)
   ```
   SUPABASE_ACCESS_TOKEN=<token> npx supabase db push --project-ref ygfcjwgsjmathinqkppq
   ```
2. Run `bash scripts/smoke-rpcs.sh --cloud` — T11 + T12 cover Stage 7–8 RPCs.

**Track C — Site Mode Supabase wire-up (schema deployed; ready to build):**
3. **API files** — `visitsApi.ts`, `participantsApi.ts`, `teamApi.ts` — mirror the audit API pattern.
4. **Wire UI** — swap mock reads in TodayTab, ParticipantsTab, VisitsTab, TeamTab. ReportsTab + ParticipantProfileDrawer derive automatically once sources are live.

**Track D — Stripe checkout:**
5. Wire `Pricing.tsx` "Get started" CTA to `useCheckout` for authenticated users (currently sends to login).
6. Post-login redirect to checkout (or dashboard-level upgrade flow).

**Deferred:**
- Protocol tab documents — blocked on D-009 (Reducto pipeline).
- "Start visit" DB persistence — checklist completion local-only; no write on complete.
- Heatmap real-data refinement — swap heuristics once enough audits exist.

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

---

## Polish system reference

- **Text tones**: `text-fg-heading`, `text-fg-body`, `text-fg-sub`, `text-fg-muted`,
  `text-fg-label`. CSS variables in `src/index.css`; `fg.*` in `tailwind.config.js`;
  auto-switches with `html.dark`. Sweep complete — opacity-modified variants
  (e.g. `text-[#374152]/25`) remain as per-file constants by design.

---

## Questions

Product / scope questions → Kiara.
Build / code questions → file headers and inline comments.
