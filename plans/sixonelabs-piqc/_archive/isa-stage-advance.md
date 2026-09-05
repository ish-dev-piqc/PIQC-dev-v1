---
owner: sixonelabs-piqc
feature: isa-stage-advance
status: merged
merged: 2026-09-05
started: 2026-09-04
target_pr: #621
---

# ISA: stage advancement (Site intake → Risk assessment) and the Stage 2 preview gate

## Context

An investigator site audit cannot leave Site intake. `audit_mode_stage_index`
maps only the eight vendor stages and `audit_mode_advance_audit_stage` fails
closed on any ISA_* value (20260719000000, `STAGE_NOT_IN_ADVANCEMENT_MAP`),
so every ISA audit sits at ISA_SITE_INTAKE; Risk assessment is reachable
only as the nav's one-ahead preview and IsaConduct / IsaReport are
future-locked. Found 2026-09-04 during the `isa-risk-tagging` build, which
shipped Stage 2 deliberately without a preview gate because gating an
unreachable stage would have made it inert.

**Decision:** a separate ISA advance RPC with its own 0..6 index —
`audit_mode_advance_isa_stage` — rather than slotting ISA values into the
vendor index (the fail-closed migration rules that out: a shared index
would make a vendor stage a +1 neighbour of an ISA stage). Same ordering
rule as the vendor RPC (exactly one step forward, backward ungated, same
delta write, same error codes and hints); no content gates yet — the ISA
gate semantics (what must be approved before Prep, Conduct, Export) are
not designed, so every ISA transition is ungated for now and the gate
slots are ledgered below. `auditApi.advanceAuditStage` routes to the ISA
RPC when the target stage belongs to the ISA pipeline, so AuditContext is
untouched. Site intake gets the shared `StageTransitionCard` (its fourth
caller); Risk assessment gets the house preview gate now that it can be
reached.

## Scope (files allowed)

- supabase/migrations/20260916000000_audit_mode_advance_isa_stage.sql
- src/lib/audit/auditApi.ts
- src/lib/audit/__tests__/auditApi.test.ts
- src/components/dashboard/audit/stages/investigator/SiteIntakeWorkspace.tsx
- src/components/dashboard/audit/stages/investigator/IsaRiskAssessmentWorkspace.tsx
- src/components/dashboard/audit/stages/intake/ProtocolRiskTagging.tsx
- src/components/dashboard/audit/stages/__tests__/SiteIntakeWorkspace.test.tsx
- src/components/dashboard/audit/stages/__tests__/IsaRiskAssessmentWorkspace.test.tsx
- plans/sixonelabs-piqc/isa-stage-advance.md

## Out of scope (files forbidden)

- supabase/migrations/20260730000000_audit_export_readiness_gates.sql and every earlier migration — the deployed vendor advance RPC is not CREATE OR REPLACEd; the ISA path is a new function name
- src/context/** — `advanceStage` / `advanceStageError` consumed as-is (2-reviewer gate); routing lives in the API wrapper
- src/components/dashboard/audit/StageNav.tsx, AuditWorkspaceShell.tsx — the shell already snaps `viewedStage` on `current_stage` and dispatches the ISA workspaces; nothing to change
- src/components/dashboard/audit/stages/StageTransitionCard.tsx — reused unchanged
- src/components/dashboard/audit/stages/IntakeWorkspace.tsx — the new `readOnly` prop is optional so the vendor caller is untouched (index 0 can never be a preview)
- src/components/dashboard/audit/stages/investigator/IsaConductWorkspace.tsx, IsaReportWorkspace.tsx, IsaStagePlaceholder.tsx — their `hasReachedStage` gates start working as-is once the audit can move
- src/components/dashboard/audit/stages/intake/RiskCandidatesPanel.tsx, RiskTaggingForm.tsx — the panel's existing `disabled` prop carries the read-only state
- src/types/** — no schema change (functions only)

## Architecture layers touched

- [x] migration (`supabase/migrations/`)
- [x] RPC (`supabase/functions/` or `.sql`)
- [ ] adapter (`src/lib/*/*Adapter.ts`)
- [ ] context (`src/context/`)
- [x] component (`src/components/`)
- [x] test (`src/**/__tests__/`)

## Mock data plan

none

## Approved-by

- @karl-dev-piqc — for src/lib/audit/** and src/components/dashboard/audit/**
- @rv61 (self) — supabase/migrations/

## Decisions

- **New RPC, new index, no CREATE OR REPLACE.** `audit_mode_advance_isa_stage`
  and `audit_mode_isa_stage_index` are new names; the deployed vendor RPC
  (20260730000000 body) and `audit_mode_stage_index` stay byte-identical, so
  there is no drift window for vendor audits and no PostgREST overload.
- **SECURITY DEFINER is required, not a choice.** 20260721000100 revoked
  UPDATE on `audits.current_stage` from authenticated; only a DEFINER
  function can write it. The lead-auditor check is therefore explicit in
  the body (same `P0002 Audit not found` as the vendor RPC — no existence
  leak), and the workflow check rejects a vendor audit with
  `22023` / `WORKFLOW_NOT_ISA` so the two pipelines can never cross.
- **No content gates yet.** Every ISA transition is ungated (exactly one
  step forward, backward free). The gate slots — what must hold before
  ISA_PREP, ISA_CONDUCT, ISA_EXPORT — are the ledger entry below, not a
  guess baked into SQL. The vendor Stage-4 gate model (approval latches on
  the objects the stage produces) is the template when they are designed.
- **Route by target stage in the wrapper.** `advanceAuditStage(auditId,
  toStage)` picks the RPC by `stagesForWorkflow('INVESTIGATOR_SITE_AUDIT')
  .includes(toStage)`. The two pipelines share no stage value, so this is
  deterministic; a mismatched pair fails closed on the server either way
  (vendor RPC: unmapped stage; ISA RPC: wrong workflow). The context keeps
  calling one function.
- **Before `db push`** the Site intake button fails honestly: PostgREST
  returns PGRST202 (function not found), which the card shows in its inline
  alert. Nothing else regresses; the vendor path is unaffected.
- **Stage 2 becomes gated.** `hasReachedStage` + StagePreviewNotice on
  IsaRiskAssessmentWorkspace, and a `readOnly` prop on ProtocolRiskTagging
  (no Tag button, Accept disabled, no Edit/Delete; History stays; empty-state
  copy drops the Tag-a-section pointer). The prop is optional and defaults to
  false because the vendor caller (Intake, index 0) can never be a preview.
  Tagged risks remain visible in the preview — they are version-scoped
  protocol data, not audit stage state.
- **Only Site intake gets a card this PR.** Stage 2 → 3 lands with the
  Scope-builder build (isa-site-modules), which gives Stage 3 content to
  advance into; advancing into a placeholder today would be an empty click.
  Stage 2 keeps its next-stage hint.
- **B6 stays deferred.** `audit_mode_get_stage_readout` still reports
  position NULL / total 8 for ISA audits; it has no frontend caller and the
  ISA card is not readout-driven.

## Decision-debt ledger

- **ISA gate semantics** (which approvals hold ISA_PREP / ISA_CONDUCT /
  ISA_EXPORT closed). Trigger: the first ISA audit that reaches Conduct
  without a scope, or the Scope-builder build defining what "scope
  approved" means.
- **ISA readout** (B6). Trigger: an ISA stage card that wants blocked
  reasons from the server.
- **`advanceStageError` is audit-wide** (same parity as the vendor cards).
  Trigger: first confused report.
- **Stage 2 → 3 transition card.** Trigger: isa-site-modules.

## Verification

Static review only on this machine (no Node): CI's tsc + vitest is the
first execution; `db push` is the first execution of the SQL.

Before `db push` (frontend live on merge):
- [ ] ISA audit at Site intake: the page ends with "Stage transition · Ready
      to advance" and an enabled "Advance to Risk assessment". Click → the
      inline alert reads "Couldn't advance the stage: … audit_mode_advance_isa_stage …"
      (PGRST202) — honest, not silent. Stage 2 (one-ahead preview) shows the
      amber preview banner, no "Tag a section", Accept buttons disabled, tagged
      rows without Edit/Delete.
- [ ] Vendor audit: Stages 1–3 still advance exactly as before (#619).

After `db push`:
- [ ] Site intake → Advance to Risk assessment → the view snaps to Stage 2,
      the nav marks it current, the banner is gone, tagging works; the Audit
      history drawer shows the AUDIT delta (from ISA_SITE_INTAKE to
      ISA_RISK_ASSESSMENT). Step back to Site intake → "Audit has already
      advanced past this stage · Current stage: Risk assessment", disabled.
- [ ] Nav now opens Scope builder as the one-ahead preview (placeholder).
- [ ] Read-only probe with the public key: `audit_mode_advance_isa_stage` →
      42501 (exists, anon revoked); vendor RPC unchanged.
- [ ] SQL editor as the lead auditor: calling the ISA RPC on a vendor audit →
      `WORKFLOW_NOT_ISA`; a +2 jump → "exactly one stage"; backward → allowed.
- [ ] Tests green in CI: auditApi (routing + reason + error shape),
      SiteIntakeWorkspace (card mounted, advances to ISA_RISK_ASSESSMENT,
      already-advanced), IsaRiskAssessmentWorkspace (existing flow at the
      reached stage; preview gate at Site intake).
