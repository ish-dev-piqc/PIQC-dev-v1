---
owner: sixonelabs-piqc
feature: isa-scope-builder
status: active
started: 2026-09-05
target_pr:
---

# ISA: Scope builder (modules → criticality rollup → traceable scope)

## Context

Stage 3 of a site audit (`ISA_SCOPE_BUILDER`) is still `IsaStagePlaceholder`.
Stage 2 now records which site audit modules each tagged protocol risk lands
in, with a server-derived criticality per mapping (isa-site-modules #623).
This PR turns those mappings into the risk-based audit scope the
two-workflow architecture doc calls for ("risk → modules → traceable
checklist items"): one module per mapped `isa_domain`, its criticality the
maximum over its mappings, and one scope item per mapping that names the
protocol risk, the module, the criticality and the rationale it came from.
The scope is a deliverable — built deterministically from the mappings (no
model call), saved as a `DRAFT`, approved through the house latch.

**Decision:** the scope is the 8th kind on the generic deliverable pair
(`audit_mode_upsert_deliverable` / `audit_mode_approve_deliverable`,
20260906000100 + 20260907000100). No new RPCs: the kind whitelist gains a
`site_scope` arm and the delta viewer gains the tracked type. The kind
declares no server-side basis pin (`o_basis NULL`): approving pins the
scope row's own version (updated_at CAS) exactly as the letter, agenda and
checklist kinds do; the mapping set the scope was built from is recorded in
the content (`built_from.mapping_ids`) and the workspace shows drift against
the live mappings client-side. A server pin on the mapping set is the
stricter form and is ledgered (it needs a third basis token in the generic
approve).

## Scope (files allowed)

- supabase/migrations/20260918000000_audit_mode_site_scope_schema.sql
- supabase/migrations/20260918000100_audit_mode_site_scope_rpcs.sql
- src/types/audit/enums.ts
- src/types/audit/objects.ts
- src/lib/audit/siteScope.ts
- src/lib/audit/siteScopeApi.ts
- src/lib/audit/__tests__/siteScope.test.ts
- src/lib/audit/__tests__/siteScopeApi.test.ts
- src/components/dashboard/audit/stages/investigator/IsaScopeBuilderWorkspace.tsx
- src/components/dashboard/audit/stages/investigator/CriticalityChip.tsx
- src/components/dashboard/audit/stages/investigator/SiteModuleMappingPanel.tsx
- src/components/dashboard/audit/stages/investigator/IsaRiskAssessmentWorkspace.tsx
- src/components/dashboard/audit/AuditWorkspaceShell.tsx
- src/components/dashboard/audit/stages/__tests__/IsaScopeBuilderWorkspace.test.tsx
- src/components/dashboard/audit/stages/__tests__/IsaRiskAssessmentWorkspace.test.tsx
- plans/sixonelabs-piqc/isa-scope-builder.md

## Out of scope (files forbidden)

- src/context/** — the workspace keeps local state and reads tagged risks from the existing `protocolRisks` store (RiskSummaryPanel precedent); no new AuditDataContext slice (2-reviewer gate)
- src/components/dashboard/audit/StageNav.tsx — nav untouched (audit-stage-navigation.md)
- src/components/dashboard/audit/stages/investigator/IsaStagePlaceholder.tsx — still renders ISA_PREP / ISA_EXPORT
- src/components/dashboard/audit/stages/investigator/SiteIntakeWorkspace.tsx, IsaConductWorkspace.tsx, IsaReportWorkspace.tsx — no change
- src/components/dashboard/audit/stages/vendor-enrichment/** — the vendor lane's own CriticalityChip copy stays; consolidation is ledgered
- src/components/dashboard/audit/deliverables/** — useDeliverablePersistence / useDeliverableResync / StatusBadge are consumed, not changed
- src/lib/audit/siteModulesApi.ts, intakeApi.ts, preAuditApi.ts — consumed, not changed
- supabase/migrations/20260906000100_*, 20260907000100_*, 20260917000100_* and every earlier migration — the generic pair, the kind config and the delta viewer are CREATE OR REPLACEd in the NEW file with every earlier arm verbatim; nothing older is edited
- supabase/functions/** — no edge function, no model call

## Architecture layers touched

- [x] migration (`supabase/migrations/`)
- [x] RPC (`supabase/functions/` or `.sql`) — kind-config arm + delta-viewer branch, no new function
- [ ] adapter (`src/lib/*/*Adapter.ts`)
- [ ] context (`src/context/`)
- [x] component (`src/components/`)
- [x] test (`src/**/__tests__/`)

Types (`src/types/audit/`) are in the diff: the tracked object type and the
scope content shape — the schema → type mirror is satisfied by the change.

## Mock data plan

none

## Approved-by

- @karl-dev-piqc — for src/lib/audit/**, src/types/audit/**, src/components/dashboard/audit/** (including the one-line AuditWorkspaceShell dispatch entry, precedented by isa-risk-tagging)
- @rv61 (self) — supabase/migrations/

## Decisions

- **Two migrations, house split.** The schema file adds the
  `SITE_SCOPE_OBJECT` tracked type and `site_scope_objects` (one row per
  audit: content JSONB + the standard approval columns; no basis_digest, no
  generation columns — nothing generates it and the kind has no basis pin).
  The RPC file CREATE OR REPLACEs `audit_mode_can_view_tracked_object`
  (branch added, every earlier branch verbatim from 20260917000100) and
  `audit_mode_deliverable_kind_config` (8th arm, every earlier arm verbatim
  from 20260907000100). Both contracts unchanged; grants preserved by
  CREATE OR REPLACE.
- **Deterministic build, client-side.** `buildSiteScopeContent(mappings,
  risks, now)` is pure: modules ordered by rollup criticality then by the
  `isa_domain` declaration order; items by criticality, then section
  identifier, then mapping id. Every item carries the mapping id (its
  provenance), the protocol risk id, the module, the section reference, the
  mapping's server-derived criticality and rationale. Same inputs → same
  content (except `built_at`).
- **Rebuild always demotes.** `built_at` is part of the content, so every
  rebuild is a content change → the generic upsert demotes an approved scope
  to DRAFT. Said out loud on the button. The alternative (silent no-op
  rebuild) would hide that the auditor re-derived the scope.
- **Drift is by mapping set.** `scopeDrift(content, mappings)` counts
  mapping ids added / removed since `built_from`. Edits to a risk's title
  or tier after the build are NOT detected (the mapping row's own
  criticality is also derived at create time — pre-existing in both lanes).
  Ledgered.
- **All-or-nothing risk coverage.** The workspace reads tagged risks from
  the `protocolRisks` store, falling back to `fetchProtocolRisksForAudit`
  (RiskSummaryPanel precedent). A mapping whose risk is not in the loaded
  list is a load failure with Retry, never a partial scope: the create RPC
  guarantees mapped risks are on the audit's protocol version, so a full
  read covers every mapping unless the read failed.
- **Persistence through `useDeliverablePersistence`** with a one-key local
  bundle (AuditCertificateSection precedent): optimistic row, revert on a
  failed upsert, STALE_CONTENT reload + notice, approve error banner. The
  workspace renders its own save-failure copy (the hook's string speaks of a
  preserved editor; the scope has none — Build again is the retry).
- **Preview** (`!hasReachedStage`): StagePreviewNotice, existing scope shown
  read-only, no Build / Rebuild / Approve.
- **No Stage 3 → Prep card here.** Audit prep is still a placeholder, so
  advancing into it would be an empty click. Follow-up
  `isa-placeholder-advance` lets placeholder stages offer the ungated
  advance so Conduct and Report become reachable.
- **CriticalityChip extracted** from SiteModuleMappingPanel to its own file
  (two ISA callers now). The vendor lane's ServiceMappingTable keeps its
  own copy — consolidating it is unrelated refactor; ledgered.
- **Nothing works before db push.** Either table missing (PGRST205 /
  42P01) → "Scope builder isn't available in this environment yet." and no
  actions. Vendor audits untouched.

## Decision-debt ledger

- **Server-side mapping-set pin** (`o_basis = 'MAPPING_SET'`, a digest over
  `site_module_mapping_objects` for the audit, third basis token in
  `audit_mode_approve_deliverable`). Trigger: the first audit where the
  scope was approved and a mapping changed before Prep read it.
- **Risk-edit drift** (title / tier changed after build; mapping
  criticality not re-derived). Trigger: first report; fix is a digest over
  risk attributes in `built_from`.
- **Per-item editing / free-text items** (auditor-authored checklist
  lines). Trigger: first auditor asking to add a check no mapping implies.
- **ISA_PREP gate "scope approved".** Trigger: ISA_PREP workspace intake.
- **Checklist export** (the scope as a document). Trigger: ISA_EXPORT
  intake.
- **CriticalityChip ×3** (vendor ServiceMappingTable copy). Trigger: next
  ServiceMappingTable touch.
- **History drawer** opens on the scope row (deltas written by the generic
  upsert/approve); mapping-row history still has no UI (isa-site-modules
  ledger).

## Verification

Static review only on this machine (no Node): CI's tsc + vitest is the
first execution; `db push` is the first execution of the SQL.

Before `db push` (frontend live on merge):
- [ ] ISA audit, Stage 3 (at stage or preview): the workspace reads "Scope
      builder isn't available in this environment yet." — no Build, no
      error. Stage 2 shows the "Advance to Scope builder" card. Vendor
      audits unchanged.

After `db push`:
- [ ] ISA audit at Risk assessment with two tagged sections and three
      mappings (two modules): click "Advance to Scope builder" → Stage 3
      opens live. "No scope built yet" + Build scope → modules appear
      ordered by criticality with a rollup chip, each item shows section,
      title, criticality and rationale; summary reads "2 modules · 3 scope
      items · built {date}". Status: Draft.
- [ ] Approve scope → Approved + name + date. History drawer shows the
      create delta and the approve delta (SITE_SCOPE_OBJECT).
- [ ] Back to Stage 2, add a mapping → Stage 3 shows the drift notice
      ("1 mapping added…") with Rebuild; Rebuild → 4 items, status Draft
      again (demoted). Approve again.
- [ ] Two tabs: approve in one after rebuilding in the other → the stale
      notice, latest version shown.
- [ ] Step back to Risk assessment and preview Stage 3 → notice, scope
      visible, no buttons.
- [ ] Read-only probe with the public key: `site_scope_objects` SELECT →
      empty; `audit_mode_deliverable_kind_config('site_scope')` → 42501.
- [ ] SQL editor as the lead auditor: `audit_mode_approve_deliverable
      ('site_scope', id, null, updated_at, 'x')` → 22023 (no basis for this
      kind); without the digest → approved.
- [ ] Tests green in CI: siteScope (rollup, ordering, provenance, drift),
      siteScopeApi (fetch outcomes, upsert / approve payloads without a
      basis digest), IsaScopeBuilderWorkspace (states, build, approve,
      drift, preview, save failure), IsaRiskAssessmentWorkspace (card).
