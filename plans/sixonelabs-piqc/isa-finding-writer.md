---
owner: sixonelabs-piqc
feature: isa-finding-writer
status: active
started: 2026-07-19
target_pr:
---

# ISA finding writer — S2 of the notes → findings → report arc

## Context

S1 (PR #498) gave `ISA_CONDUCT` the notes pad. S2 is the payoff: PIQC reads the auditor's shorthand notes and proposes draft findings — clustered by the one-finding-one-root-cause rule, written in audit register, severity-rated with the rule that fired named, each evidence line traced to the note ids it came from, regulatory citation selected from a verified closed-world E6(R3)/CFR map. The auditor reviews side-by-side against their own notes and accepts; only then does a finding row exist. Doctrine: D-008 (no autonomous writes), cite-or-drop and closed-world citation enforced server-side, sponsor names never sent to the LLM. Full spec: `plans/fable/isa-notes-finding-writer-fable-pass.md`.

## Scope (files allowed)

- supabase/migrations/20260724000000_audit_mode_isa_findings_schema.sql
- supabase/migrations/20260724000100_audit_mode_isa_findings_rpcs.sql
- supabase/functions/isa-finding-draft/index.ts
- supabase/functions/isa-finding-draft/citationMap.ts
- supabase/functions/isa-finding-draft/gates.ts
- src/types/audit/enums.ts
- src/types/audit/objects.ts
- src/lib/audit/isaFindingsApi.ts
- src/lib/audit/__tests__/isaFindingsApi.test.ts
- src/lib/audit/__tests__/isaFindingGates.test.ts
- src/lib/audit/__tests__/isaNotesApi.test.ts
  (mechanical compile fix: AuditNoteObject gained required promoted_finding_id; the S1 fixture needs the field)
- src/components/dashboard/audit/stages/investigator/IsaConductWorkspace.tsx

## Out of scope (files forbidden)

- src/components/dashboard/audit/stages/AuditConductWorkspace.tsx (vendor lane untouched)
- src/lib/audit/workspaceEntriesApi.ts, src/lib/audit/reportApi.ts
- supabase/functions/audit-summary/** (forked from, not modified)
- src/lib/audit/isaNotesApi.ts (S1 surface unchanged; promotion happens via the finding RPC)

## Architecture layers touched

- [x] migration (`supabase/migrations/`)
- [x] RPC (`.sql` functions + edge function)
- [ ] adapter
- [ ] context
- [x] component (`src/components/`)
- [x] test (`src/lib/audit/__tests__/`)

## Mock data plan

none (localStorage draft stash `piq-isa-drafts-v1:<auditId>` holds the last LLM response for crash-safe review — a cache of server output, not mock data)

## Approved-by

- @karl-dev-piqc — src/lib/audit/, src/types/audit/, src/components/dashboard/audit/
- @rog-dev-piqc — supabase/migrations/, supabase/functions/

## Verification

- [ ] `tsc --noEmit -p tsconfig.app.json` clean; vitest green (gates + API tests)
- [ ] Dev-applied migrations + deployed edge function: seed ~15 shorthand notes on an ISA audit → Draft findings → every draft's evidence traces to real note ids; withheld count surfaces when the LLM cites a phantom note
- [ ] Reference field only ever shows citation-map strings; free-composed cites are stripped
- [ ] Accept → `isa_finding_objects` row + cited notes get `promoted_finding_id`; re-running drafts excludes promoted notes
- [ ] Editing a PIQC draft before/after accept flips origin to PIQC_EDITED (provenance honesty)
- [ ] No sponsor name in the edge-function request/prompt (code inspection + log check)
