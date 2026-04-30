# PIQClinical — Build Plan & Status

_Last updated: 2026-04-30 (Mobile responsiveness pass complete; heatmap on 3 surfaces)_

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
| Real Supabase wire-up | Replace mock stores with Supabase RPCs and live data | ○ Not started |
| Heatmap / intelligence overlay | Soft-gradient risk indicators per the UX spec | ○ Not started |
| Phase 2 audit stages (Report, Final Export) | Last two stages from the Vendor PIQC scope | ○ Stubbed only |
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

### Mock-backed pattern

Every Phase B stage reads and writes through a single shared store
(`src/context/AuditDataContext.tsx`), seeded from the `src/lib/audit/mock*.ts`
files. All eight per-audit stores (protocol risks, vendor services, mappings,
trust assessments, risk summaries, questionnaires, pre-audit deliverables,
workspace entries) live in one provider so cross-stage edits propagate
immediately — approving the questionnaire in Stage 3 clears Stage 4's gate;
approving the risk summary in the right rail does the same.

Edits persist within a session but reset on page refresh. When the Supabase
wire-up phase begins, the context is the single replacement target — initial
state comes from `supabase.from(...).select()` and setters become
`supabase.rpc(...)` calls. UI components don't change.

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

- **Heatmap / intelligence overlay** — soft yellow→orange→red risk indicators.
  Spec calls for toggleable, default-on. Surface for it isn't reserved yet.
- **Three-pane layout for Site Mode workspaces** — Site Mode currently uses a
  flat tab rail. Audit Mode has the three-pane shell.
- **AI assistant right-pane with traceability** — the Ask tab in Site Mode and
  the History drawer in Audit Mode are placeholders.
- **Reports tab content** — currently placeholder.
- **Audit Mode stages 7 and 8** — Phase 2 stubs.
- **Real Supabase wire-up across all stages** — every Phase B stage works
  against an in-session mock store.

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

The migrations under `supabase/migrations/` haven't been applied to the live
Supabase project yet — when they're applied, please flag any errors and we'll
patch.

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
        RiskSummaryPanel.tsx                Right rail
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
    HeatmapContext.tsx                      Heatmap layer toggle (default ON)
  lib/
    supabase.ts                             Supabase client
    audit/
      labels.ts                             Enum → display label maps
      stateHistory.ts                       Client wrapper for state-delta RPCs
      mockProtocolRisks.ts                  INTAKE mock data
      mockVendorEnrichment.ts               VENDOR_ENRICHMENT mock data
      mockQuestionnaire.ts                  QUESTIONNAIRE_REVIEW mock data
      mockPreAudit.ts                       PRE_AUDIT_DRAFTING mock data (3 deliverables)
      mockWorkspaceEntries.ts               AUDIT_CONDUCT mock data
      mockReport.ts                         REPORT_DRAFTING / FINAL_REVIEW mock data
      mockRiskSummary.ts                    Risk summary panel mock data
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

## Next up

In priority order:

1. **Real Supabase wire-up** for all Phase B stages — replace mock context's seed data with `supabase.from(...)` queries and setters with `supabase.rpc(...)` calls. The `AuditDataContext` is the single replacement target. Blocked: migrations need to apply first.
2. **Heatmap layer — partial.** Done: chassis (HeatmapContext, scoring utilities, HeatIndicator component with bar + chip variants), Navbar toggle (default ON, persisted), applied to calendar visit cells (right-edge bar), Audit Conduct workspace entries (chip), and ParticipantsTab rows (chip). Remaining: extend to more surfaces (StageNav stage-level signals, RiskSummaryPanel focus areas), real network-level scoring once data is live.
3. **History drawer** wired to `audit_mode_get_object_history` so change history shows real entries (depends on Supabase wire-up)
4. **Ask tab + AI assistant pane** redesigned to match the UX spec
5. **Mobile responsiveness — done.** StageNav mobile collapse, RiskSummaryPanel drawer access below xl, audit context header tightening on phones, calendar week-view vertical stacking on phones (sm: breakpoint), drawer slide-in transitions across all six drawer instances (visit detail, day detail, visit drawer, participant drawer, risk summary drawer + history). Smaller polish items (gesture-to-dismiss, focus management) deferred.
6. **Polish/cleanup pass** — typography consistency, focus states, accessibility, transitions

Stripe onboarding and landing page are external/marketing work, queued separately.

---

## Questions

For product / scope questions, ping Kiara.
For build / code questions, see file headers and the inline comments — every
non-trivial file has a top comment describing what it does and why.
