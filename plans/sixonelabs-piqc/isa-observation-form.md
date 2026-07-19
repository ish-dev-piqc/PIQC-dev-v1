---
owner: sixonelabs-piqc
feature: isa-observation-form
status: active
started: 2026-07-19
target_pr:
---

# ISA observation form — S3.5 of the notes → findings → report arc

## Context

The audit report (S3, PR #504) is the client/QA-facing artifact. The standard templates define a second one: the **audit observation form** — the auditee-facing response vehicle, with per-finding response cells, the severity-keyed response requirements (root cause required for Critical/Major, optional for Recommendations), classification definitions, and a signature loop. It is ~100% mechanical over the existing report packet — no new tables, no LLM. This slice adds form builders to the two existing renderer modules (one packet, now four renderings) plus export buttons on the report workspace. The form gates on findings existing (not on the site verdict — the verdict belongs to the report, not the response vehicle).

## Scope (files allowed)

- src/lib/audit/isaReportClipboard.ts
- src/lib/audit/isaReportDocx.ts
- src/lib/audit/__tests__/isaReportClipboard.test.ts
- src/components/dashboard/audit/stages/investigator/IsaReportWorkspace.tsx

## Out of scope (files forbidden)

- supabase/** (nothing to persist — the form derives from findings + draft params)
- src/lib/audit/isaReportModel.ts (the packet already carries everything needed)
- src/components/dashboard/audit/stages/AuditConductWorkspace.tsx (vendor lane)

## Architecture layers touched

- [ ] migration
- [ ] RPC
- [ ] adapter
- [ ] context
- [x] component (`src/components/`)
- [x] test (`src/lib/audit/__tests__/`)

## Mock data plan

none

## Approved-by

- @karl-dev-piqc — src/lib/audit/, src/components/dashboard/audit/

## Verification

- [ ] `tsc --noEmit -p tsconfig.app.json` clean; vitest green (form builder tests)
- [ ] With ≥1 finding: "Observation form" copy + .docx buttons enabled (independent of verdict); zero findings → disabled with explanation
- [ ] Copied form pastes into Word/Google Docs with the observations table (Owner / Category / Classification / Observation & Evidence / Response), empty response cells, severity-keyed requirement lines, signature block, DRAFT banner in-payload
- [ ] Per-severity response requirements match the ladder: Critical/Major = root cause + correction + CAPA plan; Minor = correction; Recommendation = optional
- [ ] No initials, no sponsor names in any output
