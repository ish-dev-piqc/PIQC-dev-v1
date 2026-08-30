---
owner: sixonelabs-piqc
feature: Grounded checklist generation (PR-C1) — generate + snapshot + currency + Revise with AI for the audit checklist
status: merged
merged: 2026-08-30
started: 2026-08-30
target_pr: #547
---

# Grounded checklist generation (PR-C1)

## Context

The evidence register (PR-B, #545) is inert until generation grounds in it. PR-C1 is the smallest end-to-end slice of the grounding lifecycle: the **audit checklist** (the most protocol-specific Stage-5 deliverable) gains grounded AI generation over protocol chunks + evidence-register chunks (`include_in_generation`), a grounding snapshot on the row (the `protocol_refs` breadcrumb pattern), a per-deliverable currency notice when the register drifts from the snapshot (flag, never block), and human-triggered **Revise with AI** that persists the auditor's edits first. The generation mechanics fork `isa-finding-draft` — the house grounded-generation precedent (cite-or-drop, verbatim-quote gate, service-role retrieval only after JWT ownership proof, proposals never written server-side). Output enters as DRAFT via the existing upsert RPC; the demote-on-edit approval latch is untouched. C2 fans out to agenda + confirmation letter; C3 adds the export-readiness currency flag.

## Scope (files allowed)

- supabase/migrations/20260831000000_audit_checklist_generation.sql (new — generation_refs/grounding_snapshot/generated_at columns + additive optional params on the checklist upsert RPC)
- supabase/functions/audit-checklist-draft/** (new edge function, isa-finding-draft fork)
- supabase/functions/_shared/protocolCandidates.ts (new — moved from isa-finding-draft/)
- supabase/functions/isa-finding-draft/index.ts, supabase/functions/isa-finding-draft/gates.ts, supabase/functions/isa-finding-draft/protocolCandidates.ts (import-path-only edits + deletion of the moved file; NO behavior change)
- src/lib/audit/deliverableGenerationApi.ts (new)
- src/lib/audit/__tests__/deliverableGenerationApi.test.ts (new)
- src/components/dashboard/audit/stages/PreAuditDraftingWorkspace.tsx (ChecklistTab: Generate / currency notice / Revise with AI)
- src/types/audit/objects.ts (GenerationRef, GroundingSnapshot, checklist row extension)
- src/types/audit/enums.ts (only if a new enum is needed)
- src/lib/audit/mockPreAudit.ts (MockChecklist: three optional generation fields)
- src/lib/audit/preAuditApi.ts (DeliverableRow + flattenChecklist pass-through of the three new columns ONLY — templated prefill logic untouched)
- src/lib/audit/__tests__/isaProtocolCandidates.test.ts (import path follows the protocolCandidates.ts move)
- src/lib/audit/__tests__/isaFindingGates.test.ts (same — import path only)
- plans/sixonelabs-piqc/audit-checklist-grounded-generation.md (this file)
- plans/sixonelabs-piqc/_archive/* (step-0 hygiene: 5 provably-merged plans moved; audit-evidence-intake.md deliberately left for the archive bot)

## Out of scope (files forbidden)

- Agenda / confirmation-letter generation (C2); export-readiness currency flag + readiness_fingerprint system (C3)
- supabase/functions/_shared/ingestPipeline.ts, soaGridParser (contested; untouched)
- supabase/functions/isa-report-draft/**, audit-summary/** (parallel precedents, not dependencies)
- src/context/** (currency notice is component-local set-diff via listAuditEvidence)
- preAuditApi.ts prefill/upsert/approve logic (only the row-mapper pass-through is in scope — generation is a separate, opt-in path)
- Any auto-regenerate behavior (consciously rejected in the workflow Q&A)

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

- @karl-dev-piqc — for src/lib/audit/**, src/components/dashboard/audit/**, src/types/audit/**
- @rv61 (self) — supabase/**

Coordination: `audit-stage-gate-consolidation` (own, active) shares PreAuditDraftingWorkspace — self-coordination on merge order. Ishika's in-review `_shared/` claims name ingestPipeline/soaGridParser, not the new protocolCandidates.ts.

## Verification

CI-first: no Node/npm/tsc/vitest on the authoring machine — CI is where typecheck and tests first execute.

- [ ] CI green (typecheck + vitest incl. new deliverableGenerationApi.test.ts + all mechanical checks)
- [ ] Staging: audit with protocol + ≥1 evidence doc → Generate on empty checklist → items carry refs with verbatim quotes; row shows generated_at; content saved as DRAFT (latch intact — editing demotes)
- [ ] Staging: attach a new evidence doc → currency notice appears on checklist tab (non-blocking); Revise with AI persists a manual edit made before revising
- [ ] Staging: remove a grounded evidence doc → currency notice names removal case
- [ ] Staging: audit with no evidence → generation still works protocol-only; no fabricated evidence refs (gate check)
- [ ] Staging: ISA finding drafts still work (import-path move verified end-to-end)
