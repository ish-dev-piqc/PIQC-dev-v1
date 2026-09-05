---
owner: sixonelabs-piqc
feature: isa-site-modules
status: merged
merged: 2026-09-05
started: 2026-09-05
target_pr: #623
---

# ISA: site module mapping on Risk assessment (risk → module → derived criticality)

## Context

Stage 2 of a site audit tags protocol risks (isa-risk-tagging) and can now
be reached (isa-stage-advance), but nothing records which site audit
modules those risks land in. The vendor lane has this layer — Stage 2 maps
each risk to the vendor service with a criticality derived by
`audit_mode_derive_criticality` — and Stage 4 / the drafters consume it. The
ISA Scope builder (PR-7) needs the same input: modules with the risks
behind them, so it can roll criticality up per module and emit a
traceable checklist. This PR is that layer, nothing more.

**Decision:** the module vocabulary is the existing 15-value `isa_domain`
enum (`IsaDomain` / `ISA_DOMAIN_LABELS`), not the 8-item list the foundation
plan sketched — findings and notes already tag on it, so a risk mapped to
"Informed consent" and a finding under "Informed consent" line up without a
crosswalk. A new table `site_module_mapping_objects` (audit, risk, module;
unique per triple) mirrors `vendor_service_mapping_objects` but keys on the
audit directly (a site audit has no service object). Criticality and the
default rationale come from the same immutable SQL functions the vendor
lane uses, so a risk scores identically in both workflows.

## Scope (files allowed)

- supabase/migrations/20260917000000_audit_mode_site_module_mapping_schema.sql
- supabase/migrations/20260917000100_audit_mode_site_module_mapping_rpcs.sql
- src/types/audit/enums.ts
- src/types/audit/objects.ts
- src/lib/audit/siteModulesApi.ts
- src/lib/audit/__tests__/siteModulesApi.test.ts
- src/components/dashboard/audit/stages/investigator/SiteModuleMappingPanel.tsx
- src/components/dashboard/audit/stages/investigator/IsaRiskAssessmentWorkspace.tsx
- src/components/dashboard/audit/stages/__tests__/SiteModuleMappingPanel.test.tsx
- src/components/dashboard/audit/stages/__tests__/IsaRiskAssessmentWorkspace.test.tsx
- plans/sixonelabs-piqc/isa-site-modules.md

## Out of scope (files forbidden)

- src/context/** — the panel keeps local state (IsaConductWorkspace precedent) and reads tagged risks from the existing `protocolRisks` store; no new AuditDataContext slice (2-reviewer gate)
- src/components/dashboard/audit/stages/intake/** — the tagging flow is untouched; the panel sits beside it
- src/components/dashboard/audit/stages/vendor-enrichment/** — the vendor mapping table is not generalised; the two lanes differ in shape (service object vs. module enum)
- src/lib/audit/vendorEnrichmentApi.ts, lineageAdapter.ts — vendor mapping untouched; ISA lineage is ledgered
- src/components/dashboard/audit/AuditWorkspaceShell.tsx, StageNav.tsx — no shell change; ISA_SCOPE_BUILDER stays the placeholder until PR-7
- supabase/migrations/20260430140000_* and every earlier migration — `audit_mode_derive_criticality` / `audit_mode_build_default_rationale` are reused, never re-created
- src/lib/audit/labels.ts — `ISA_DOMAIN_LABELS` and `DERIVED_CRITICALITY_LABELS` already exist

## Architecture layers touched

- [x] migration (`supabase/migrations/`)
- [x] RPC (`supabase/functions/` or `.sql`)
- [ ] adapter (`src/lib/*/*Adapter.ts`)
- [ ] context (`src/context/`)
- [x] component (`src/components/`)
- [x] test (`src/**/__tests__/`)

Types (`src/types/audit/`) are in the diff: the mapping row and the new
tracked object type — the schema → type mirror is satisfied by the change.

## Mock data plan

none

## Approved-by

- @karl-dev-piqc — for src/lib/audit/**, src/types/audit/**, src/components/dashboard/audit/**
- @rv61 (self) — supabase/migrations/

## Decisions

- **Two migrations, house split.** The schema file adds the
  `SITE_MODULE_MAPPING_OBJECT` tracked type, the table, its RLS and index;
  the RPC file CREATE OR REPLACEs `audit_mode_can_view_tracked_object` with
  the new branch (the state_history_deltas INSERT policy runs it, so the
  branch must exist before the first create) and adds the two RPCs. Same
  shape as 20260724000000 / 20260724000100.
- **Create + delete only.** The vendor lane also has an update RPC for an
  auditor criticality override. It ships here with no caller, so it is not
  built; the derived tier is the record. Ledgered.
- **Guards the vendor RPC does not have.** The create RPC rejects a
  non-ISA audit (22023 / WORKFLOW_NOT_ISA) and a risk whose
  `protocol_version_id` differs from the audit's (22023 /
  RISK_NOT_ON_AUDIT_PROTOCOL). Both are integrity, not authorisation —
  SECURITY INVOKER + RLS on the table and on `audits` does the
  authorisation, exactly as the vendor mapping RPCs.
- **Rationale always derived, NOT NULL.** No override parameter (no
  consumer). `audit_mode_build_default_rationale` fills it every time.
- **Risk delete stays RESTRICT.** As the vendor FK: a risk with mappings
  cannot be deleted; the tagging flow's delete then fails silently
  (`deleteProtocolRisk` → false, no message) — pre-existing for mapped
  vendor risks, ledgered.
- **Panel state is local**, loaded per audit with a cancel latch; tagged
  risks come from the shared `protocolRisks` store the tagging flow fills,
  so a section tagged above is mappable at once. Not-applied detection: a
  missing table reads as PGRST205 (or 42P01) → `{ available: false }` → the
  panel says so and offers nothing, mirroring protocolReadinessApi.
- **Preview**: `readOnly` hides the module picker and the remove buttons;
  mappings stay visible.
- **Rollup lives in PR-7.** The panel's summary line counts mappings and
  modules; "highest criticality per module" and the checklist are the
  Scope builder's.

## Decision-debt ledger

- **Criticality override** (update RPC + UI, vendor precedent). Trigger:
  the first auditor who disagrees with a derived tier.
- **Silent delete failure on a mapped risk** (ProtocolRiskTagging
  onDelete ignores `false`). Trigger: first report; fix is an AUD-301 alert
  in the tagging flow.
- **ISA lineage** (lineageAdapter has no site-module nodes). Trigger: the
  Lineage view opened on an ISA audit with mappings.
- **History drawer on mapping rows** (deltas are written; no UI opens
  them). Trigger: an auditor asking who mapped what.

## Verification

Static review only on this machine (no Node): CI's tsc + vitest is the
first execution; `db push` is the first execution of the SQL.

Before `db push` (frontend live on merge):
- [ ] ISA audit, Stage 2 (at stage or preview): the "Site modules" card
      reads "Site modules aren't available in this environment yet." — no
      picker, no error. Vendor audits unchanged.

After `db push`:
- [ ] ISA audit advanced to Risk assessment with two tagged sections: each
      section shows "Not mapped to a module yet." and an "Add module…"
      picker listing the 15 domains. Pick "Informed consent" → the row shows
      the module, a criticality chip matching the section's tier/surface
      (e.g. PRIMARY + DATA_INTEGRITY → the same tier the vendor lane
      derives), and the "Derived from: …" rationale; the picker no longer
      offers that module. Summary reads "1 mapping across 1 module".
- [ ] Map a second module on the same section and one on the other
      section → "3 mappings across N modules". Remove one → gone; the
      picker offers it again.
- [ ] Reload → mappings persist. Audit history (state_history_deltas) has a
      SITE_MODULE_MAPPING_OBJECT delta per create and per delete.
- [ ] Step back to Site intake, preview Stage 2 → mappings visible, no
      picker, no remove buttons.
- [ ] Read-only probe with the public key: `site_module_mapping_objects`
      SELECT → empty (RLS, no anon policy); both RPCs → 42501.
- [ ] SQL editor as the lead auditor: create on a vendor audit →
      WORKFLOW_NOT_ISA; create with a risk from another protocol version →
      RISK_NOT_ON_AUDIT_PROTOCOL; duplicate triple → unique violation.
- [ ] Tests green in CI: siteModulesApi (query shape, PGRST205 →
      available:false, create/delete call shapes, error shape),
      SiteModuleMappingPanel (loading / unavailable / error+Retry / empty /
      list, add, remove, readOnly, save error), IsaRiskAssessmentWorkspace
      (panel mounted at stage and in preview).
