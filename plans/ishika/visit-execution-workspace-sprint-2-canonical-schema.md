---
owner: ish-dev-piqc
feature: visit-execution-workspace-sprint-2-canonical-schema
status: active
started: 2026-05-26
target_pr:
---

# Visit Execution Workspace — Sprint 2: Canonical Protocol Logic Data Model (design doc)

## Context

Sprint 2 of the Visit Execution Workspace arc. Sprint 1 (PR #119) built a working UI shell powered by typed mock data behind the `piq-visit-execution-mock-v1` localStorage toggle. Per the founder roadmap ([memory](../../../.claude/projects/-Users-sixonelabsllc-Desktop-vendor-piqc/memory/project_vew_sprint_roadmap.md)), Sprint 2's job is to define the structured data model that will eventually power the workspace from real Supabase data.

This PR ships **a design doc only** — no migrations, no code. The doc gives Roger (`/supabase/` codeowner) a single artifact to react to before any migration code is written. The eventual Sprint 2.5 migration PR will follow Roger's review.

## Scope (files allowed)

- `docs/visit-execution/canonical-schema.md`
- `plans/ishika/visit-execution-workspace-sprint-2-canonical-schema.md` (this plan)

## Out of scope (files forbidden)

- `src/types/visit-execution/` — in flight in PR #119; must not modify until merged
- `src/lib/visit-execution/` — in flight in PR #119; must not modify until merged
- `src/components/dashboard/visit-execution/` — Sprint 1 territory
- `supabase/migrations/` — Roger's territory; doc is the INPUT to his review, not implementation
- `supabase/functions/ingest/` — Roger's territory; ingest schema extension is Sprint 3
- `src/components/dashboard/Dashboard.tsx` — no nav changes this sprint
- `docs/CODEOWNERS.md` — no ownership changes this sprint (docs/ doesn't need an entry; design doc inherits from default)

## Architecture layers touched

- [ ] migration (`supabase/migrations/`)
- [ ] RPC (`supabase/functions/` or `.sql`)
- [ ] adapter (`src/lib/*/*Adapter.ts`)
- [ ] context (`src/context/`)
- [ ] component (`src/components/`)
- [ ] test (`src/**/__tests__/`)

Documentation-only. None of the standard code layers are touched. The design doc proposes future schema additions but defers all implementation to Sprint 2.5 (migration PR) and Sprint 3 (parser integration).

## Mock data plan

None. This PR adds no code.

## Approved-by

- `@rv61` (Roger) — informational tag on the PR for schema architectural input. The doc is *for* his review. Not a formal "Approved-by" since no `/supabase/` files are modified, but his sign-off determines what Sprint 2.5 looks like.

## Design doc contents

The single deliverable (`docs/visit-execution/canonical-schema.md`) covers:

1. **Object model + relationships** — Protocol → ProtocolVersion → Visit → Requirement → Procedure, plus side objects (ConditionalRule, TimingRule, SourceField, TraceabilityReference, RoleSignal, CriticalityTag, ReviewStatus, HumanEdit).
2. **Map of Sprint 1 TypeScript types → proposed Postgres tables.** Cites the Sprint 1 type file by line.
3. **Proposed table schemas as SQL code blocks** — NOT migration files. Designed to extend existing tables (`protocol_visit_templates`, `protocol_extracted_items`) where possible rather than create parallel ones.
4. **Parser output mapping.** How `CLINICAL_EXTRACT_SCHEMA` in [`supabase/functions/ingest/index.ts`](../../../supabase/functions/ingest/index.ts) needs to extend to produce the canonical objects.
5. **Protocol-derived vs human-edited separation.** Mirror the `worksheet_review_events` append-only pattern (introduced in migration `20260508040000_sotr_draft_review_schema.sql`).
6. **Traceability storage path.** Preserve the existing chain: canonical Requirement → `protocol_extracted_items.id` → `protocol_item_evidence_links` → `protocol_source_evidence`.
7. **Migration sequence + filenames** for the eventual Sprint 2.5 PR.
8. **Decision debt items** deferred to Sprint 3+.

## Branching strategy

- **Base branch:** `feat/visit-execution-workspace` (PR #119), NOT `main`. Sprint 1's `src/types/visit-execution/index.ts` is the source of truth for "what does the workspace need from the schema?" — the doc cites it directly.
- **Rebase posture:** Once #119 merges, this branch rebases onto main cleanly. The new doc file has no overlap with anything on main.
- **If #119 is requested to change:** Sprint 2 doc updates to match. No DB schema is locked in until Roger reviews the doc.

## Verification

- [ ] Doc renders correctly in GitHub preview (mermaid diagrams visible, code blocks formatted)
- [ ] Every canonical object in the doc cites either a Sprint 1 type (with line number) or an existing Supabase table
- [ ] Doc explicitly answers the founder's four Sprint 2 questions (visit requirement object, SoA-vs-body-text merge, footnote representation, protocol-derived-vs-human-edited separation)
- [ ] Proposed migration sequence lists filenames in chronological order with rationale
- [ ] Roger reviews and either approves or surfaces concrete schema concerns — the doc is the unit of his review, not a draft migration
- [ ] `piqc-review` passes (trivial: only adds a doc file in scope; no code checks should fire)
