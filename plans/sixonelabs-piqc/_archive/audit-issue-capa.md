---
owner: sixonelabs-piqc
feature: audit-issue-capa
status: merged
started: 2026-07-02
target_pr: 397
merged: 2026-07-02
---

# Issues & CAPA — triage a finding into an Issue, draft the CAPA, review, export

## Context

Phase 3 of the Audit Workspace arc (#391 foundation, #393 hub, #395 traceability). Audit Mode
produces findings (Stage 6 `AuditWorkspaceEntryObject`) but has no downstream: no Issue record, no
CAPA. This adds the **Issue → CAPA loop**: triage a finding into an Issue (severity, regulatory /
sponsor-reporting flags), then draft a **CAPA** (root cause / corrective / preventive) through the
draft-only review loop — `DRAFT → NEEDS_REVISION → ACCEPTED` (ready to export; **no "Final" in-app**
— finalization happens in the QMS). CAPA prefills from the finding's context with the established
"PIQC drafted" attribution (templated, like Stage 5 prefill — LLM narrative refinement is a
documented follow-up, mirroring the exec-summary arc). New objects are state-history tracked and
flow into the Phase-2 traceability graph automatically.

## Scope (files allowed)

- supabase/migrations/*audit_mode_issue_capa*.sql
- src/types/audit/enums.ts
- src/types/audit/objects.ts
- src/lib/audit/capaApi.ts
- src/lib/audit/__tests__/capaApi.test.ts
- src/lib/audit/labels.ts
- src/lib/audit/lineageAdapter.ts
- src/lib/audit/lineageApi.ts
- src/lib/audit/__tests__/lineageAdapter.test.ts
- src/lib/audit/__tests__/lineageApi.test.ts
- src/components/dashboard/audit/IssuesCapaDrawer.tsx
- src/components/dashboard/audit/TraceabilityDrawer.tsx
- src/components/dashboard/audit/AuditWorkspaceShell.tsx
- plans/sixonelabs-piqc/audit-issue-capa.md

## Out of scope (files forbidden)

- supabase/functions/** — no new edge function; CAPA prefill is templated client-side (Stage 5
  pattern). LLM refinement = follow-up.
- src/context/** — drawer fetches on open (RiskSummaryPanel/Traceability pattern).
- Merged migrations (append-only rule); all other stage components.

## Architecture layers touched

- [x] migration (schema + RPCs, two files per ALTER TYPE transaction rule)
- [ ] RPC edge functions
- [x] adapter (lineageAdapter extension — pure)
- [ ] context
- [x] component (IssuesCapaDrawer, Stage 6 affordance, shell button, traceability labels)
- [x] test (capaApi + lineageAdapter extension)

## Mock data plan

none.

## Approved-by

- @karl — `src/**/audit/**`, `src/lib/audit/**`
- @roger — `supabase/migrations/**`

## Deferred (documented, not built)

- Per-entry "Raise issue" button inside Stage 6 (AuditConductWorkspace) — the shell's dispatch
  comment explicitly warns against growing the stage-props if-ladder for a second stage; wiring it
  properly means a context hoist. The drawer's triage form has a Stage 6 finding picker, so the
  triage path exists without it. Follow-up alongside the context hoist.
- LLM CAPA narrative drafting (audit-summary edge-fn pattern) — follow-up like PR #69→#71.
- "Tracked by VBO" badge on GCP-vendor CAPAs — needs Phase 4's GxP classification attribute.
- Issue routing to non-CAPA SOPs (non-compliance / protocol deviation) — out of app scope.
- Header IA pass — the workspace header now carries five labeled buttons (New audit / Protocol
  source / Traceability / Issues & CAPA / Risk summary). flex-wrap (from #393) keeps it functional;
  grouping the three record surfaces under one affordance is the right fix and deserves its own
  design pass, not a rushed icon-only compromise here. Decision-debt, flagged deliberately.

## Verification

- [x] Issues & CAPA drawer's triage form lists Stage 6 FINDING entries FIRST (value-first); picking one prefills title + severity and links the issue; re-picking replaces an untouched auto-title.
- [x] Issue list with severity + neutral-tone reporting flags; per-issue CAPA card with "PIQC drafted" chip, root-cause/corrective/preventive fields, Accept (ready to export) / Needs revision / Reopen draft / Export → QMS; editing an ACCEPTED CAPA demotes to DRAFT (server-enforced); exported CAPAs immutable server-side.
- [x] No "Approve/Final" action anywhere on CAPA; strongest state is "Accepted (ready to export)"; failure states surface visibly (silent-with-signal).
- [x] Issues and CAPAs are history-tracked (deltas in every RPC; visibility fn extended).
- [x] Traceability graph grows finding → issue → CAPA branches with provenance edges; adapter tests cover nesting, orphan-safety, provenance.
- [x] Pre-PR reviews: /design-critique (6 applied) + 3-lens adversarial (18 findings: 1 refuted with evidence — the catch-all edge filter already drops dangling provenance edges; migration version collision fixed by rename to 000200/000300; exported-immutability guards added; dead updateIssue RPC+wrapper deleted; header-toggle discard trap fixed; stale-title re-pick fixed; Reopen-draft path added; failure signaling added; stage badge fixed for directly-raised issues).
- [ ] `npm run typecheck` + `npm test` green in CI (server gate); dev team applies BOTH migrations in order (000200 schema → 000300 RPCs).
