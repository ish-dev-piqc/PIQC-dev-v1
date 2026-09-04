---
owner: sixonelabs-piqc
feature: intake-risk-candidates
status: active
started: 2026-09-04
target_pr:
---

# Intake: risk candidates derived from the parsed protocol

## Context

Stage 1 (Intake) risk tagging is hand-typed: the auditor reads the protocol
and types each section, tier and surface into the form, with an optional link
to a parsed source item. The parsed protocol (SOTR worksheet items: endpoints,
visits, dosing, criteria) already carries the structure a risk tag needs, and
the schema was built for this — `tagging_mode` has `PIQC_ASSISTED`,
`suggestion_provenance` and `source_extracted_item_id` exist — but nothing
derives anything. This is PR-5 of the approved chain
(`~/.claude/plans/cryptic-whistling-ullman.md`), after #605, #607, #611 and
#613: the "extract the risks" step of the owner's workflow (protocol knowledge
→ extract the risks → scope).

**Decision:** PIQC proposes protocol risks deterministically from the parsed
protocol's own structure (no model call, no keyword rules). Every proposal
names the SOTR item it came from and the rule that produced it; the auditor
accepts by saving the existing tagging form; the saved risk is
`tagging_mode = 'PIQC_ASSISTED'` with `suggestion_provenance`. Proposals are
recomputed on every mount and never stored. Vendor Intake first; the criterion
rule ships in the module for PR-6 (ISA) but is not shown on the vendor stage.

## Scope (files allowed)

- supabase/migrations/20260914000000_audit_mode_create_protocol_risk_from_candidate.sql
- src/types/audit/objects.ts
- src/lib/audit/riskCandidates.ts
- src/lib/audit/riskCandidatesApi.ts
- src/lib/audit/intakeApi.ts
- src/lib/audit/__tests__/riskCandidates.test.ts
- src/lib/audit/__tests__/riskCandidatesApi.test.ts
- src/lib/audit/__tests__/intakeApi.test.ts
- src/components/dashboard/audit/stages/intake/RiskCandidatesPanel.tsx
- src/components/dashboard/audit/stages/intake/__tests__/RiskCandidatesPanel.test.tsx
- src/components/dashboard/audit/stages/IntakeWorkspace.tsx
- plans/sixonelabs-piqc/intake-risk-candidates.md

## Out of scope (files forbidden)

- supabase/migrations/20260515010000_* and every applied migration — append-only; the deployed `audit_mode_create_protocol_risk` (11 args) is not replaced
- src/components/dashboard/audit/stages/intake/RiskTaggingForm.tsx — consumed as-is via `initialValues`
- src/components/dashboard/audit/stages/ProtocolReadinessCard.tsx, investigator/** — the ISA stage gets the panel in PR-6
- src/lib/audit/lineageAdapter.ts, src/components/dashboard/audit/HistoryDrawer.tsx — already render the non-manual branch and JSONB deltas
- src/lib/sotr/**, src/components/sotr/** — mode isolation; the item query is mirrored, not imported
- src/context/** — no store change; the panel is props-only
- supabase/functions/** — no edge function

## Architecture layers touched

- [x] migration (`supabase/migrations/`)
- [x] RPC (`supabase/functions/` or `.sql`)
- [ ] adapter (`src/lib/*/*Adapter.ts`)
- [ ] context (`src/context/`)
- [x] component (`src/components/`)
- [x] test (`src/**/__tests__/`)

(API layer: src/lib/audit/riskCandidatesApi.ts + intakeApi.ts; pure rules
module: src/lib/audit/riskCandidates.ts; types: `SuggestionProvenance`.)

## Mock data plan

none

## Approved-by

- @karl-dev-piqc — for src/lib/audit/**, src/types/audit/**, src/components/dashboard/audit/**
- @rv61 — for supabase/migrations/** (owner of this plan)

## Decisions

- **New RPC name** `audit_mode_create_protocol_risk_from_candidate`, not a
  CREATE OR REPLACE of the deployed `audit_mode_create_protocol_risk`: the
  11-argument signature keeps working with no drift window, and PostgREST
  overload ambiguity is avoided. Body copies the deployed create with three
  differences: the source item is required (23514 when null), `tagging_mode`
  is `PIQC_ASSISTED`, `suggestion_provenance` is stored and written to the
  delta. Same lead-auditor gate, same cross-protocol check. Grants per
  20260911000000 (REVOKE PUBLIC/anon, GRANT authenticated/service_role).
- **Rules are table-driven and litmus-clean** — every attribute comes from the
  item's own `field_path` / `field_type` / value shape, never from prose:
  `primary_endpoints[` → PRIMARY/DATA_INTEGRITY; `secondary_endpoints[` →
  SECONDARY/DATA_INTEGRITY; dosing → SAFETY/PATIENT_SAFETY; visit with
  procedures → SUPPORTIVE/DATA_INTEGRITY, time-sensitive when the window is
  non-zero; criterion → SAFETY/BOTH (module only; vendor Intake excludes it).
  `vendor_dependency_flags` is `[]` and `operational_domain_tag` is `''` in
  every proposal — the form requires the auditor to choose the domain.
- **Provenance** `{ source: 'sotr_item', rule, field_path, field_type,
  confidence_state, document_id, proposed: {…five attributes}, derived_at }` —
  identifiers and the proposal only, no quoted protocol text, so History can
  show what PIQC proposed vs what the auditor saved.
- **Section identifier** = primary evidence `§{section_number}` when the item
  has one, else its `field_path`. Title = `current_text ?? extracted_value`
  trimmed to 120 chars. Visits: "{visit_name} — Day {n} ({window}) · {≤4
  procedures, +k more}".
- **Dedupe** by `source_extracted_item_id` against the tagged list; accepted
  candidates disappear and stay gone on reload. No dismiss — a session-only
  hide would silently resurface (ledger).
- **Read path** mirrors sourceEvidenceApi's item query (mode isolation forbids
  importing it), filtered to ready documents and the four field types, then
  one batched primary-evidence lookup; `quoted_text` is never selected.
  Reach: own documents today, audited protocols once #607's policies apply.
- **Fallback before `db push`:** the candidate RPC answers PGRST202 →
  `notApplied` → the workspace saves through the deployed manual create with
  the source link and shows "Recorded as manually tagged — PIQC-assisted
  provenance isn't available in this environment yet." Nothing is lost; the
  chip is the only difference.
- **Stable `initialValues`**: RiskTaggingForm resets its state whenever the
  `initialValues` reference changes, so the candidate's proposal is memoised
  on the pending candidate — a re-render mid-save must not wipe the auditor's
  domain choice.
- Downstream unchanged by design: `audit_mode_derive_criticality` scores a
  PIQC-assisted risk exactly like a manual one; lineage already labels the
  non-manual branch; History renders the JSONB provenance through the generic
  delta viewer.

## Verification

Static review only on this machine (no Node): CI's tsc + vitest is the first
execution. Owner walk on the deployed app (a vendor audit whose protocol PDF
is parsed — Stage 1 card reads "Parsed · N worksheet items"):

Before `db push` (RPC not applied):
- [ ] Intake shows "Suggested from the parsed protocol" grouped Primary
      endpoints / Secondary endpoints / Dosing / Visits; each row names the
      rule, the section, the title and its SOTR state; no eligibility criteria
      appear on the vendor stage.
- [ ] Accept → form opens prefilled (identifier, title, tier, surface,
      time-sensitivity, source linked with "View source"); domain empty and
      required. Save → row saved via the manual path with the muted "Recorded
      as manually tagged…" note; the candidate leaves the list.

After `db push`:
- [ ] Accept + Save → row wears the "PIQC-assisted" chip; History shows
      `tagging_mode: PIQC_ASSISTED` and the provenance (rule, field_path,
      proposed values); reload → the candidate is still gone (dedupe by source
      item). Lineage's Stage-1 node reads "PIQC-assisted tag, auditor-confirmed
      in Intake."
- [ ] Change the proposed tier in the form before saving → the saved tier
      wins; History's provenance still shows the proposed tier.
- [ ] Stage 2 → map the PIQC-assisted risk to the vendor service → criticality
      derives exactly as for a manual risk; Stage 4 lists it under Protocol
      risk scope; the Risk summary rail offers it under "not linked · Link".
- [ ] Read-only probe with the public key:
      `audit_mode_create_protocol_risk_from_candidate` → 42501 (exists, anon
      revoked).
- [ ] Tests green in CI: riskCandidates (every rule, dedupe, order, window →
      time-sensitivity, malformed → skipped, include filter, evidence-first
      identifier), riskCandidatesApi (query shape, evidence merge, error),
      intakeApi (candidate create forwards provenance + source id; PGRST202 →
      notApplied), RiskCandidatesPanel (loading / error + Retry / none / list /
      all accepted / Accept → onAccept / disabled).
