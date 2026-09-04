---
owner: sixonelabs-piqc
feature: isa-risk-tagging
status: merged
merged: 2026-09-04
started: 2026-09-04
target_pr: #617
---

# ISA Stage 2: protocol risk tagging on the investigator site workflow

## Context

The Investigator Site Audit's second stage, Risk assessment, still renders
`IsaStagePlaceholder`. The vendor workflow now has the full "extract the
risks" flow at Intake — deterministic candidates from the parsed protocol
(#615), manual tagging, PIQC-assisted accept with provenance — and it is
auditee-neutral by construction: `protocol_risk_objects` is scoped to the
protocol version, not the auditee. This is the first half of PR-6 of the
approved chain (`~/.claude/plans/cryptic-whistling-ullman.md`), after #605,
#607, #611, #613 and #615; the second half (`isa-site-modules`: the
`site_scope_mapping_objects` table keyed on the existing `isa_domain` enum,
criticality via `audit_mode_derive_criticality`) follows as its own intake.

**Decision:** ISA Stage 2 gets a real workspace that reuses the vendor tagging
flow through one extracted component with a `workflow` prop; the vendor-only
fields (operational domain, vendor dependency flags) are hidden for site
audits and the eligibility-criteria candidate rule is switched on. A
site-tagged risk carries no vendor domain, so `operational_domain_tag`
becomes nullable (one-line widening migration) rather than storing a sentinel.

## Scope (files allowed)

- supabase/migrations/20260915000000_protocol_risk_domain_nullable.sql
- src/lib/audit/mockProtocolRisks.ts
- src/lib/audit/mockRiskSummary.ts
- src/lib/audit/intakeApi.ts
- src/lib/audit/riskCandidates.ts
- src/lib/audit/__tests__/riskCandidates.test.ts
- src/components/dashboard/audit/stages/intake/ProtocolRiskTagging.tsx
- src/components/dashboard/audit/stages/intake/RiskTaggingForm.tsx
- src/components/dashboard/audit/stages/intake/RiskCandidatesPanel.tsx
- src/components/dashboard/audit/stages/intake/__tests__/RiskCandidatesPanel.test.tsx
- src/components/dashboard/audit/stages/IntakeWorkspace.tsx
- src/components/dashboard/audit/stages/investigator/IsaRiskAssessmentWorkspace.tsx
- src/components/dashboard/audit/stages/__tests__/IsaRiskAssessmentWorkspace.test.tsx
- src/components/dashboard/audit/AuditWorkspaceShell.tsx
- src/components/dashboard/audit/stages/ScopeReviewWorkspace.tsx
- src/components/dashboard/audit/RiskSummaryPanel.tsx
- plans/sixonelabs-piqc/isa-risk-tagging.md

## Out of scope (files forbidden)

- supabase/migrations/20260914000000_* and every applied migration — append-only; no RPC body changes (the create/update RPCs already pass the domain through, NULL included)
- src/types/audit/** — no type impact: the `protocol_risk_objects` row mirror lives in src/lib/audit (TaggedSection, ProtocolRiskRow) and is updated there
- src/lib/audit/riskSummaryApi.ts — `focusAreasFromRisks` already skips an empty domain
- src/components/dashboard/audit/stages/investigator/IsaStagePlaceholder.tsx, SiteIntakeWorkspace.tsx — untouched; Stage 1 keeps the parse-status card
- src/components/dashboard/audit/StageNav.tsx — off-limits (audit-stage-navigation)
- src/context/** — no store change; the tagging component keeps using the existing protocolRisks store
- supabase/functions/** — audit-deliverable-draft already guards an empty domain
- site scope modules / criticality / ISA stage gating — `isa-site-modules` and the ledger

## Architecture layers touched

- [x] migration (`supabase/migrations/`)
- [ ] RPC (`supabase/functions/` or `.sql`)
- [ ] adapter (`src/lib/*/*Adapter.ts`)
- [ ] context (`src/context/`)
- [x] component (`src/components/`)
- [x] test (`src/**/__tests__/`)

(API layer: src/lib/audit/intakeApi.ts row mirror; pure module:
riskCandidates.ts gains `ISA_CANDIDATE_RULES`.)

## Mock data plan

none

## Approved-by

- @karl-dev-piqc — for src/lib/audit/**, src/components/dashboard/audit/**
- @rv61 — for supabase/migrations/** (owner of this plan)

## Decisions

- **Two-caller extraction.** `ProtocolRiskTagging` (list + form + candidates
  panel + history drawer + optional parse-status card) is lifted out of
  IntakeWorkspace unchanged in behaviour; IntakeWorkspace becomes the vendor
  Stage-1 header around it. The ISA workspace is the second caller — the
  abstraction the chain plan approved for exactly this moment.
- **`workflow` prop, not a flag per field.** RiskTaggingForm hides the
  operational-domain and vendor-dependency sections and drops the domain
  requirement for `INVESTIGATOR_SITE_AUDIT`; RiskCandidatesPanel switches to
  `ISA_CANDIDATE_RULES` (adds `criterion`) and points its no-items copy at
  Stage 1 (Site intake), where the parse-status card lives.
- **Nullable domain, typed as such.** `operational_domain_tag` is vendor-axis
  metadata; a site-tagged risk has none. The migration drops NOT NULL
  (widening only; every existing row and caller unaffected). TaggedSection,
  ProtocolRiskRow and the summary's risk-ref mirror become `string | null`, and
  the three renderers that assumed a string (Intake row chip, Scope review
  chip, Risk summary rail) hide the chip instead of printing an empty one.
  Risks are shared across every audit on the protocol version, so a site-tagged
  risk can appear in a vendor audit's lists — those must not crash on null.
- **No stage-preview gate, and no ISA stage gate — corrected finding.**
  `audit_mode_advance_audit_stage` is fail-closed for ISA stages by design
  (20260719000000: no ISA ordering), and the nav only opens the one-ahead
  stage, so every ISA audit sits at ISA_SITE_INTAKE and Stage 2 is only ever
  reached as the one-ahead view (Conduct and Report, which gate on
  `hasReachedStage`, are FUTURE-locked today — not "working by viewing", as
  the intake heads-up said). Gating Stage 2 on `hasReachedStage` would make it
  inert, so it stays live: what it writes is version-scoped protocol data the
  vendor flow already writes ungated at its own first stage, not audit stage
  state. Recorded in the workspace's header comment. The ISA advance path
  (`isa-stage-advance`: a workflow-aware advance for ISA, Site intake gains
  "Continue to Risk assessment") is the next build, before `isa-site-modules`,
  which is per-audit stage-owned data and needs it.
- **Nothing else moves.** Candidates, provenance, PIQC-assisted accept, the
  fallback before `db push`, History and Lineage all apply unchanged to a site
  audit; `audit_mode_derive_criticality` will score these risks for site
  modules in `isa-site-modules`.

## Verification

Static review only on this machine (no Node): CI's tsc + vitest is the first
execution. Owner walk on the deployed app:

Vendor audit (regression):
- [ ] Stage 1 renders as before: parse-status card, suggestions panel, "Tag a
      section" (now on its own row under the header), tagged list with chips;
      Accept and Save behave exactly as in #615.

Investigator site audit (before `db push` of 20260915000000):
- [ ] Stage 2 "Risk assessment" is a real workspace: header, suggestions
      panel now including "Eligibility criteria", "Tag a section" form without
      Operational domain / Vendor dependency flags, next-stage hint.
- [ ] Save → the create RPC rejects the NULL domain (NOT NULL still applied)
      → the form shows "Couldn't save this section: …" and stays open. Expected
      until the migration is pushed; nothing is written.

After `db push`:
- [ ] Accept a criterion candidate + Save → row listed with tier/surface
      chips and no domain chip; History shows the row; Lineage Stage-1 node
      labels it PIQC-assisted.
- [ ] Manual "Tag a section" on the site audit → saved with no domain.
- [ ] Vendor audit on the same protocol version (if any) → Intake list, Stage 4
      Scope review and the Risk summary rail show the site-tagged risk without
      a domain chip and without errors; "Generate from protocol" focus areas
      ignore it.
- [ ] Tests green in CI: riskCandidates (ISA rules include criterion),
      RiskCandidatesPanel (vendor excludes / ISA includes criteria; ISA
      no-items copy), IsaRiskAssessmentWorkspace (header, no parse card, form
      without vendor fields, save sends a null domain and no flags).
