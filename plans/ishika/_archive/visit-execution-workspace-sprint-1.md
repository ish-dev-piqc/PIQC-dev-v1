---
owner: ish-dev-piqc
feature: visit-execution-workspace-sprint-1
status: merged
merged: 2026-05-26
started: 2026-05-26
target_pr: #119
---

# Visit Execution Workspace — Sprint 1 Shell

## Context

Clinical trial sites receive a protocol weeks before the first participant is screened. Today PIQC has no surface that helps a site coordinator understand what each visit requires during that upstream window — the only views are the raw SoA table, parsed document metadata, and the participant calendar (which is meaningless with no enrollments). This feature adds a **Visit Execution Workspace** as the primary Site Mode surface: a visit-by-visit execution workspace keyed to `protocol_visit_templates.id` (no participant FK) that collapses protocol complexity into a reviewable checklist. Sprint 1 proves the UX concept with mocked protocol data behind a localStorage toggle; it does not wire the real parser or persist any review state.

## Scope (files allowed)

**New — visit-execution namespace (Ishika owns):**
- `src/types/visit-execution/index.ts`
- `src/lib/visit-execution/visitExecutionApi.ts`
- `src/lib/visit-execution/visitExecutionAdapter.ts`
- `src/lib/visit-execution/mockVisitWorkspace.ts`
- `src/lib/visit-execution/__tests__/visitExecutionAdapter.test.ts`
- `src/lib/visit-execution/__tests__/visitExecutionApi.test.ts`
- `src/components/dashboard/visit-execution/VisitExecutionTab.tsx`
- `src/components/dashboard/visit-execution/VisitNavigator.tsx`
- `src/components/dashboard/visit-execution/VisitSnapshotCard.tsx`
- `src/components/dashboard/visit-execution/ExecutionChecklist.tsx`
- `src/components/dashboard/visit-execution/ExecutionReviewStatusBadge.tsx`
- `src/components/dashboard/visit-execution/ExecutionItemClassificationBadge.tsx`
- `src/components/dashboard/visit-execution/TimingBanner.tsx`
- `src/components/dashboard/visit-execution/TraceabilityDrawer.tsx`
- `src/components/dashboard/visit-execution/ExportPlaceholderButton.tsx`

**Modified — cross-ownership (Approved-by required):**
- `src/components/dashboard/Dashboard.tsx`
- `docs/CODEOWNERS.md`

## Out of scope (files forbidden)

- `src/lib/site/siteApi.ts` — `fetchVisitTemplates` already exists at line 349; no modification needed
- `src/lib/site/types.ts` — type-only import by adapter; file not modified
- `src/context/` — no new context in Sprint 1; state colocated in `VisitExecutionTab`
- `supabase/` — no migrations, no RPCs in Sprint 1
- `src/components/sotr/` — mode isolation; no imports from SOTR namespace
- `src/lib/demo/` — read-only; `mockVisitWorkspace.ts` imports `getDemoVisitTemplates()` from `src/lib/demo/fixtures/visitTemplates.ts` but does not modify any demo fixture files
- `src/lib/audit/`, `src/lib/sotr/` — mode isolation; never import from other modes
- `src/components/dashboard/site/TodayTab.tsx` — demoted to secondary tab in Dashboard.tsx but not modified
- `src/components/dashboard/audit/` — unrelated

## Architecture layers touched

- [ ] migration (`supabase/migrations/`)
- [ ] RPC (`supabase/functions/` or `.sql`)
- [x] adapter (`src/lib/visit-execution/visitExecutionAdapter.ts`)
- [ ] context (`src/context/`)
- [x] component (`src/components/dashboard/visit-execution/`)
- [x] test (`src/lib/visit-execution/__tests__/`)

## Mock data plan

Toggle key: `piq-visit-execution-mock-v1` (localStorage, defaults **off**).

When the toggle is on, `visitExecutionApi.fetchVisitExecutionWorkspaces()` returns typed fixture data from `mockVisitWorkspace.ts` instead of calling `fetchVisitTemplates`. `mockVisitWorkspace.ts` imports `getDemoVisitTemplates()` from `src/lib/demo/fixtures/visitTemplates.ts` (existing BRIGHTEN-2 templates) and enriches them with Sprint 1 execution-specific data — `ExecutionPhase` bucket assignments, `ItemClassification`, `ConditionalRule[]`, `AssessmentTimingConstraint`, and `SourceFieldScaffold[]` — that the current schema cannot yet produce. This avoids duplicating visit template base data while adding the structured layer the workspace needs.

When the toggle is off and demo mode is active, `fetchVisitTemplates` returns the same BRIGHTEN-2 templates via `demoSiteRepo` — the real adapter maps these to flat items with `phase = 'assessment'` and `classification = 'required'` as defaults.

**The mock fixture is the Sprint 2 schema spec.** Every field in the fixture maps to a DB column or JSONB key that will be added to `protocol_visit_templates` or `protocol_extracted_items` in the next sprint.

## Design decisions (baked in from architecture + design review)

### Checklist phase expansion default
Phases default to **collapsed**. A `defaultExpandedPhases(snapshot: VisitSnapshot): ExecutionPhase[]` pure function in the adapter layer auto-expands 1–2 phases by visit type:
- Dosing visits → `['pre_dose', 'dosing']`
- Safety/AE-heavy visits → `['safety_ae_conmed']`
- All others → `['assessment']`
An empty phase (no items) is hidden entirely — do not render an empty section header.

### Conditional rules — inline, not separate section
Conditional rules are rendered as a collapsed amber callout **directly under the checklist item they govern**, not in a standalone section. Callout label: "↳ If: [condition_text]". Expands to show consequence_text + source section chip. No `ConditionalLogicCard` as a top-level section in Sprint 1.

### Visit Snapshot stat visibility
Zero-value indicators are hidden. The snapshot renders only non-zero critical indicators as chips: visit window (always), endpoint-critical count (hide if 0), conditional rule count (hide if 0), needs-review count (hide if 0). Cap at 3 visible chips above the fold.

### Review interaction mechanic
Single click on an item row cycles `not_reviewed → reviewed`. A `⋯` overflow button on each row opens a 3-item menu: "Flag for review", "Add site note", "Mark needs clarification". State is `useState<Map<string, ExecutionReviewStatus>>` in `VisitExecutionTab` — client-local, not persisted to DB.

### Phase labels are visit-type-aware
`pre_dose` renders as "Pre-Dose Requirements" for dosing visits and "Pre-Procedure Requirements" for non-dosing visits. Phase label map lives in a `PHASE_LABELS` constant in `src/types/visit-execution/index.ts`.

### PrefillAgentNote keying
`storageKey = \`piq-vew-draft-${visit_template_id}\`` — dismissal is per visit type, not global. PIQC voice override: `headline="I've mapped this visit from your protocol."` instead of the default "Drafts started."

### Traceability trigger
Each checklist item row ends with a muted `§` link chip. `aria-label="View protocol source for [item.label]"`. Click opens `TraceabilityDrawer` scoped to that item. One drawer instance in `VisitExecutionTab`, driven by `traceabilityItem: VisitExecutionItem | null` state.

### Export placeholder copy
Disabled button label: "Export draft". Tooltip: "All PIQC output is draft-ready and requires final review and approval outside PIQC. Export available in a future release."

## New types (Sprint 2 schema spec)

Defined in `src/types/visit-execution/index.ts`:

```typescript
ExecutionPhase         — pre_visit | check_in | assessment | dosing | post_dose | safety_ae_conmed | close_out
ItemClassification     — required | conditional | if_applicable | primary_endpoint | secondary_endpoint | safety_critical
ExecutionReviewStatus  — not_reviewed | needs_review | reviewed | edited | site_note_added
ConditionalRule        — { condition_text, consequence_text, source_section, source_page }
AssessmentTimingConstraint — { label, window_before_minutes, window_after_minutes, is_hard_constraint, source_section }
SourceFieldScaffold    — { field_label, field_type, units, normal_range, is_required }
VisitItemTraceability  — { cross_reference_source_section, cross_reference_page, source_evidence_id, soa_column, protocol_section, protocol_page, amendment_version }
VisitExecutionItem     — id + extracted_item_id (null Sprint 1) + label + phase + classification + conditions[] + timing + source_fields[] + traceability + review_status + review_note
VisitSnapshot          — name + study_day + window_minus + window_plus + is_dosing_visit + has_primary_endpoint + has_safety_critical + item_count + reviewed_count + flagged_count + amendment_version
VisitExecutionWorkspace — visit_template_id + protocol_id + snapshot + items[]
```

## Dashboard.tsx changes

```
DashboardTab union: add 'visit-execution' | 'today', keep 'overview' for backward-compat redirect → 'visit-execution'
SITE_TABS[0]: { id: 'visit-execution', label: 'Visit Prep', icon: ClipboardList }
SITE_TABS[1]: { id: 'today', label: 'Today', icon: CalendarCheck }  ← was index 0 as 'overview'
renderContent() case 'visit-execution': <ProtocolRequiredGate label="Visit Prep"><VisitExecutionTab /></ProtocolRequiredGate>
renderContent() case 'today': existing TodayTab render (was 'overview')
renderContent() case 'overview': redirect → 'visit-execution' (handles any bookmarked deep links)
useState default: 'visit-execution'
```

## CODEOWNERS additions (`docs/CODEOWNERS.md`)

```
/src/lib/visit-execution/                          @ish-dev-piqc
/src/components/dashboard/visit-execution/         @ish-dev-piqc
/src/types/visit-execution/                        @ish-dev-piqc
```

## Overlap flag

⚠️ `plans/kiara/billing-followups.md` (active) also declares `Dashboard.tsx` in Scope. Changes are in different parts of the file (billing wiring vs. SITE_TABS + renderContent). Coordinate merge order with Kiara — merge billing changes first if open, then rebase this branch.

## Decision debt

| Decision deferred | Why | Trigger to revisit |
|---|---|---|
| `visit_execution_items` table (Sprint 2) | Ingest schema unchanged Sprint 1 | Before any real parser integration |
| `visit_execution_item_reviews` table (Sprint 2) | Client-local state sufficient Sprint 1 | When "reviewed" needs to survive reload |
| `conditional_rules` in `CLINICAL_EXTRACT_SCHEMA` (Sprint 2) | No parser extraction Sprint 1 | When mock is no longer acceptable for demo |
| VisitExecutionContext promotion | One consumer in Sprint 1 | When second component needs same workspace data |
| Per-assessment timing in DB | No schema backing Sprint 1 | Sprint 2 ingest extension |
| Export format | Undefined | When first user asks what "export" produces |

## Approved-by

- @ki-dev-piqc — `src/components/dashboard/Dashboard.tsx` (Site Mode tab navigation)

## Verification

- [ ] Toggle `piq-visit-execution-mock-v1` on in localStorage; refresh Site Mode — workspace loads with mock data showing 7 visit types in navigator
- [ ] Click each visit — snapshot updates above the fold; checklist phases collapse/expand correctly; only non-zero indicator chips visible
- [ ] Dosing visit (Baseline/Day 1): `pre_dose` + `dosing` phases auto-expand on selection
- [ ] Non-dosing visit (Week 4): `assessment` phase auto-expands; no "Pre-Dose" section rendered
- [ ] Conditional rule callout visible under its parent checklist item (collapsed by default, amber on expand)
- [ ] Timing banner renders for visit with `is_hard_constraint = true` item
- [ ] Click `§` chip on checklist item → TraceabilityDrawer opens scoped to that item; ESC + backdrop close work
- [ ] Single click on item row cycles `not_reviewed → reviewed`; `⋯` menu shows flag/note/clarification
- [ ] `PrefillAgentNote` fires once per visit type (not globally dismissed); PIQC headline reads "I've mapped this visit from your protocol."
- [ ] Export placeholder button is disabled; tooltip reads correctly
- [ ] Toggle mock OFF; reload — workspace attempts real `fetchVisitTemplates` and renders flat procedure list without crashing
- [ ] `piqc-review` passes (no cross-mode imports, no `text-gray-*` tokens, no `any` in lib layer)
- [ ] Dashboard "Today" tab still loads `TodayTab` correctly after rename
