---
owner: sixonelabs-piqc
feature: audit-traceability
status: merged
merged: 2026-07-03
started: 2026-07-02
target_pr: #395
---

# Audit traceability — per-audit seed→tree lineage drawer

## Context

Phase 2 of the Audit Workspace arc (#391 foundation, #393 hub). PIQC's audit data is already a
lineage graph — FKs, service↔risk mappings, multi-parent workspace entries, prefill provenance
(`source_risk_summary_id`), `state_history_deltas` — but there is no view onto it. This adds a
**Traceability drawer**: the audit's full seed→tree (Auditee seed → Audit → risks / service /
mappings / trust / questionnaire / risk summary / deliverables / findings / report) as an indented
tree + a compact SVG lineage graph, every node carrying status, origin, and one-click history
(reuses `HistoryDrawer`/`getObjectHistory`). Auditee-neutral node model (seed = generic auditee,
today always the vendor). One surface, not two — the reference design's "related records panel" +
"explorer" merge into a single drawer per the cognitive-load doctrine. Cross-audit explorer + RPC
deferred.

## Scope (files allowed)

- src/lib/audit/lineageAdapter.ts
- src/lib/audit/lineageApi.ts
- src/lib/audit/__tests__/lineageAdapter.test.ts
- src/components/dashboard/audit/TraceabilityDrawer.tsx
- src/components/dashboard/audit/AuditWorkspaceShell.tsx
- plans/sixonelabs-piqc/audit-traceability.md

## Out of scope (files forbidden)

- supabase/** (read-only feature; composes EXISTING per-audit fetchers — no new RPC/migration)
- src/context/** (drawer fetches on open via lineageApi, same pattern as RiskSummaryPanel)
- Stage workspace components; HistoryDrawer (reused as-is)
- Cross-audit explorer (deferred follow-up)

## Architecture layers touched

- [ ] migration
- [ ] RPC
- [x] adapter (`lineageAdapter.ts` — pure, no supabase import)
- [ ] context
- [x] component (TraceabilityDrawer + shell button)
- [x] test (pure adapter tests: seed reachability, no orphans, reference edges)

## Mock data plan

none.

## Approved-by

- @karl — `src/**/audit/**`, `src/lib/audit/**`

## Verification

- [x] Traceability button in the workspace header opens the drawer for the active audit.
- [x] Tree shows seed (auditee, PIQC-blue) → audit → all stage objects with human-readable status labels + origin lines; reference links (mapping→risk, finding→risk/mapping, prefill→risk summary) render as chips/dashed edges with an explanatory legend.
- [x] Every node reachable from the seed (adapter test); no orphan edges (adapter test); dangling-target edges dropped (adapter test).
- [x] History button per tracked node opens the existing HistoryDrawer as a sibling control (no nested-interactive HTML); ESC closes only the topmost drawer (parent overlay suspended while history is open).
- [x] Entity filter + text search prune the tree while preserving ancestor paths; seed auto-selected on open; mini-map height-capped with legend; empty state for fresh audits.
- [x] Pre-PR review: 3-lens adversarial pass (correctness/discipline/UX — 14 findings: 1 unique blocker + 5 unique should-fix, all applied) + /design-critique (6 findings, all applied).
- [ ] `npm run typecheck` + `npm test` green in CI (server-side gate).
