# PIQClinical — Build Plan & Status

_Last updated: 2026-05-09 (Source of Truth Reviewer PR-1 → PR-7 stacked on `sotr/base`; pending dev-team review and merge)._

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
| **Source of Truth Reviewer — PR-1 backend foundation** | `protocol_extracted_items` + `protocol_source_evidence` + link table; pure Reducto adapter; ingest patched to pass citations through | ✓ Done — **awaiting dev-team review on `sotr/pr-1`** |
| **Source of Truth Reviewer — PR-2 review-screen API** | `sotr_get_worksheet_item_evidence` (single + batch, cap 100); deterministic sort | ✓ Done — **awaiting review on `sotr/pr-2`** |
| **Source of Truth Reviewer — PR-3 MVP UI (Site Mode)** | `WorksheetItemsList` in ProtocolTab; right-edge `SourceTruthDrawer`; confidence badge + missing-evidence + missing-coords states | ✓ Done — **awaiting review on `sotr/pr-3`** |
| **Source of Truth Reviewer — PR-4 PDF storage foundation** | Private `protocol-pdfs` bucket + RLS; `documents.storage_path`; ingest uploads PDF; `sotr_get_protocol_pdf_storage_path`; "View cited page" opens new tab | ✓ Done — **awaiting review on `sotr/pr-4`** (embedded viewer deferred — see SOTR open questions) |
| **Source of Truth Reviewer — PR-5 draft review actions** | `worksheet_review_events` + `draft_review_action`/`draft_review_status` enums; `sotr_create_review_event`; ReviewActionBar + FlagSourceButton; version bumps on edit; source-evidence snapshots | ✓ Done — **awaiting review on `sotr/pr-5`** |
| **Source of Truth Reviewer — PR-6 draft confidence export** | `sotr_get_draft_confidence_packet` RPC + client-side CSV; required disclaimer; one row per (item × source) pair; flag fields | ✓ Done — **awaiting review on `sotr/pr-6`** |
| **Source of Truth Reviewer — PR-7 review + hardening pass** | DRY SQL helper; tightened TS types; `docs/sotr/architecture.md` + `docs/sotr/follow-ups.md` | ✓ Done — **awaiting review on `sotr/pr-7`** |

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

## What's NOT built

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

rv1_code/                                   Reference Next.js build. Read-only.
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
| SOTR — embedded PDF viewer (F-001) + coordinate verification (F-002) | **Opus** — viewer infra + verified coordinate translation |
| SOTR — Audit Mode wiring (F-003) | Sonnet — additive; components are mode-agnostic |
| SOTR — review history UI (F-005) | Sonnet — read-only RPC + collapsed list |

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
SOTR-specific questions → `docs/sotr/architecture.md` (boundaries + invariants), `docs/sotr/follow-ups.md` (deferred work + open questions S-001…S-007), and the per-PR commit messages on `sotr/pr-{1..7}`.
