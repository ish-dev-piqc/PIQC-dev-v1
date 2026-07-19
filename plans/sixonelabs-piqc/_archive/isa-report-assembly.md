---
owner: sixonelabs-piqc
feature: isa-report-assembly
status: merged
merged: 2026-07-19
started: 2026-07-19
target_pr: #504
---

# ISA report assembly — S3 of the notes → findings → report arc

## Context

S1/S2/S2.5 (PRs #498/#500/#502) carry the auditor from shorthand notes to accepted findings. S3 delivers the report: the S0 canonical skeleton assembled ~70% deterministically (metadata merge + boilerplate constants + mechanical rollups from findings), with auditor-editable prose sections, a **structured site-continuation verdict that is never machine-drafted and gates export**, and two delivery paths — a .docx download and a **paste-ready clipboard copy** (dual `text/html` + `text/plain` flavors so Word and Google Docs receive formatted content; the DRAFT/provenance banner travels inside the payload). Zero LLM in this slice: the exec summary derives from the templates' six-beat formula; LLM refinement is a later add. Full spec: `plans/fable/isa-notes-finding-writer-fable-pass.md`.

## Scope (files allowed)

- supabase/migrations/20260725000000_audit_mode_isa_report_schema.sql
- supabase/migrations/20260725000100_audit_mode_isa_report_rpcs.sql
- src/types/audit/enums.ts
- src/types/audit/objects.ts
- src/lib/audit/isaReportApi.ts
- src/lib/audit/isaReportModel.ts
- src/lib/audit/isaReportClipboard.ts
- src/lib/audit/isaReportDocx.ts
- src/lib/audit/__tests__/isaReportModel.test.ts
- src/lib/audit/__tests__/isaReportClipboard.test.ts
- src/lib/audit/__tests__/isaReportApi.test.ts
- src/components/dashboard/audit/stages/investigator/IsaReportWorkspace.tsx
- src/components/dashboard/audit/AuditWorkspaceShell.tsx

## Out of scope (files forbidden)

- src/components/dashboard/audit/stages/ReportDraftingWorkspace.tsx, FinalReviewExportWorkspace.tsx (vendor lane — patterns copied, never imported)
- supabase/functions/** (no LLM in S3)
- src/lib/audit/isaNotesApi.ts, isaFindingsApi.ts, isaInsights.ts (consumed, not modified)
- src/components/dashboard/audit/stages/investigator/IsaConductWorkspace.tsx

## Architecture layers touched

- [x] migration (`supabase/migrations/`)
- [x] RPC (`.sql`)
- [ ] adapter
- [ ] context
- [x] component (`src/components/`)
- [x] test (`src/lib/audit/__tests__/`)

## Mock data plan

none

## Approved-by

- @karl-dev-piqc — src/lib/audit/, src/types/audit/, src/components/dashboard/audit/
- @rog-dev-piqc — supabase/migrations/

## Verification

- [ ] `tsc --noEmit -p tsconfig.app.json` clean; vitest green (model + clipboard builders)
- [ ] Dev-applied migrations: edit/save each prose section → row upserts with deltas; derived sections re-render live until edited
- [ ] Verdict unset → export buttons disabled with explanation; exec summary shows the explicit placeholder; set verdict → exports enable and the verdict sentence renders
- [ ] Download .docx → opens in Word with metadata table, matrix, severity-grouped observations, DRAFT banner
- [ ] Copy for Word/Google Docs → paste into BOTH: headings/bold/tables survive, DRAFT + "PIQC drafted · requires human review" banner is part of the pasted content; paste into a plain editor → clean text fallback
- [ ] Per-finding copy → single finding pastes formatted with its evidence and citation
- [ ] No participant initials column anywhere in any output; no sponsor name in any builder
