---
owner: ish-dev-piqc
feature: visit-execution-workspace-sprint-3-parser-integration
status: in-review
started: 2026-05-26
target_pr: 124
---

# Visit Execution Workspace — Sprint 3: Parser Integration (design doc)

## Context

Sprint 1 (PR #119) shipped the workspace UI shell with rich mocked data. Sprint 2 (PR #121) merged the canonical schema design doc. Sprint 2.5 (PR #123, in-review) is the SQL migration that creates the tables. Sprint 3 is **the parser integration that populates those tables from real protocol PDFs.**

This PR ships **a design doc only** — same pattern as Sprint 2. The doc gives Roger (`/supabase/functions/ingest/` codeowner) a single artifact to review while #123 is in his queue. Sprint 3.5 (the implementation) follows once Sprint 2.5 lands.

Sprint 3 is the **first sprint where the new product principles materially change what we build:**
- **Completeness** (founder, 2026-05-26): partial coverage is failure. Sprint 3 needs a missing-requirement detection pass — not Sprint 7.
- **Anytime mastery** (founder, 2026-05-26): every element must teach. Sprint 3 needs substantive purpose-prose extraction per visit — placeholder text fails the mastery principle.
- **Research-anchored** ([memory](../../../.claude/projects/-Users-sixonelabsllc-Desktop-vendor-piqc/memory/research_vew_design_evidence.md)): Babaeipour 2026's 40% improvement requires expert oversight as a kept feature — the doc must preserve the human-in-the-loop.

## Scope (files allowed)

- `docs/visit-execution/parser-integration.md` — the design doc
- `plans/ishika/visit-execution-workspace-sprint-3-parser-integration.md` — this plan

## Out of scope (files forbidden)

- `supabase/functions/ingest/index.ts` — Roger's territory; design doc is INPUT to his review, not implementation
- `supabase/functions/_shared/sourceEvidenceAdapter.ts` — Roger's territory
- `supabase/functions/_shared/sotrTypes.ts` — Roger's territory
- `supabase/functions/_shared/ingestPipeline.ts` — Roger's territory (introduced in #106)
- `supabase/migrations/` — any Sprint 3.5 migrations (e.g., `protocol_visit_templates.purpose`) come in a separate PR after the design is approved
- `src/types/visit-execution/index.ts` — adapter-side type changes come in Sprint 3.5
- `src/lib/visit-execution/visitExecutionAdapter.ts` — Sprint 3.5
- `src/lib/visit-execution/visitExecutionApi.ts` — Sprint 3.5
- `src/components/dashboard/visit-execution/` — no UI changes this sprint
- `docs/visit-execution/canonical-schema.md` — Roger-approved (PR #121); do not modify

## Architecture layers touched

- [ ] migration
- [ ] RPC
- [ ] adapter
- [ ] context
- [ ] component
- [ ] test

Documentation-only.

## Mock data plan

None. No code.

## Design doc contents

`docs/visit-execution/parser-integration.md` covers:

1. **Pipeline overview** — Reducto extraction → adapter → DB writes → workspace read
2. **`CLINICAL_EXTRACT_SCHEMA` extension** — full proposed `procedures_structured[]` shape per visit, plus new top-level `visit_purpose` field
3. **Missing-requirement detection (second-pass LLM)** — addresses founder completeness principle; the trust mechanism that catches what Reducto missed
4. **Purpose prose extraction** — addresses founder mastery principle; substantive visit-purpose text per visit
5. **Confidence propagation** — how existing `protocol_extracted_items.confidence_state` flows into `visit_requirements`
6. **Phase + classification assignment** — heuristic + LLM-aided strategies when Reducto returns structured procedures but doesn't tag phase/classification
7. **Re-ingest semantics** — preserving human edits across protocol re-parsing
8. **Sprint 3.5 migration sequence** — small additions to existing tables (purpose column, parser_confidence)
9. **Adapter + API rewiring** — how `visitExecutionApi.ts` shifts from mock-toggle to real RPC call once Sprint 2.5 lands
10. **Decision debt** — what gets deferred to Sprint 4+

## Approved-by

- `@rv61` (Roger) — the doc is for his review (he owns `supabase/functions/ingest/`). Not a formal Approved-by since no `/supabase/` files change.

## Branching strategy

- **Base branch:** clean `main`. Sprint 2 and 1 already merged; #123 in-review doesn't conflict (Sprint 3 touches different files).
- **Sequence with #123:** independent. If #123 needs revisions after Roger reviews, Sprint 3's proposed migration additions adapt to match.

## Verification

- [ ] Doc renders in GitHub preview (mermaid pipeline diagram visible, SQL/JSON code blocks formatted)
- [ ] Pipeline diagram covers all 5 stages: Reducto Parse → Reducto Extract → second-pass missing-req detection → adapter → DB writes
- [ ] Proposed `CLINICAL_EXTRACT_SCHEMA` extension is additive only (no breaking change to current parse consumers)
- [ ] Missing-requirement detection prompt + output format specified
- [ ] Purpose-prose extraction specified (which LLM call, where stored)
- [ ] Re-ingest semantics: human edits via `current_text` are preserved across re-parsing
- [ ] Sprint 3.5 migration list matches the schema additions the doc proposes
- [ ] Roger reviews and either approves or surfaces concrete pipeline concerns
- [ ] `piqc-review` passes (trivial: doc file only)
