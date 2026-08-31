---
owner: sixonelabs-piqc
feature: Delete dead sibling mock constants in src/lib/audit/ (house rule 4 cleanup)
status: merged
merged: 2026-08-31
started: 2026-08-30
target_pr: #565
---

# Delete dead sibling mock constants

## Context

Follow-up to the `MOCK_PRE_AUDIT` deletion (plans/sixonelabs-piqc/audit-mock-preaudit-dead-code.md), whose intake explicitly deferred the sibling mock modules as "a separate question, not this PR". Verified at intake, repo-wide (including intra-file usage, `export *` re-exports, dynamic `import()`/`require()`, and string-keyed access — none exist): eight exported constants in `src/lib/audit/mock*.ts` have zero importers. Every external consumer of these six modules uses `import type` / inline-`type` specifiers exclusively. House rule 4: delete what you don't use.

Dead and deleted: `MOCK_PROTOCOL_RISKS`, `MOCK_QUESTIONNAIRES` (plus its private feeders `BRIGHTEN_ADDENDA`, `IMMUNE_ADDENDA`), `MOCK_RISK_SUMMARIES`, `MOCK_WORKSPACE_ENTRIES`, `MOCK_VENDOR_SERVICES`, `MOCK_SERVICE_MAPPINGS`, `MOCK_TRUST_ASSESSMENTS`, `MOCK_REPORTS`.

**Not dead, kept:** `TEMPLATE_QUESTIONS` (mockQuestionnaire.ts) — the first-pass grep that motivated this task was wrong about it. It is value-imported by `src/components/dashboard/audit/stages/QuestionnaireReviewWorkspace.tsx` and seeds the questions array of every freshly created questionnaire instance (`createInstance`). It is the canonical Standard GCP template, not unreachable fixture data.

All exported interfaces stay — `AuditDataContext.tsx`, `preAuditApi.ts`, `lineageAdapter.ts`, `questionnaireApi.ts`, `vendorEnrichmentApi.ts`, `riskSummaryApi.ts`, `reportApi.ts`, `workspaceEntriesApi.ts`, `intakeApi.ts`, `capaApi.ts`, `heatmap.ts`, and the audit stage components all import types from these files. Files that become types-only get their header comment retitled, mirroring the mockPreAudit.ts pattern.

## Scope (files allowed)

- src/lib/audit/mockProtocolRisks.ts
- src/lib/audit/mockQuestionnaire.ts
- src/lib/audit/mockRiskSummary.ts
- src/lib/audit/mockWorkspaceEntries.ts
- src/lib/audit/mockVendorEnrichment.ts
- src/lib/audit/mockReport.ts

## Out of scope (files forbidden)

- src/lib/audit/mockPreAudit.ts — owned by the sibling active plan audit-mock-preaudit-dead-code.md (unmerged branch `sixonelabs-piqc/audit-mock-preaudit-dead-code`)
- src/lib/audit/*Api.ts, src/lib/audit/lineageAdapter.ts — type-only consumers; unaffected by the deletions
- src/context/AuditDataContext.tsx, src/components/dashboard/audit/** — type-only consumers, except QuestionnaireReviewWorkspace.tsx whose `TEMPLATE_QUESTIONS` value import stays valid because the constant is kept
- src/lib/audit/__tests__/**, src/components/dashboard/audit/stages/__tests__/** — no test references any deleted constant

## Architecture layers touched

- [ ] migration (`supabase/migrations/`)
- [ ] RPC (`supabase/functions/` or `.sql`)
- [ ] adapter (`src/lib/*/*Adapter.ts`)
- [ ] context (`src/context/`)
- [ ] component (`src/components/`)
- [ ] test (`src/**/__tests__/`)

None — plain lib/types modules. Deletions only; every exported type is preserved byte-for-byte. No type impact beyond removing the constants; no migration in the diff.

## Mock data plan

none — this PR removes mock data. All eight fixtures were unreachable (zero importers), so no localStorage toggle is involved.

## Approved-by

- @karl-dev-piqc — for all six `src/lib/audit/mock*.ts` files (Audit Mode owner per docs/CODEOWNERS.md)

## Verification

- [x] Per-constant repo-wide grep (`src/`, `supabase/`, `scripts/`, all ts/tsx/js/json/md): each deleted constant's name appears only at its own definition site. `TEMPLATE_QUESTIONS` flagged live (QuestionnaireReviewWorkspace.tsx:17,192) and kept.
- [x] Intra-file usage traced: `MOCK_QUESTIONNAIRES` was the only consumer of `TEMPLATE_QUESTIONS` inside mockQuestionnaire.ts besides the live component, and the only consumer of `BRIGHTEN_ADDENDA`/`IMMUNE_ADDENDA` — those two private consts die with it.
- [x] Module-level references enumerated: every import from the six modules outside them is `import type` / inline-`type` (the single exception is the kept `TEMPLATE_QUESTIONS`). No `export *`/barrel re-exports, no dynamic `import()`, no `require()`, no `['MOCK_...']` string-keyed access anywhere in `src/`.
- [x] Post-deletion grep: each file's remaining `import type` header is still fully used by the surviving interfaces; no orphaned imports.
- [ ] CI typecheck (piqc-discipline workflow) passes on the PR — no Node/tsc on this machine, so CI is the first execution of `tsc` for this change.
