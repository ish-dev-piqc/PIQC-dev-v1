---
owner: sixonelabs-piqc
feature: Narrative-first visit landing — the brief + the day in order (slice 1, deterministic)
status: merged
merged: 2026-07-19
started: 2026-07-19
target_pr: #512
---

# Narrative-first visit landing (S1 — deterministic)

## Context

Validation critique: PIQC "delivered the SoA clearly but did not deliver the narrative" — coordinators went back to the PDF. The narrative is already extracted (purpose, conditions, timing, roles, source quotes, divergences) and flattened into checklist metadata. This slice makes the visit **open on a reading**: a composed Visit Brief (deterministic, template-assembled — the vendor lane's `templated` rung, zero LLM), the day-in-order sequence (pure derivation), and the checklist demoted to an explicit "Work the visit" layer below. Design approved by the founder from the Fable concept pass (Artifact: narrative-first-concepts — concept A + B-timeline graft + C's rows already ~80% on main).

Slice 2 (separate arc): LLM refine pass on the brief with a per-sentence cite-or-withhold gate (sibling of the ISA anchor gate). NOT in this slice.

## Scope (files allowed)

- plans/sixonelabs-piqc/narrative-first-visit-landing.md
- plans/fable/HANDOVER-narrative-first-landing.md
- src/lib/visit-execution/visitBriefModel.ts
- src/lib/visit-execution/__tests__/visitBriefModel.test.ts
- src/components/dashboard/visit-execution/VisitBriefBlock.tsx
- src/components/dashboard/visit-execution/VisitSequenceBlock.tsx
- src/components/dashboard/visit-execution/VisitSnapshotCard.tsx
- src/components/dashboard/visit-execution/VisitExecutionTab.tsx

## Out of scope (files forbidden)

- src/components/dashboard/visit-execution/ExecutionChecklist.tsx (rows already carry narrative per spec §2.3 — no changes)
- src/lib/divergence/**, src/types/divergence/** (DivergencePanel reused as-is)
- supabase/** (zero backend — this slice renders existing fields)
- src/lib/sotr/**, src/components/sotr/**
- Everything else

## Architecture layers touched

component, pure model (lib), test. No migration, no RPC, no adapter change, no context.

## Mock data plan

None.

## Approved-by

- @ish-dev-piqc (owns src/lib/visit-execution/, src/components/dashboard/visit-execution/) — review tag on the PR.

## Overlap note

- plans/ishika/site-mode-ux-gaps.md (in-review, branch fix/site-mode-ux-gaps) also lists VisitExecutionTab.tsx — their change is the parsing-aware EMPTY-workspace copy; this slice restructures the LOADED-workspace pane. Disjoint hunks; trivial merge either order.

## Design (locked by the approved concept)

1. **visitBriefModel.ts (pure)** — `buildVisitBrief(workspace, visitDivergences)` → `VisitBriefLine[]`:
   orient (snapshot.purpose, `piqcDrafted: true`) · scope (applies_to) · clock (study day + window) ·
   gate lines (items with conditions, capped at 3 + honest "+N more" line) · timed lines
   (hard-constraint timing, capped) · watchout (divergence count). Refs carry ONLY the source that
   supports the claim (condition.source_section/page for gate lines — never the item's SoA quote
   attached to a condition claim). `formatBriefWhere(section, page)` shared formatter.
2. **VisitBriefBlock** — the reading card: "PIQC drafted · DRAFT — verify before use" attribution,
   prose lines, per-claim source chips expanding a where/quote card inline.
3. **VisitSequenceBlock** — "The visit, in order": items grouped by EXECUTION_PHASE_ORDER
   (dosing-aware labels), each node = label + role + timing + GATE marker; expands to description,
   if/then, timing, source-field chips, verbatim source quote + "View full source" → existing
   TraceabilityDrawer. Renders ALL items (the reading ignores the role lens — the lens narrows the
   acting checklist only).
4. **VisitExecutionTab** — new pane order: Coverage → Cohort → SnapshotCard (purpose suppressed via
   new `hidePurpose` prop) → **VisitBriefBlock** → DivergencePanel → CompletenessSignalsPanel
   (moved up: it's a watch-out, not a checklist affordance) → **VisitSequenceBlock** →
   **"Work the visit"** collapsed section (Add requirement + RoleFilterBar + ExecutionChecklist +
   export row). Mutation-error banner stays OUTSIDE the collapse. Collapse resets on visit change;
   auto-opens on add-requirement / promote-signal so a new row is never invisible.
5. Completeness doctrine: nothing subtracted — the sequence shows every requirement at rest; the
   checklist keeps the full acting surface one gesture away with its count on the toggle.

## Verification

- `node_modules/.bin/tsc --noEmit -p tsconfig.app.json` clean.
- `vitest run src/lib/visit-execution` green (new visitBriefModel tests + existing suites).
- visitBriefModel tests: orient/scope/clock line assembly, gate-line refs use the condition's own
  source only, cap honesty line, divergence watchout line, placeholder-purpose passthrough,
  empty-conditions visit → no gate lines.
- Browser pass (dev-team lane, post-merge): seeded protocol → visit opens on brief + sequence;
  checklist behind "Work the visit"; role filter + export + mutations unchanged inside it.
