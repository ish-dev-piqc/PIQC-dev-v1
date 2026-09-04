---
owner: sixonelabs-piqc
feature: risk-summary-from-protocol
status: active
started: 2026-09-04
target_pr:
---

# Risk summary: study context from the parsed protocol, tagged risks linked

## Context

The vendor Risk summary's "Generate stub" reads nothing from the protocol: it
writes `therapeutic_space: 'TBD — capture from protocol'`, empty endpoints and
phase NOT_APPLICABLE, and the summary ↔ tagged-risk junction
(`vendor_risk_summary_protocol_risks`) has link RPCs but no caller in `src/`,
so the panel's "Linked protocol risks" and the deliverable drafter's
junction-derived scope areas are empty for every real audit. The owner's
workflow is protocol knowledge → extract the risks → scope; this is PR-4 of the
approved chain (`~/.claude/plans/cryptic-whistling-ullman.md`) and the first
slice of the risk feed, after #605, #607 and #611.

**Decision:** the study-context snapshot is captured from the audit protocol's
most recent ready document with provenance; the risks tagged at Intake are
linked at generation; focus areas are seeded from those risks' operational
domains; the narrative stays human-written. Frontend only — no migration.

## Scope (files allowed)

- src/lib/audit/riskSummaryApi.ts
- src/lib/audit/__tests__/riskSummaryApi.test.ts
- src/types/audit/objects.ts
- src/components/dashboard/audit/RiskSummaryPanel.tsx
- plans/sixonelabs-piqc/risk-summary-from-protocol.md

## Out of scope (files forbidden)

- supabase/migrations/** — no schema change; `study_context` is JSONB, the link RPCs exist (20260430160000 / 20260827000100)
- src/context/** — the panel reads/writes the existing AuditDataContext stores only
- src/components/dashboard/audit/stages/IntakeWorkspace.tsx, ScopeReviewWorkspace.tsx — consumers of the same stores, untouched
- supabase/functions/audit-deliverable-draft/** — reads the junction as-is
- src/lib/audit/intakeApi.ts — `fetchProtocolRisksForAudit` consumed as-is

## Architecture layers touched

- [ ] migration (`supabase/migrations/`)
- [ ] RPC (`supabase/functions/` or `.sql`)
- [ ] adapter (`src/lib/*/*Adapter.ts`)
- [ ] context (`src/context/`)
- [x] component (`src/components/`)
- [x] test (`src/**/__tests__/`)

(API layer: src/lib/audit/riskSummaryApi.ts; types: TS-only change to a JSONB shape.)

## Mock data plan

none

## Approved-by

- @karl-dev-piqc — for src/lib/audit/**, src/types/audit/**, src/components/dashboard/audit/**

## Decisions

- `fetchParsedStudyContext(protocolId, phase)` reads the most recent READY
  PROTOCOL document's `extracted_fields` (RLS: own documents; audited protocols
  once #607's policies are applied). No row → `{ ok: true, data: null }`, an
  honest empty, not an error. A read error aborts generation with a visible
  reason — nothing is written under a wrong or unknown context.
- `buildStudyContext` is pure: `therapeutic_area`, `primary_endpoints`,
  `secondary_endpoints` from the Reducto schema, junk dropped never guessed;
  the phase is the audit's pinned version phase, never the PDF's free-text
  `study_phase`; `source: 'parsed_document'` + `source_document_id` inside the
  JSONB (TS-only type change; rows created before this PR have no `source` and
  keep their current "Snapshot …" line).
- No parsed document → `manualStudyContext` (empty fields, `source: 'manual'`)
  and the panel says "Study context not captured — no parsed protocol yet (see
  Stage 1)". Never the 'TBD' string.
- Narrative is written as '' (approve stays disabled until it's written —
  existing rule); the panel shows "Not written yet" instead of a blank.
- `focusAreasFromRisks` seeds focus areas from the tagged risks' operational
  domain labels (deduped, alphabetical; unknown vocabulary falls back to the
  raw value). These feed Stage-5 prefill (letter scope, agenda topics) and the
  drafter's scope areas.
- `linkProtocolRisksToSummary` is the first `src/` caller of
  `audit_mode_link_protocol_risk_to_summary`; sequential, stops at the first
  error with the count so far. `false` (already linked) counts as linked.
- Drift after generation: the panel hydrates the tagged-risk store when empty
  (the same store Intake and Scope Review fill) and shows "N tagged sections
  not linked · Link". Linking an APPROVED summary demotes it to Draft
  (20260827000100) — the affordance says so, and the shared stage readout is
  refreshed like saveEdits does.
- `sponsor_name` from the extraction is never copied (sponsor-name-free rule).

## Verification

Static review only on this machine (no Node): CI's tsc + vitest is the first
execution. Owner walk on the deployed app (a vendor audit whose protocol PDF
you uploaded and parsed):

- [ ] Right rail → "Generate from protocol" → Study context shows the PDF's
      therapeutic area and primary/secondary endpoints, phase = the audit's
      phase, line reads "Captured from the parsed protocol {today}"; narrative
      shows "Not written yet"; Approve disabled; focus areas = the domains of
      the sections tagged at Intake; Linked protocol risks lists every tagged
      section. History: "Risk summary generated from protocol" then one
      "Protocol risk linked" per section.
- [ ] Edit → write the narrative → Save → Approve → Approved.
- [ ] Tag one more section at Intake → rail shows "1 tagged section not linked
      · Link" with "Linking demotes to Draft." → Link → listed, status Draft.
- [ ] Vendor audit on a protocol with no parsed PDF → generate → empty context
      + "Study context not captured — no parsed protocol yet (see Stage 1)";
      nothing reads "TBD".
- [ ] Stage 5 → Generate confirmation letter → scope carries the focus areas;
      Stage 7 findings-report draft's scope areas include the linked risks'
      domains (previously always empty).
- [ ] Tests green in CI: riskSummaryApi (buildStudyContext, manualStudyContext,
      focusAreasFromRisks, fetchParsedStudyContext no-row/error/row + query
      shape, linkProtocolRisksToSummary all/partial/empty).
