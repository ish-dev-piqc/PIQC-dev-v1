---
owner: sixonelabs-piqc
feature: Delete dead MOCK_PRE_AUDIT constant (house rule 4 cleanup)
status: active
started: 2026-08-30
target_pr:
---

# Delete dead MOCK_PRE_AUDIT constant

## Context

PR-D1's review (2026-08-30) found that the `MOCK_PRE_AUDIT` constant in `src/lib/audit/mockPreAudit.ts` has zero importers repo-wide — every consumer imports only the type definitions from that file. House rule 4: delete what you don't use. Re-verified at intake: the constant's name appears nowhere outside its own definition, all five importing files use `import type` / inline `type` specifiers exclusively, and there is no dynamic `import()`, `require()`, or string-keyed access to the module or the constant anywhere in `src/`.

The exported interfaces (`MockPreAuditBundle`, `MockConfirmationLetter`, `MockAgenda`, `MockChecklist`, and their content/item types) are heavily used and stay untouched.

## Scope (files allowed)

- src/lib/audit/mockPreAudit.ts

## Out of scope (files forbidden)

- src/lib/audit/preAuditApi.ts
- src/lib/audit/deliverableGenerationApi.ts
- src/lib/audit/lineageAdapter.ts
- src/context/AuditDataContext.tsx
- src/components/dashboard/audit/stages/PreAuditDraftingWorkspace.tsx
- src/lib/audit/mockProtocolRisks.ts, mockVendorEnrichment.ts, mockRiskSummary.ts, mockQuestionnaire.ts — sibling mock modules; whether their constants are also dead is a separate question, not this PR

## Architecture layers touched

- [ ] migration (`supabase/migrations/`)
- [ ] RPC (`supabase/functions/` or `.sql`)
- [ ] adapter (`src/lib/*/*Adapter.ts`)
- [ ] context (`src/context/`)
- [ ] component (`src/components/`)
- [ ] test (`src/**/__tests__/`)

None — `mockPreAudit.ts` is a plain lib/types module. The change deletes one dead constant and keeps every exported type. No type impact beyond the deletion itself; no migration in the diff.

## Mock data plan

none — this PR removes mock data. The `MOCK_PRE_AUDIT` fixture was unreachable (zero importers), so no localStorage toggle is involved.

## Approved-by

- @karl-dev-piqc — for src/lib/audit/mockPreAudit.ts (Audit Mode owner per docs/CODEOWNERS.md)

## Verification

- [x] `grep -rn "MOCK_PRE_AUDIT"` across the repo — only the definition line matches; no string-keyed access (`['MOCK_PRE_AUDIT']`, `MOCK_PRE_AUDIT[...]` via alias) anywhere.
- [x] All references to the module (`mockPreAudit`) enumerated: 5 files, every one an `import type` / inline-`type` import; no dynamic `import()` or `require()` of the module.
- [x] Post-deletion grep confirms the remaining file exports types only and its own `import type` header is still fully used.
- [ ] CI typecheck (piqc-discipline workflow) passes on the PR — no Node/tsc on this machine, so CI is the first execution of `tsc` for this change.
