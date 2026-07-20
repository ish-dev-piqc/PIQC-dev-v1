---
owner: sixonelabs-piqc
feature: Audit export-readiness integrity (audit Theme A + H4)
status: active
started: 2026-07-20
target_pr:
---

# Audit export-readiness integrity

## Context

The Fable whole-codebase audit (`plans/fable/main-quality-audit-2026-07.md`, Theme A) found the audit approval gate ignores concurrent state, client and server. The follow-up design pass (`plans/fable/audit-export-readiness-spec.md`) reframed the fix under the founder's doctrine ruling — in-PIQC "approval" is a **readiness-to-export latch at the draft boundary**, never a GxP attestation — and verified six holes (H1–H6): all six approve RPCs stamp blind; the advance gate list stops at stage 6; sign-off signs off DRAFT reports; the sign-off latch never clears on edit; Approve isn't gated on the in-flight LLM refine; and the report's readiness covers only two text columns while the reviewed draft includes the classified entry set.

One mechanism closes all of it: **assert what you saw** (compare-and-swap on `updated_at` in every approve), **seal what you marked ready** (server-computed `readiness_fingerprint` over exec summary + conclusions + entry-set digest), **verify at every boundary crossing** (advance gate, sign-off gate, export verify + gated export-mark).

## Scope (files allowed)

- supabase/migrations/20260730000000_audit_export_readiness_gates.sql
- src/lib/audit/reportApi.ts
- src/lib/audit/preAuditApi.ts
- src/lib/audit/questionnaireApi.ts
- src/lib/audit/riskSummaryApi.ts
- src/lib/audit/mockReport.ts
- src/lib/audit/mockPreAudit.ts
- src/lib/audit/mockQuestionnaire.ts
- src/lib/audit/__tests__/lineageAdapter.test.ts
- src/components/dashboard/audit/stages/ReportDraftingWorkspace.tsx
- src/components/dashboard/audit/stages/PreAuditDraftingWorkspace.tsx
- src/components/dashboard/audit/stages/FinalReviewExportWorkspace.tsx
- src/components/dashboard/audit/stages/QuestionnaireReviewWorkspace.tsx
- src/components/dashboard/audit/stages/__tests__/ReportDraftingWorkspace.test.tsx
- src/components/dashboard/audit/RiskSummaryPanel.tsx
- plans/sixonelabs-piqc/audit-export-readiness.md

## Out of scope (files forbidden)

- All merged migrations (append-only; the new migration DROPs + recreates the six approve RPCs and CREATE OR REPLACEs advance / sign-off / upsert / export-mark against their LATEST definitions — verified: upsert_report_draft's live signature is the 6-param one from 20260516020000, not the original).
- src/lib/audit/auditApi.ts — advanceAuditStage already surfaces errorHint; new GATE_* hints flow through unchanged.
- ISA stage surfaces, org/chat, site, sotr, deliverables — untouched.
- The S2 Result-shape repo-wide sweep — separate lane; this PR stays file-local (each API keeps its own local result type).

## Architecture layers touched

- migration, RPC, API layer (src/lib/audit), component, test. No context changes; no realtime.

## Mock data plan

none (existing seeded demo literals gain the new required `updated_at` field only)

## Approved-by

- Karl — audit components + src/lib/audit (the bulk of the diff)
- Roger — supabase/ (the migration)

## Verification

- `tsc --noEmit -p tsconfig.app.json` clean; `vitest run` green (both run locally in the build worktree).
- Migration replaces only LATEST function definitions (S3-trap check done: every touched function's defining migrations enumerated; only upsert_report_draft had later redefinitions, and the new body is byte-based on 20260516020000).
- Old approve signatures DROPped before recreation — no PostgREST overload leaves the blind stamp callable.
- SQL smoke (dev team, post-`db push`):
  1. `SELECT audit_mode_approve_report_draft('<id>', NULL, '2020-01-01T00:00:00Z');` → error hint `STALE_CONTENT`.
  2. Approve with the row's real `updated_at` → APPROVED + `readiness_fingerprint` populated.
  3. Add/reclassify a workspace entry, then advance to FINAL_REVIEW_EXPORT → error hint `GATE_REPORT_DIVERGED`.
  4. Sign-off on a DRAFT report → `GATE_REPORT_NOT_APPROVED`.
  5. Edit report text after sign-off → `final_signed_off_at` cleared (H4).
  6. `SELECT audit_mode_verify_export_readiness('<audit_id>');` → `{ready:false, reasons:[...]}` matching 3–5.
- UI: Mark-ready disabled during LLM refine; stale approve auto-refetches with the invitational note; export buttons disabled when the checklist regresses after sign-off.

## Deploy step (dev-team-owned)

Migration only — `supabase db push` after merge. No edge-function deploy. TS mirrors updated in-diff (ReportDraftRow + Mock types).
