# PIQClinical — Build Plan & Status

_Last updated: 2026-05-01 (Typography: semantic `text-fg-*` utilities added; rest of build state unchanged from prior polish + Supabase wire-up landings)_

This document describes the current build of PIQClinical (PIQC), what's
finished, and what's queued. It's the source of truth for "where are we" — the
codebase below this directory is the source of truth for "what does it do."

---

## What PIQClinical is

PIQC is an AI-powered protocol intelligence platform for clinical trials. The
product carries structured risk context from a parsed protocol forward into
two distinct workflows, each surfaced as a **mode**:

- **Site Mode** — for clinical site users running active studies. Calendar-first
  overview of participant visits across protocols, scoped per protocol or across
  all protocols at once. Replaces ad-hoc spreadsheets and email reminders.

- **Audit Mode** — for vendor auditors auditing CROs, central labs, ePRO
  vendors, and similar GxP service providers. Structured 8-stage workflow that
  carries protocol risk context into questionnaire design, scope review,
  drafting, and audit conduct. Replaces free-text note-taking with a relational,
  evidence-linked auditor workspace.

Both modes share the same codebase, login, and protocol data once Supabase is
fully wired. Mode selection is a header-level toggle.

---

## Stack

- **Frontend**: Vite + React 18 + TypeScript + Tailwind CSS
- **Auth + DB**: Supabase (Postgres with RLS + auth.users)
- **Components**: lucide-react icons; pure Tailwind styling
- **Tests**: not yet in place (pending)

The Audit Mode content was originally built as a separate Next.js + Prisma app
(reference copy under `rv1_code/`). We re-implement that work inside this Vite
app rather than maintaining two stacks. The reference copy is read-only — all
new code lands in this project.

---

## Upstream context

PIQC ingests parsed protocol data via Reducto (a third-party document parsing
service) once that pipeline is wired. Vendor Audit Mode then reads from PIQC's
structured output. The upstream contract is currently unresolved (decision
**D-009**, see below) — for now both modes read mock data so the UI can land
ahead of the data pipeline.

---

## Build phases

| Phase | Scope | Status |
|-------|-------|--------|
| Site Mode foundation | Auth, navbar, dashboard shell, protocol picker, theming | ✓ Done |
| Site Mode Overview (calendar) | Calendar-first overview tab with filters, drawers, empty states | ✓ Done |
| Audit Mode Phase A — chassis | DB schema, 3-pane shell, stage nav, audit picker, state-delta helpers | ✓ Done |
| Audit Mode Phase B — per-stage workspaces | Real UI for each of the 8 audit stages | ✓ All 8 done |
| Real Supabase wire-up | Replace mock stores with Supabase RPCs and live data | ◐ Substantially done — Phases 1–6 live; 7c–9 remaining |
| Heatmap / intelligence overlay | Soft-gradient risk indicators per the UX spec | ✓ Done (5 surfaces) |
| Ask tab redesign — protocol-grounded copilot | Replace generic chat with protocol-anchored Ask experience | ✓ Done (per-protocol scoping awaits Supabase) |
| Mobile responsiveness pass | StageNav collapse, drawer access, calendar stacking, transitions | ✓ Done |
| History drawer | Per-object change history surfaced in each stage | ○ Stub only (`HistoryDrawerStub` in RiskSummaryPanel); real RPC + per-stage wiring not yet in |
| Polish — semantic text tones | `text-fg-*` Tailwind utilities backed by CSS variables; dark-mode aware | ✓ Utilities live; adoption sweep is opportunistic |
| Polish — drawer accessibility (ESC, scroll lock, focus trap, swipe dismiss) | Shared hooks for drawer behaviour | ○ Not yet in |
| Stage 7–8 Supabase wire-up (Report / Final Review) | Persist report draft + final review state | ○ Not started |
| Stripe onboarding + landing page | Customer-facing marketing + checkout | ○ Not started |

---

## Current state — Audit Mode

### Foundation (Phase A) — ✓ done

- Three Supabase migrations in `supabase/migrations/`:
  1. `20260427120000_audit_mode_phase_1_schema.sql` — 25 tables, 26 enums, indexes, triggers
  2. `20260427120100_audit_mode_phase_1_rls.sql` — lead-auditor scoping, polymorphic visibility
     for state history, reference-data read access
  3. `20260427120200_audit_mode_state_history_helpers.sql` — `write_delta`, `diff_jsonb`,
     `get_object_history` Postgres functions
- TypeScript types mirroring the schema in `src/types/audit/`
- Audit context + Navbar audit picker
- 3-pane workspace shell (left: stage nav, centre: per-stage workspace, right: risk summary)
- Audit-required gate when no audit is selected
- Real `RiskSummaryPanel` with edit / approve / re-approve flows (mock-backed)
- Stage stubs for all 8 stages (each rendered as `StagePlaceholder` until ported)

### Per-stage workspaces (Phase B)

| # | Stage | Status | Notes |
|---|-------|--------|-------|
| 1 | INTAKE | ✓ Done | Manual protocol-section risk tagging form |
| 2 | VENDOR_ENRICHMENT | ✓ Done | Vendor service + service-to-risk mapping + trust assessment |
| 3 | QUESTIONNAIRE_REVIEW | ✓ Done | Lifecycle, addenda generation, per-question response capture |
| 4 | SCOPE_AND_RISK_REVIEW | ✓ Done | Read-only summary of upstream stages + dual approval gates + advance |
| 5 | PRE_AUDIT_DRAFTING | ✓ Done | 3 tabs (confirmation letter, agenda, checklist) sharing the Revise/Save/Approve pattern |
| 6 | AUDIT_CONDUCT | ✓ Done | Structured workspace entries with impact/classification chips, optional protocol-section linking |
| 7 | REPORT_DRAFTING | ✓ Done | Auto-compiled report draft (scope, risk context, findings/observations/OFIs) + auditor-authored exec summary and conclusions; one approval gate |
| 8 | FINAL_REVIEW_EXPORT | ✓ Done | Pre-export gate checklist auto-derived from upstream approvals; final auditor sign-off; Markdown / Word export stubs |

### Shared-store pattern

`src/context/AuditDataContext.tsx` is an in-session cache keyed by audit_id,
with one slice per stage (protocol risks, vendor services, mappings, trust
assessments, risk summaries, questionnaires, pre-audit deliverables, workspace
entries, reports). Cross-stage edits propagate immediately — approving the
questionnaire in Stage 3 clears Stage 4's gate; approving the risk summary in
the right rail does the same.

Each slice is currently seeded from `src/lib/audit/mock*.ts`. Per-stage
workspaces fetch real data from Supabase on `activeAudit` change and overwrite
the relevant slice via per-stage API files (`src/lib/audit/*.Api.ts`) with
optimistic updates. The seeds give the UI something to render before the
fetch lands; for an honest end-to-end smoke test they should be dropped.

### Supabase wire-up status

Done (Phases 1–6):
- Schema + RLS migrations deployed to local **and** remote Supabase
- `seed_audit_mock_data` SECURITY DEFINER seeds 3 audits for testing
- `AuditContext` reads from `supabase.from('audits').select(...)` with auth
  state listener and localStorage-persisted active-audit selection
- 8 API files under `src/lib/audit/`: intake, vendorEnrichment,
  questionnaire, riskSummary, preAudit, workspaceEntries, audit, history
- All 6 wired stage workspaces load real data on `activeAudit` change
- Stages 1 and 2 are full CRUD with optimistic updates; Stages 3–6 load and
  the primary mutation paths (approve, save) are wired
- `advance_audit_stage` RPC wired through `AuditContext.advanceStage` with
  server-side gating
- `state_history_deltas` writes happen automatically on every mutation

Remaining (Phases 7c–9):
- **7c** — Update `auditApi.ts` to map the new RPC return shape
- **7d** — Verify with smoke test
- **8** — End-to-end smoke test across the full lifecycle
- **9** — Delete the seven status `.md` docs at project root + final commit

Stages 7–8 (Report Drafting, Final Review/Export) still on `mockReport.ts`;
queued behind 7c–9.

---

## Current state — Site Mode

### Foundation — ✓ done

- Auth (Supabase) — login, forgot password, session handling
- Theme switcher (light/dark; light default)
- Mode switcher (Site / Audit) in header
- Protocol picker with "All protocols" cross-protocol scope
- Per-protocol gate component for tabs that need a single protocol scope
- Tab architecture: Overview / Participants / Visits / Protocol / Team / Ask /
  Reports

### Overview tab (the calendar) — ✓ done

- Greeting header
- Needs Attention band: collapses to count summary on narrow screens; expands
  to inline + popover on wide screens
- Calendar toolbar: prev / today / next, week/month toggle, filter sidebar
  toggle on mobile
- Filter panel (Google-Calendar style): protocol-level + per-participant
  checkboxes, persisted to localStorage
- Week view: 7-day grid, 3 visits per cell with `+N more` overflow, today tinted
- Month view: standard 42-cell grid, `+N more` per cell, day-detail drawer
- Visit detail drawer with status, scheduled procedures, deviation/missed
  callouts, "Start visit" stub, "View in Visits" link
- Empty-state cards for "nothing this week/month" vs "all hidden by filters"

### Other Site Mode tabs

Participants, Visits, Protocol, Team, Ask, Reports are placeholders. They live
behind the protocol-required gate so users see a "select a protocol" prompt
when in cross-protocol scope. Real content lands as Site Mode features get
prioritised.

---

## Open decisions

These are tracked as `D-XXX` IDs throughout the codebase. They block specific
subsystems from being finalised; the build works around them with stubs.

| ID | Question | Owner | Impact |
|----|----------|-------|--------|
| D-004 | When does SOP parsing land? | Phase 2 / dev team | `checkpoint_ref` is plain text in Phase 1 |
| D-005 | Trust posture scoring model (qualitative vs numeric vs multi-axis) | Product | Trust assessment enums |
| D-007 | Evidence attachment versioning model | Phase 2 | Evidence is single-version + metadata for now |
| D-009 | PIQC → Vendor PIQC API contract (field shapes, auth, IDs) | PIQC dev team | Protocol payload format |

The full decisions log lives in `rv1_code/docs/decisions.md`.

---

## What's NOT built (and intentionally so)

These are called out in the Vendor Audit UX spec but are deferred until later
phases:

- **Three-pane layout for Site Mode workspaces** — Site Mode currently uses a
  flat tab rail. Audit Mode has the three-pane shell.
- **Ask tab — partial.** Site Mode Ask tab wraps DashboardChat with a
  protocol context strip, "grounded in this protocol" framing, and
  protocol-specific suggested prompts. Real per-protocol document scoping +
  in-message citation traceability lands with the Supabase wire-up.
- **Reports tab content (Site Mode)** — currently placeholder.
- **Stages 7–8 Supabase wire-up** — Report Drafting and Final Review/Export
  still read `mockReport.ts`. Queued behind Phases 7c–9.
- **History drawer (real)** — schema captures deltas via
  `state_history_deltas` and there's an `audit_mode_get_object_history` RPC,
  but only a `HistoryDrawerStub` placeholder is wired in `RiskSummaryPanel`.
  Still needs the real drawer component + per-stage button wiring.
- **Drawer accessibility hooks** — ESC, body scroll lock, focus trap, focus
  return on close, swipe-to-dismiss. Today each drawer rolls its own ad-hoc
  handling. Should be centralised in shared hooks (`useOverlay`,
  `useSwipeDismiss`).
- **Adoption sweep of `text-fg-*` utilities** — the semantic text-tone
  utilities exist (`text-fg-heading`, `-sub`, `-muted`, `-label`, `-body`)
  and are dark-mode-aware; existing files still use per-component
  `headingColor = isLight ? ...` constants. New code should prefer the
  utilities; sweep is opportunistic.

---

## How to test the current build

1. `npm install`
2. `npm run dev` (Vite serves at `localhost:5173`)
3. Sign in (Supabase auth)
4. **Site Mode**: pick a protocol or use "All protocols" → Overview tab shows
   the calendar with mock visits. Filter, navigate, click a visit.
5. **Audit Mode**: pick an audit from the header picker. Three audits
   are seeded covering different lifecycle states:
   - **CRO QC oversight — BRIGHTEN-2** (Aurora): Stage 3, mid-flow
   - **Central lab data integrity — CARDIAC-7** (Helix Diagnostics): Stage 1, fresh
   - **ePRO platform GxP audit — IMMUNE-14** (PatientPulse): Stage 5, mostly approved

The migrations under `supabase/migrations/` are deployed to both local and
remote Supabase. The 3 seed audits above come from
`20260429120000_seed_audit_mock_data.sql`. Stage advancement uses the
`advance_audit_stage` RPC with server-side gating.

---

## Code map

```
src/
  components/
    Navbar.tsx                              Header with mode + protocol/audit pickers
    dashboard/
      Dashboard.tsx                         Mode dispatcher
      site/
        TodayTab.tsx                        Calendar overview (renamed from Today)
        ParticipantsTab.tsx, etc.           Placeholders
        ProtocolRequiredGate.tsx
      audit/
        AuditWorkspaceShell.tsx             3-pane layout owner
        StageNav.tsx                        Left rail
        RiskSummaryPanel.tsx                Right rail (with internal HistoryDrawerStub)
        AuditRequiredGate.tsx               Empty state
        StagePlaceholder.tsx                Generic placeholder for unported stages
        stages/                             Per-stage workspaces
          IntakeWorkspace.tsx               ✓ Real
          VendorEnrichmentWorkspace.tsx     ✓ Real
          QuestionnaireReviewWorkspace.tsx  ✓ Real
          ScopeReviewWorkspace.tsx          ✓ Real
          PreAuditDraftingWorkspace.tsx     ✓ Real (3 tabs: confirmation letter / agenda / checklist)
          AuditConductWorkspace.tsx         ✓ Real (entry list + form, impact/classification chips)
          ReportDraftingWorkspace.tsx       ✓ Real (auto-compiled + editable narrative)
          FinalReviewExportWorkspace.tsx    ✓ Real (gate checklist + sign-off + export stubs)
          intake/                           Sub-components for INTAKE
          vendor-enrichment/                Sub-components for VENDOR_ENRICHMENT
  context/
    AuthContext, ThemeContext, ModeContext
    ProtocolContext.tsx                     Site Mode active protocol
    AuditContext.tsx                        Audit Mode active audit
    AuditDataContext.tsx                    Per-stage shared cache, seeded
                                            from mock fixtures; workspaces
                                            fetch real data over the top
    HeatmapContext.tsx                      Heatmap layer toggle (default ON)
  lib/
    supabase.ts                             Supabase client
    audit/
      labels.ts                             Enum → display label maps
      intakeApi.ts                          Stage 1 CRUD (Supabase)
      vendorEnrichmentApi.ts                Stage 2 CRUD (Supabase)
      questionnaireApi.ts                   Stage 3 (Supabase + RPC)
      riskSummaryApi.ts                     Stage 4 approval state (Supabase)
      preAuditApi.ts                        Stage 5 deliverables (Supabase)
      workspaceEntriesApi.ts                Stage 6 entries (Supabase)
      auditApi.ts                           advance_audit_stage RPC wrapper
      historyApi.ts                         audit_mode_get_object_history RPC
      stateHistory.ts                       Legacy client wrapper for state-delta RPCs
      mockProtocolRisks.ts                  INTAKE mock fixtures
      mockVendorEnrichment.ts               VENDOR_ENRICHMENT mock fixtures
      mockQuestionnaire.ts                  QUESTIONNAIRE_REVIEW mock fixtures
      mockPreAudit.ts                       PRE_AUDIT_DRAFTING mock fixtures
      mockWorkspaceEntries.ts               AUDIT_CONDUCT mock fixtures
      mockReport.ts                         REPORT_DRAFTING / FINAL_REVIEW (still seeded)
      mockRiskSummary.ts                    Risk summary panel mock fixtures
    mockCalendarData.ts                     Site Mode Overview mock data
    mockSiteData.ts                         Participants + Team mock data
    heatmap.ts                              Heat scoring + tone tokens
  types/
    audit/                                  TS mirrors of the audit-mode schema

supabase/
  migrations/                               Schema, RLS, state-delta helpers

rv1_code/                                   Reference copy of the original Next.js
                                            Audit Mode build. Read-only.
```

---

## Claude model guidance

Use **Opus** for tasks that require architectural judgment, cross-file reasoning, or designing something new. Use **Sonnet** for well-scoped, single-file or mechanical changes where the pattern is already established.

| Task | Model | Reason |
|------|-------|--------|
| Supabase wire-up — AuditDataContext replacement | **Opus** | Touches every stage; needs to reason across the full mock → RPC substitution pattern and keep cross-stage reactivity intact |
| Supabase wire-up — individual RPC calls once pattern is set | Sonnet | Mechanical repetition of an established pattern |
| Heatmap extension to StageNav + RiskSummaryPanel | **Opus** | Requires understanding scoring model, existing token system, and two distinct layout surfaces |
| Adding a HeatIndicator to a new surface once the pattern is clear | Sonnet | Straightforward component application |
| History drawer — wiring `get_object_history` RPC | **Opus** | New data layer; needs to reason about polymorphic history shape and UI state |
| Ask tab + AI assistant pane redesign | **Opus** | New feature design; cross-cutting UX and data concerns |
| Bug fixes in a single workspace stage | Sonnet | Isolated, well-understood surface |
| Copy / label / enum changes | Sonnet | Mechanical |
| Polish / accessibility / focus state pass | Sonnet | Well-scoped, no architectural decisions |
| New mock data additions | Sonnet | Pattern already established in existing mock files |
| Schema migrations (new columns, indexes) | **Opus** | Needs to reason about RLS, triggers, and downstream type impacts |
| Stripe integration | **Opus** | New subsystem; auth + webhook + DB concerns |
| Landing page / marketing UI | Sonnet | Self-contained; no product logic |

---

## Next up

In priority order:

1. **Finish Supabase wire-up** — Phases 7c–9:
   - 7c: Update `auditApi.ts` to map the new RPC return shape
   - 7d: Verify with smoke test
   - 8: End-to-end smoke test across the full lifecycle
   - 9: Delete the seven status `.md` docs at project root + final commit
2. **Stage 7–8 Supabase wire-up** (Report Drafting, Final Review/Export) — write `reportApi.ts`, replace `mockReport.ts` reads, drop the last MOCK seed in `AuditDataContext`. Queued behind Phases 7c–9.
3. **History drawer** — pattern needs to be (re)built: a shared `HistoryDrawer` component that calls `audit_mode_get_object_history` and is embedded in each stage with the right `tracked_object_type`. Today only `RiskSummaryPanel` has a placeholder stub.
4. **Reports tab content (Site Mode)** — currently a placeholder.
5. **Polish — drawer behaviour** — shared hooks for ESC, body scroll lock, focus trap + return, and swipe-to-dismiss. Currently each drawer has bespoke handling (or none).
6. **Polish — typography adoption sweep** — replace per-file `headingColor = isLight ? '#1a1f28' : 'white'` constants (50+ files) with the new `text-fg-*` utilities. Opportunistic; new code should already prefer the utilities.
7. **Pre-existing typing bug** in `QuestionnaireReviewWorkspace.tsx` where the constructed `bundle` doesn't actually match `MockQuestionnaireBundle` (missing the `instance` wrapper). TS isn't catching it because of the explicit annotation.
8. **Heatmap real-data refinement** — once enough audits exist, swap the Phase B heuristics in `heatmap.ts` for aggregated cross-audit signals.

Stripe onboarding and landing page are external/marketing work, queued separately.

## Polish system reference

- **Text tones**: prefer `text-fg-heading`, `text-fg-body`, `text-fg-sub`,
  `text-fg-muted`, `text-fg-label` over per-file `isLight ? '#1a1f28' : 'white'`
  ternaries. Backed by CSS variables in `src/index.css` and a `fg.*` color
  block in `tailwind.config.js`; switches automatically with `html.dark`.
  No sweep yet — existing files keep working.

---

## Questions

For product / scope questions, ping Kiara.
For build / code questions, see file headers and the inline comments — every
non-trivial file has a top comment describing what it does and why.
