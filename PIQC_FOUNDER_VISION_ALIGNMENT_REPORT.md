# PIQC Founder Vision Alignment Report

_Generated: 2026-05-12. Read-only architectural assessment — no code was modified._
_Scope: Native PIQC repository HEAD (`fa6c7b1 sotr/pr-7`) + active worktrees._

---

## 1. Executive Summary

**Overall alignment: Partially Aligned — with one critical divergence risk.**

The codebase is structurally sound, has an appropriate product boundary, and has implemented meaningful portions of both modes. The core infrastructure (protocol upload, parsing, RAG chat, Audit Mode 8-stage workflow) is well-built and directionally correct.

However, a critical architectural divergence has occurred between two parallel development tracks:

1. The **native repo** (`sotr/pr-7` branch) built a Source of Truth Reviewer (SOTR) — a field-level extract-review-export engine that is the most direct implementation of the founder's "core engine" vision. It is complete across 7 PRs but **not yet merged to main**.

2. The **main/k1 branch + worktrees** built Phase B cross-references, a calendar wire-up, and a Worksheet Compiler (Sprint 1B). These are correct but represent a different, lower-level approach to the same capability.

These two tracks have **conflicting migration timestamps at `20260508000000_*`** and different `plan.md` versions. If both are merged to main independently, the result is a database schema conflict and a duplicated source-of-truth concept (SOTR's `protocol_extracted_items` vs. the Worksheet Compiler's `WorksheetBundle`).

**Before the next sprint begins, the team must resolve which track is canonical or explicitly define how they compose.** Everything else in this report is secondary to that decision.

---

### Summary Table

| Area | Label | Notes |
|------|-------|-------|
| Protocol upload + Reducto parsing | **Aligned** | Full pipeline in `ingest` edge function |
| Audit Mode 8-stage workflow | **Aligned** | All 8 stages wired, all deliverables present |
| Product boundary (not a system of record) | **Aligned** | Explicit naming policy, SOTR architecture doc, DRAFT disclaimers |
| RAG chat interface | **Aligned** | Protocol-scoped, citation-backed, secure |
| Core engine → structured worksheet data | **Partially Aligned** | SOTR is built but unmerged; Worksheet Compiler built but undeployed |
| Chat interface for reviewing/correcting worksheets | **Partially Aligned** | RAG chat exists; not yet connected to worksheet item review flow |
| Endpoint criticality in Site Mode | **Partially Aligned** | Exists in Audit Mode's `protocol_risk_objects`; not surfaced in Site Mode |
| Site Mode Supabase wire-up | **Partially Aligned** | Done in main/k1; native plan.md still shows it as "not started" |
| Subject Command View | **Not Yet Aligned** | Feature branch only, no UI built |
| Study Day Views | **Not Yet Aligned** | Not built anywhere |
| Site-level readiness support | **Not Yet Aligned** | Calendar + compliance report exist; no readiness scoring or alerting |
| Agentic/async workflow for worksheet generation | **Not Yet Aligned** | Pieces exist; not connected as a workflow |
| SOTR ↔ Worksheet Compiler unification | **At Risk** | Two parallel data models for the same concept; migration timestamp conflict |
| plan.md source of truth | **At Risk** | Two diverged versions (SOTR track vs. main/k1 track) |
| Migration deployment to remote Supabase | **At Risk** | Multiple migrations pending; not deployed |

---

## 2. What Is Aligned

### 2.1 Protocol Ingestion Pipeline

The Reducto integration in `supabase/functions/ingest/index.ts` (1,135+ lines) implements the full ingest lifecycle: PDF upload → Reducto Parse → Reducto Extract → chunk embedding → `documents.extracted_fields` persistence → `protocol_visit_templates` upsert → Phase B cross-reference fan-out. The pipeline is production-quality with retry logic, rate limiting, and structured error handling.

The most recent Sprint 1B changes (in the current worktree) also add:
- `trimKeys()`: defensive fix for Reducto Studio's trailing-space key artifact
- Schema correction: `schedule_variant` at visit level, `procedures` removed from extract
- `array_extract: true` for long documents

**This is exactly what the founder vision requires as the first step of the core engine.**

### 2.2 Audit Mode — All Eight Deliverables

The Audit Mode 8-stage workflow directly addresses every audit deliverable listed in the founder vision:

| Founder vision item | Implementation |
|---------------------|----------------|
| Protocol-aware audit intake | Stage 1 (`IntakeWorkspace`) — protocol risk objects, endpoint tier, impact surface |
| Questionnaires | Stage 3 (`QuestionnaireReviewWorkspace`) — multi-page, approval-gated |
| Confirmation letters | Stage 5 (`PreAuditDraftingWorkspace`) — `confirmation_letter_objects` with upsert + approve |
| Agendas | Stage 5 — `agenda_objects` with upsert + approve |
| Checklists | Stage 5 — `checklist_objects` with upsert + approve |
| Vendor audit reports | Stages 7–8 (`ReportDraftingWorkspace`, `FinalReviewExportWorkspace`) — Markdown + .docx export |

All 8 stages are wired to Supabase RPCs (39 RPCs across 7 migrations). Stage advancement is server-gated. History drawer provides per-object change history.

### 2.3 Product Boundary — Explicitly Enforced

The codebase observes the correct product boundary in multiple layers:

- **SOTR architecture doc** (`docs/sotr/architecture.md`): explicit naming policy banning "approve/approved/sign/certify/GxP/Part 11" from code, comments, and UI copy. Grep test documented.
- **SOTR export disclaimer**: `"This export was generated by PIQC as a source-backed draft review aid. Final approval, authentication, signature, and controlled release occur outside PIQC."`
- **SOTR follow-ups doc**: explicitly lists "electronic signature, final approval, Part 11/GxP audit-trail features" as out of scope.
- **No PHI/PII** in visit templates, worksheet items, or SOTR components.
- **No clinical decision support** logic anywhere.

The product is correctly positioned as a drafting, planning, and cognitive-load tool.

### 2.4 Protocol-Aware RAG Chat

`dashboard-chat` edge function (931 lines) provides:
- Hybrid search over `chunks` table (pgvector + FTS)
- GPT-based reranking
- Protocol-scoped context window
- Source citation surfacing
- Prompt injection filtering (7 patterns)
- Auth-required, rate-limited

This is the "chat interface" in the founder vision — it operates on parsed protocol content. **However: it is not yet connected to worksheet item review (see §4).**

---

## 3. What Is Partially Aligned

### 3.1 Core Engine → Structured Worksheet Data

The founder vision requires: "parse it into accurate, powerful structured data" → "generate near draft-ready study worksheets."

Two implementations exist, neither yet in production:

**Track A — SOTR (Source of Truth Reviewer)** (`sotr/pr-7` branch):
- `protocol_extracted_items`: every extracted field as a row with `field_type`, `current_text`, `extracted_value`, `review_status`
- `protocol_source_evidence`: per-citation evidence with bounding box + source text
- `protocol_item_evidence_links`: many-to-many links between items and evidence
- `worksheet_review_events`: action log (accept/edit/reject/flag) per item
- 10 mode-agnostic UI components in `src/components/sotr/`
- CSV export of full draft confidence packet
- Wired into `ProtocolTab` in Site Mode
- **90+ tests, 28 smoke test cases (T13–T40)**
- **Status: Complete, not merged to main**

**Track B — Worksheet Compiler** (current worktree `claude/goofy-buck-a2f6b6`):
- `WorksheetBundle` TypeScript type with `MaybeCited<T>`, `QaLedger`, `DiscrepancyEvent`
- `worksheetCompiler.ts`: deterministic compiler reading `extracted_fields` + `protocol_visit_templates`
- `documents.worksheet_bundle JSONB` column (migration pending deploy)
- Visit deduplication with Source A/B cross-check
- **Status: Built, not deployed, not merged to main**

These are complementary in concept but represent different data models for the same entity ("a compiled worksheet"). They are not yet aware of each other.

### 3.2 Chat Interface → Worksheet Review

The RAG chat (`DashboardChat.tsx` / `dashboard-chat` edge function) operates on raw `document_chunks`. It answers questions about protocol content but does not:
- Surface specific extracted items (`protocol_extracted_items`)
- Allow the user to accept/edit/reject a parsed field through the chat
- Generate or update a worksheet bundle in response to chat corrections

The SOTR's `WorksheetItemsList` + `SourceTruthDrawer` is the UI for reviewing extracted items, but it is a separate drawer-based review flow, not a conversational interface.

**What the founder vision describes** — "the chat interface should support the user in reviewing, improving, correcting, and preparing those study worksheets for export" — would require connecting the chat to the SOTR review layer. This connection does not yet exist.

### 3.3 Endpoint Criticality Context (Site Mode Gap)

`protocol_risk_objects` stores endpoint tier (PRIMARY/SECONDARY/SAFETY/SUPPORTIVE), impact surface, time sensitivity, and vendor dependency flags. This data is:
- Written in Audit Mode Stage 1 (INTAKE)
- Accessible via `intakeApi.fetchProtocolRisksForAudit()`
- NOT surfaced anywhere in Site Mode

The founder vision specifies "endpoint criticality context" as a Site Mode deliverable. The data model exists (Audit Mode populates it) but the Site Mode consumption layer is missing.

The Worksheet Compiler's `ProcedureEntry.criticality_ref` and `ObjectiveEntry.tier` fields are the planned bridge — but they are deferred to Sprint 1C.

### 3.4 Visit Schedule → Calendar (Wire-Up Gap in Native)

`protocol_visit_templates` + `materialize_protocol_visits` RPC exist and are wired in `main/k1`. The `AnchorDateModal` allows day-zero date setting, which projects templates × participants → `site_visits`. The TodayTab calendar displays these visits.

**However**: in the native repo's plan.md (`sotr/pr-7` branch), "Site Mode Supabase wire-up" is still listed as "○ Not started." This indicates the plan.md on the SOTR branch is out of sync with what was built in main/k1 after the branch point.

---

## 4. What Is Not Yet Aligned

### 4.1 Subject Command View

The founder vision requires: "subject command views" as a Site Mode deliverable.

Current state:
- `SUBJECT_COMMAND_CANVAS.md` exists on the `feature/scv-foundation-guardrails` branch (worktree `mystifying-ishizaka-10235a`)
- Sprint 0.5 added feature flag infrastructure (`FLAGS.SUBJECT_COMMAND_VIEW`) on that branch
- No UI components exist for subject command view anywhere
- No database tables or RPCs for subject-level visit readiness
- `FLAGS.SUBJECT_COMMAND_VIEW` is not in the native repo or main

This is a major product surface entirely absent from the current codebase.

### 4.2 Study Day Views

No "study day view" exists in any branch. The calendar shows visit dates mapped to calendar days, but there is no study-day-centric view (e.g., "What should happen on Day 14 of this study across all participants?").

The `site_visits.study_day` column exists. The visit template has `study_day`. The UI concept is not built.

### 4.3 Site-Level Readiness Support

The founder vision requires "site-level readiness support" as a Site Mode deliverable. Current state:
- `ReportsTab` shows compliance rate (% completed), deviation log, upcoming visits
- No visit readiness scoring (upcoming window alerts, documentation prep status)
- No protocol deviation risk flagging based on visit history
- Heatmap scoring is heuristic and applies to visits/participants/stages (Audit Mode), not site readiness

### 4.4 Agentic/Async Worksheet Generation Workflow

The founder vision describes "near draft-ready study worksheets through an almost asynchronous/agentic workflow." Current state:
- Reducto parsing is synchronous (ingest edge function)
- No async job queue for long-running protocol analysis
- No webhook/notification when a worksheet is ready for review
- No "generate worksheet" trigger in the UI
- SOTR items are populated during ingest, but no explicit "compile worksheet" user action exists

The workflow is currently: upload PDF → ingest runs → items stored → user opens ProtocolTab → sees items. There is no explicit async pipeline or user-visible workflow state machine for worksheet generation.

### 4.5 SOTR Feeding Audit Mode Intake

Audit Mode Stage 1 (INTAKE) asks the user to manually tag endpoint tiers, impact surfaces, and operational domain tags via `protocol_risk_objects`. The SOTR system extracts exactly these items (`endpoints`, `criteria`, `visits`) with citations.

There is no connection between SOTR's extracted items and Audit Mode's protocol risk tagging. A coordinator reviewing the SOTR worksheet has the same endpoint information that an auditor manually enters in Stage 1 — but they are stored in separate tables and neither populates the other.

---

## 5. What Is At Risk

### 5.1 Critical: Two Parallel Worksheet Data Models With Migration Conflict

**Risk level: High**

| | SOTR Track | Worksheet Compiler Track |
|--|---|---|
| Branch | `sotr/pr-7` (native HEAD) | `claude/goofy-buck-a2f6b6` (worktree) |
| Data model | `protocol_extracted_items` + `worksheet_review_events` | `documents.worksheet_bundle JSONB` |
| Migration timestamp | `20260508000000_sotr_schema.sql` | `20260508000000_visit_template_cross_references.sql` |
| Items | Field-level (endpoint, criterion, visit, dosing, metadata) | Visit-level bundle (schedule, windows, procedures) |
| Review actions | Accept / Edit / Reject / Flag per item | `DiscrepancyEvent` in `qa_ledger` |
| Export | CSV draft confidence packet | No export yet |
| Tests | 90+ unit tests + T13–T40 smoke tests | 20 Vitest cases |

The migration timestamp collision is concrete: both tracks define `20260508000000_*.sql`. When merged, Supabase will reject one or require manual renaming.

The data model duplication is architectural: "worksheet" means something different in each track. If both merge to main, there will be two competing sources of truth for protocol-extracted structured data.

**Required action before next sprint:** The team must decide whether SOTR and the Worksheet Compiler are (a) the same concept at different granularities (field-level vs. visit-level) that should compose, (b) redundant approaches where one should be deprecated, or (c) independent systems with explicit non-overlapping scopes. This decision determines the architecture of everything built afterward.

### 5.2 Critical: plan.md Fork

Two diverged `plan.md` files are being maintained:

| File | Branch | Last updated | Content |
|------|--------|--------------|---------|
| Native repo (`/PIQC-dev-v1/plan.md`) | `sotr/pr-7` | 2026-05-09 | SOTR build status, open questions |
| Worktree (`goofy-buck-a2f6b6/plan.md`) | `claude/goofy-buck-a2f6b6` | 2026-05-12 | Sprint 1A-1B decisions, Worksheet Compiler |
| Worktree (`mystifying-ishizaka-10235a/plan.md`) | `feature/scv-foundation-guardrails` | 2026-05-12 | Sprint 0.5 + Sprint 1A discovery (1,412 lines) |

There is no single canonical `plan.md` that reflects the full current state. Each branch's `plan.md` contains accurate information about its own work but is unaware of the others.

### 5.3 Migrations Not Deployed to Remote Supabase

Multiple migration sets are pending deployment to the remote Supabase project (`ygfcjwgsjmathinqkppq`). Building the next sprint on top of undeployed schema is high-risk: the production DB does not match the local schema, making it impossible to test end-to-end before the next sprint ships.

Pending deployments (from both tracks):
- Audit Mode Stages 7–8 (`20260501*`)
- Site Mode schema (`20260502000000`)
- Phase B cross-references (`20260508000000_visit_template_cross_references`)
- `documents.reducto_job_id` column (`20260508010000`)
- SOTR full schema (8 migrations, `20260508*` through `20260509*`)
- `documents.worksheet_bundle` column (`20260512000000`) — Sprint 1B

### 5.4 SOTR → Main Merge Risk

The SOTR PR stack (7 PRs, unmerged) has been in review state since 2026-05-09. Meanwhile, `main` has moved forward with Phase B and calendar fixes. The merge distance grows with each additional commit to main.

Specific risks when merging SOTR to main:
- `ingest/index.ts` will have conflicts (SOTR patched it for citations + PDF upload; Phase B also modified it for cross-references)
- Migration timestamp conflicts at `20260508000000_*`
- `ProtocolTab.tsx` will have conflicts (SOTR added `WorksheetItemsList` import; Phase B may have also modified it)
- `plan.md` will conflict (both branches modified it substantially)

### 5.5 Site Mode Wire-Up State Inconsistency

The native plan.md (`sotr/pr-7`) still lists "Site Mode Supabase wire-up" as "○ Not started." In reality, `main/k1` completed this work:
- `siteApi.ts` (338 lines) is fully built
- `SiteDataContext` is wired with realtime subscriptions
- All 5 tabs consume real Supabase data
- Participants, visits, team, documents are all live

This creates a false picture of what is production-ready for anyone reading the native plan.md.

### 5.6 Audit Mode and Core Engine Are Not Yet Connected

The founder vision says Audit Mode should "use the core engine." Currently:
- Audit intake (Stage 1) requires manual endpoint tier tagging by the auditor
- The core engine (SOTR/Worksheet Compiler) has already extracted those endpoints with citations
- The two systems have no data bridge

A protocol-aware Audit Mode that actually reads from the parsed protocol (instead of requiring manual input) is the architecture the founder vision describes. This bridge does not exist.

---

## 6. Recommendations — Before the Next Sprint

Listed in priority order. Do not begin the next product sprint until the first two are resolved.

### R-1 (Blocking): Resolve the SOTR vs. Worksheet Compiler Convergence

**Decision required.** The two tracks must converge before either is built further.

**Proposed answer** (for team review): SOTR and the Worksheet Compiler serve different granularities of the same concept and should compose:

- **SOTR** = field-level evidence layer. Stores individual extracted items with source citations, review actions, and export history. This is the "review, improve, correct" part of the founder vision.
- **Worksheet Compiler** = visit-level compilation layer. Aggregates `protocol_visit_templates` + `extracted_fields` into a compiled `WorksheetBundle` with dedup and QA ledger. This is the "generate near draft-ready worksheets" part.

If this framing is accepted:
1. Rename SOTR items to avoid overloading "worksheet"
2. Add a link from `WorksheetBundle.visits[].procedures` to SOTR `protocol_extracted_items` where field_type = 'visit' (the linking key)
3. The Worksheet Compiler reads SOTR-reviewed items as its canonical source instead of raw `extracted_fields`
4. The export from the Worksheet Compiler feeds from SOTR's reviewed state

### R-2 (Blocking): Merge or Rebase SOTR to Main Before Next Sprint

The SOTR PR stack is complete (7 PRs, 90+ tests). It should be reviewed and merged to main before any new feature work begins. The longer it sits unmerged, the more expensive the eventual merge becomes.

Steps:
1. Rename conflicting migration: `20260508000000_sotr_schema.sql` → `20260509100000_sotr_schema.sql` (or another non-conflicting timestamp)
2. Resolve `ingest/index.ts` conflicts (SOTR + Phase B both modified it)
3. Merge SOTR to main
4. Deploy full migration set to remote Supabase
5. Verify smoke tests T1–T40 pass on cloud

### R-3: Unify plan.md

Merge the three plan.md versions into one canonical file in main. The unified plan.md should include:
- Full build history (all completed phases)
- SOTR status + open questions (from native plan.md)
- Sprint 1A discovery report (from mystifying-ishizaka worktree)
- Sprint 1B Worksheet Compiler status (from goofy-buck worktree)
- Locked decisions table (Q2–Q5 from this session)

### R-4: Deploy All Pending Migrations

Before any feature work:
```bash
SUPABASE_ACCESS_TOKEN=<token> npx supabase db push --project-ref ygfcjwgsjmathinqkppq
SUPABASE_ACCESS_TOKEN=<token> npx supabase functions deploy ingest --project-ref ygfcjwgsjmathinqkppq
```

Verify smoke tests T1–T12 pass after deploy.

### R-5: Wire SOTR → Audit Mode Stage 1

Once SOTR is on main, Stage 1 intake should offer "auto-populate from parsed protocol" — read `protocol_extracted_items` where `field_type = 'endpoint'` and suggest them as `protocol_risk_objects` candidates for the auditor to accept/edit/reject. This is the key "Audit Mode uses the core engine" connection described in the founder vision.

### R-6: Define the Worksheet → Chat → Export Workflow

The founder describes "an almost asynchronous/agentic workflow" with a chat interface for review. Before building the next product surface, define:
1. What triggers worksheet compilation? (User action? Post-ingest hook? Both?)
2. What does the chat operate on? (Currently: raw chunks. Target: SOTR items + WorksheetBundle fields.)
3. What is the export artifact? (SOTR's CSV? A formatted .docx? A structured JSON? Per-visit checklist?)
4. What is the user's mental model of the workflow? (Upload → wait → review → export is the likely correct framing)

---

## 7. Files Noted as Not Found

The following files specified in the audit request do not exist in the codebase:

| File | Status |
|------|--------|
| `REPO_CONTEXT_REPORT.md` | Not found in native repo or any worktree |
| `SUBJECT_COMMAND_CANVAS.md` | Not found in native repo. Exists only on the `feature/scv-foundation-guardrails` branch (worktree `mystifying-ishizaka-10235a`) |
| `CODE_REVIEW_REPORT.md` | Not found in native repo. Exists only on `feature/scv-foundation-guardrails` worktree |
| `SPEC-1-PIQC Subject Command View` | Not found anywhere |

The `SUBJECT_COMMAND_CANVAS.md` and `CODE_REVIEW_REPORT.md` are planning artifacts on an unmerged branch. Their content is relevant to future sprints but has not influenced the current production codebase.

---

## 8. Architecture Map — Current Actual State

```
                           FOUNDER VISION
                               │
             ┌─────────────────┼─────────────────┐
             │                 │                 │
     CORE ENGINE         SITE MODE           AUDIT MODE
     (parse → data              │                 │
      → worksheets)            │                 │
             │                 │                 │
    ┌────────┴────────┐  ┌─────┴──────┐   ┌─────┴──────┐
    │                 │  │            │   │            │
  SOTR          Worksheet  Calendar   │   8-Stage     │
  (field-level)  Compiler  + Reports  │   Workflow    │
  ✓ Built        ✓ Built   ✓ Built   │   ✓ Built     │
  ✗ Unmerged     ✗ Undeployed         │               │
                                      │               │
                          ┌───────────┤   ┌───────────┤
                          │           │   │           │
                     Subject CV  Readiness  SOTR    Endpoint
                     ✗ Not built ✗ Not    Wiring    Criticality
                                 built   ✗ Deferred ✗ Not built
                                          (F-003)    in Site Mode

    ┌─────────────────────────────────────────────────────┐
    │              SHARED INFRASTRUCTURE                  │
    │  ingest pipeline ✓ │ RAG chat ✓ │ Auth + RLS ✓     │
    │  protocol_visit_templates ✓ │ extracted_fields ✓   │
    │  Reducto parsing ✓ │ Feature flags ✗ Not in main    │
    └─────────────────────────────────────────────────────┘
```

---

_This report was generated by read-only inspection of the repository. No code was modified. No migrations were created. No secrets were read or recorded._
