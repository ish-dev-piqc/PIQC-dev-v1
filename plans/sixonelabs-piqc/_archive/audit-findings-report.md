---
status: merged
merged: 2026-09-01
owner: sixonelabs-piqc
feature: Findings Report (PR-D4) — 6th deliverable kind; third engine shape; Stage-7 surface; generic deliverable RPC pair
target_pr: #583
---

# Findings Report (PR-D4)

## Context

Nine-deliverables queue (handover v3): D1 #561, D3 #567 merged (D2 held for
the migrations partner). D4 is the **Findings Report**: the formal narrative
document that packages the Stage-6 observation blocks for hand-off — distinct
from Stage 7's working `report_draft_objects` (exec summary + conclusions,
which gates Stage 8 and stays untouched). 6th `DeliverableKind` in the
consolidated engine, rendered as a section of Stage-7 ReportDraftingWorkspace.
**Non-gating**: the Stage 7→8 gate remains the report-readiness checker.

This is the PR the whole pre-D4 hardening train (#571/#573/#575/#577/#579/#581)
was run for: the surface instantiates the extracted workbench
(DeliverableGenerationPanel + useDeliverablePersistence + useDeliverableGeneration
+ useDeliverableResync + buildObservationGroups) instead of being the 7th
copy-paste.

**Mental model.** Workflow stage: report drafting (stage 7). Operator: lead
auditor. Source of truth: observation blocks stay in
`audit_workspace_entry_objects` — the report row stores ONLY the connective
narrative; blocks derive live via `buildObservationGroups`. No second copy of
observation content, ever. Failure mode if wrong: the report latches narrative
against one entry set while the document renders another — closed by the
basis pin (below). Human review point: the section's Approve latch. Smallest
safe path: two narrative fields, blocks injected by code, no export wiring yet.

## Binding decisions (D4 decision record, approved pre-train)

1. **Third engine `shape: 'report'`, not letter-fit.** Observation blocks are
   injected verbatim by code — never round-tripped through the model. The
   model drafts ONLY connective narrative (`intro_text`, `closing_text`).
   Prompt contract: may state how many observations the report contains and
   which vendor domains they touch; must never restate observation text,
   assign/count classifications or impacts, or use severity language.
2. **`[Classification: to be determined by QA]` placeholder** is a code-owned
   template line rendered with each observation block: PIQC classifications
   are provisional; final classification is a QA determination outside PIQC
   (in-PIQC approval is a readiness latch, never a GxP attestation). The
   placeholder is injected at document assembly, never model-generated.
3. **Version-pinned acceptance CAS'd on the entry-set digest.** Because blocks
   derive live, approving must pin WHICH entry set was reviewed. New
   `audit_mode_entry_set_digest(p_audit_id)` extracts the digest expression
   `audit_mode_report_readiness_fingerprint` (20260730000000:55-87) already
   computes — that function is CREATE-OR-REPLACEd to delegate to it,
   **byte-identical digest** (existing sealed fingerprints must keep
   verifying). Approve takes `p_expected_basis_digest`, recomputes live,
   rejects with HINT `STALE_BASIS` on mismatch, and seals the digest into
   `findings_report_objects.basis_digest`. Post-approval divergence renders an
   honest banner (live digest ≠ sealed digest). Demote-on-edit clears the seal.
4. **D4's migration carries the generic deliverable upsert/approve RPC pair**
   (`audit_mode_upsert_deliverable` / `audit_mode_approve_deliverable`,
   kind→table dispatch over a 6-kind whitelist, returns jsonb) — the D3
   ledger's "trigger: the 6th kind". findings_report is the first caller; the
   five existing kinds keep their RPCs and clients (migrating them is the
   partner's-return rework, not this diff). Apply stays per-kind
   (`audit_mode_apply_findings_report_generation`) so the client's APPLY_RPC
   record stays uniform; it routes content through the generic upsert.
5. **The two engine refactors land here**: `buildUserMessage`'s 9 positional
   params (D4 would be the 10th) become one context object; the currency
   computation gains an entries axis in the established per-axis-gated idiom
   (snapshot field present + live value passed ⇒ axis measured). A
   table-driven axis-registry rewrite is deliberately NOT done: the existing
   currency tests pass unchanged as the behavior proof, same standard as PR-6.
6. **Row type `FindingsReport` in `src/lib/audit/findingsReport.ts`** — first
   real-named deliverable per the PR-3 type ruling (no Mock* prefix; the
   Stage-5 bundle and preAuditApi are untouched except exporting
   `resolveApprovedByName` for reuse instead of a 6th private copy).

## Mechanism

- **Schema** (20260906000000): enum value `FINDINGS_REPORT_OBJECT` (own file —
  same-transaction hazard, 20260707000200 precedent); `findings_report_objects`
  cloning the D3 table (audit_id UNIQUE, jsonb content, DRAFT/APPROVED latch,
  generation trio inline) + `basis_digest TEXT`; touch trigger; via-audit RLS.
- **RPCs** (20260906000100): digest helper + fingerprint delegation;
  `audit_mode_can_view_tracked_object` full replacement adding the
  FINDINGS_REPORT_OBJECT ELSIF (D1/D3 precedent — every existing branch kept);
  generic upsert (demote-on-edit + approved_at/by in the demote diff + clears
  basis_digest on content change for the kind that has one; deltas via
  audit_mode_write_delta under the kind's tracked type); generic approve
  (updated_at CAS + basis CAS where the kind declares a basis; hints
  MISSING_EXPECTED_VERSION / STALE_CONTENT / MISSING_EXPECTED_BASIS /
  STALE_BASIS); per-kind apply; grants.
- **Engine**: `normalizeRegister` moves to `_shared/evidenceRegister.ts`
  (parked PR-P absorbed as the engine slice's first commit — first engine
  unit test via the proven Vitest-imports-Deno pattern);
  DELIVERABLES gains `findings_report` (`shape:'report'`,
  `blobRefId:'findings_report'`, `revisionHeading:'CURRENT NARRATIVE'`);
  report-kind context loader reads `audit_workspace_entry_objects` (JWT/RLS),
  fails closed 503 when unreadable (an unreadable entry set is not an empty
  one — and the register read fails closed for this kind too, or a snapshot
  recording evidence:[] off a read error would flag permanent false drift).
  The model receives ONLY provisional counts + vendor domains — observation
  TEXT never enters the prompt at all, making no-restatement mechanical
  rather than prompted (stronger than the planned blocks listing; no label
  maps needed engine-side). Output arm caps intro/closing, 502s on empty
  narrative, gates blob-level refs. Snapshot gains optional `entries` (the
  digest's exact tuple fields) — the currency axis's basis.
- **Client**: `findingsReport.ts` (row type, fetch with absence≠failure shape,
  entry-digest fetch, upsert/approve wrappers over the generic RPCs returning
  the workbench-hook-compatible shapes); `deliverableGenerationApi` gains the
  kind, the third KIND_SHAPE value, the report apply arm, and the currency
  entries axis (`entriesChanged`, gated on snapshot.entries + liveEntries);
  `useDeliverablePersistence` reload branch accepts STALE_BASIS with
  basis-specific notice copy (STALE_CONTENT path byte-identical);
  DeliverableGenerationPanel gains optional `liveEntries` + an
  observations-drift line; new `FindingsReportSection.tsx` under `stages/`
  (mounted `key={auditId}` from ReportDraftingWorkspace, in BOTH the main
  render and the no-working-report empty state — this deliverable must not
  be unreachable behind the stub CTA): honest load (failure banner + retry,
  no scratch form), narrative editors, code-injected blocks preview with the
  QA placeholder line, generation panel, approve latch requiring a held
  digest, divergence banner, HistoryDrawer. **The section fetches its own
  entries in the same read moment as the digest** (adversarial-review
  finding: the Stage-6 context cache is only populated when Stage 6 mounts,
  so rendering blocks from it against a fresh digest could seal a pin over
  blocks the reviewer never saw). Approve additionally refuses on the one
  client-detectable basis inconsistency: rendered-blocks emptiness vs the
  known empty-set digest (md5 of ''). Lineage: node + DELIVERABLES filter
  membership + fetch composition.

## Scope (files allowed)

- supabase/migrations/20260906000000_audit_findings_report_schema.sql (new)
- supabase/migrations/20260906000100_audit_findings_report_rpcs.sql (new)
- supabase/functions/_shared/evidenceRegister.ts (new)
- supabase/functions/_shared/__tests__/evidenceRegister.test.ts (new)
- supabase/functions/audit-deliverable-draft/index.ts
- supabase/functions/audit-deliverable-draft/prompts.ts
- src/types/audit/enums.ts
- src/types/audit/objects.ts
- src/lib/audit/findingsReport.ts (new)
- src/lib/audit/preAuditApi.ts (export resolveApprovedByName helper only)
- src/lib/audit/deliverableGenerationApi.ts
- src/lib/audit/lineageAdapter.ts
- src/lib/audit/lineageApi.ts
- src/components/dashboard/audit/TraceabilityDrawer.tsx
- src/components/dashboard/audit/deliverables/useDeliverablePersistence.ts
- src/components/dashboard/audit/deliverables/DeliverableGenerationPanel.tsx
- src/components/dashboard/audit/stages/FindingsReportSection.tsx (new)
- src/components/dashboard/audit/stages/ReportDraftingWorkspace.tsx (mount only)
- src/lib/audit/__tests__/findingsReport.test.ts (new)
- src/lib/audit/__tests__/deliverableGenerationApi.test.ts (extend)
- src/lib/audit/__tests__/lineageAdapter.test.ts (extend)
- src/lib/audit/__tests__/lineageApi.test.ts (extend)
- src/components/dashboard/audit/stages/__tests__/FindingsReportSection.test.tsx (new)
- src/components/dashboard/audit/stages/__tests__/ReportDraftingWorkspace.test.tsx (mock the new section)
- plans/sixonelabs-piqc/audit-findings-report.md (this file)

## Out of scope (files forbidden)

- `report_draft_objects` and everything about the Stage-7 working report
  (exec summary / conclusions / readiness gates / advance RPCs) — the
  findings report never gates
- Stage-8 FinalReviewExportWorkspace: no export rendering and no currency-
  panel row for this kind yet (ledger item below)
- PreAuditDraftingWorkspace + its tests; mockPreAudit.ts; the Stage-5 bundle
- Migrating the five existing kinds' clients/RPCs onto the generic pair
- Editing any merged migration; src/context/**; other modes

## Architecture layers touched

- [x] migration (additive; the only CREATE OR REPLACEs are
  `audit_mode_can_view_tracked_object` (+1 ELSIF, D1/D3 precedent) and
  `audit_mode_report_readiness_fingerprint` (delegation, byte-identical
  digest))
- [x] RPC (edge function + .sql)
- [ ] adapter  [ ] context
- [x] component  [x] test

## Mock data plan

None. Test fixtures in __tests__/ only.

## Approved-by

- @karl-dev-piqc — src/lib/audit/**, src/components/dashboard/audit/**, src/types/audit/**
- @rv61 (self) — supabase/**

## Decision debt ledger

- **Stage-8 wiring deferred**: markdown/docx export of the findings report and
  its row in the Stage-8 currency panel. Trigger: first user request to export
  it (the export moment is the revenue moment — expected soon after D4 ships).
  The block template (incl. the QA placeholder) should be extracted from the
  section preview to a pure builder at that moment.
- **Narrative granularity**: intro + closing only. Per-group connective
  lead-ins rejected for v1 (more model surface, no reviewer demand yet).
  Trigger: auditor feedback asking for per-section narrative.
- **Zero-classified-entries generation allowed**: the engine drafts an honest
  "no classified observations yet" narrative rather than refusing. Trigger for
  revisit: users generating premature reports in practice.
- **Cross-mount draft-stash gap (accepted)**: the persistence hook lives
  inside the section (remounted per audit), so a failed save's preserved
  draft survives everything within a mount but NOT an audit/stage switch —
  Stage 5 has the same limitation on stage nav (its hook dies with the
  workspace). Hoisting the hook would restructure the mount for a rare path.
  Trigger: a second Stage-7 deliverable, or a user report of a lost draft.
- **Direct-PATCH latch forging (parity, partner memo)**: FOR ALL RLS +
  default table grants let the owner PATCH approval_status/basis_digest/
  generation_refs trail-free on all six deliverable tables — 20260903000000
  gave `audits` the column-revoke treatment for exactly this class; the
  deliverable tables should get it in the partner's-return migration.
- **Engine honesty behaviors pinned by comments only**: the 503 fail-closed
  reads and 502 empty-narrative guard have no engine-side unit test (only
  normalizeRegister has a seam). Trigger: next engine-touching PR extracts
  the next seam. Same note for the generation panel's drift-blame copy
  (panel has no test dir; pre-existing gap).
- **Prod deploy debt grows to 6 unapplied migrations** (D1 pair, D3 pair, D4
  pair) + the `audit-deliverable-draft` redeploy. Until applied, the Stage-7
  section is honest-degraded: load shows the failure banner + retry, saves
  banner + preserve, approve blocked without a digest. No silent path.
- **Inherited, not fixed**: CAS staleness on no-op saves (touch trigger);
  per-table error semantics of direct SELECT reads; `T | null` upsert wrapper
  shape (the workbench hook's revert contract depends on it — fold into the
  partner's-return Result<T> rework).

## Verification

CI-first: no Node/npm/tsc/vitest on the authoring machine — CI is the first
execution of typecheck and tests.

Test pins (new/extended): entry-digest + generic-RPC routing incl. both CAS
hints; report apply arm; currency entries axis with legacy returns
byte-identical; normalizeRegister seam (kind filter, embed unwrap, included
flag); section — load-failure banner (absence ≠ failure), preview lock,
approve disabled without digest, approve disabled + mismatch notice when
rendered blocks disagree with the server digest (and enabled when a
genuinely empty set matches md5('')), save-failure preserve + banner +
approve blocked while the error stands, STALE_BASIS reload notice,
divergence banner, blocks exclude NOT_YET_CLASSIFIED, QA placeholder
rendered, `findings_report-*` panel testids.

E2E (user, after Roger applies 20260906000000/000100 + redeploys
audit-deliverable-draft):
1. Stage 7 shows the Findings report section; blocks mirror Stage-6 entries
   with the `[Classification: to be determined by QA]` line; unclassified
   entries absent.
2. Manual narrative → Save → persists; HistoryDrawer shows deltas; edit
   demotes to DRAFT and clears the seal.
3. Draft with PIQC → intro/closing land as DRAFT with cited refs; observation
   text appears ONLY via the injected blocks.
4. Approve → seals; edit an entry in Stage 6 → divergence banner; approve
   again after re-review → clears.
5. Approve raced against an entry edit → STALE_BASIS notice, latest shown,
   nothing latched.
6. Stage 7→8 advance unchanged with the findings report absent/DRAFT.
