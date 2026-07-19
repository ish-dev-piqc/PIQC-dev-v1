---
owner: sixonelabs-piqc
feature: isa-notes-pad
status: active
started: 2026-07-19
target_pr:
---

# ISA notes pad — S1 of the notes → findings → report arc

## Context

Investigator-site auditors capture fieldwork in Word/OneNote, then hand-retype it into findings and again into a report. S1 gives `ISA_CONDUCT` a fast freeform notes pad that lives inside the audit record — the capture surface the AI finding writer (S2) will read from. Notes are working papers: freely editable, soft-deletable (never hard-deleted — their state-history deltas must stay resolvable, and S2 findings will cite note ids as their evidence trail). Full arc: `plans/fable/isa-notes-finding-writer-fable-pass.md`.

## Scope (files allowed)

- supabase/migrations/20260723000000_audit_mode_isa_notes_schema.sql
- supabase/migrations/20260723000100_audit_mode_isa_notes_rpcs.sql
- src/types/audit/enums.ts
- src/types/audit/objects.ts
- src/lib/audit/isaNotesApi.ts
- src/lib/audit/labels.ts
- src/lib/audit/__tests__/isaNotesApi.test.ts
- src/components/dashboard/audit/stages/investigator/IsaConductWorkspace.tsx
- src/components/dashboard/audit/AuditWorkspaceShell.tsx

## Out of scope (files forbidden)

- src/components/dashboard/audit/stages/AuditConductWorkspace.tsx (vendor lane untouched)
- src/lib/audit/workspaceEntriesApi.ts
- src/lib/audit/workflowStages.ts (stage list unchanged)
- src/context/AuditContext.tsx
- supabase/functions/** (no LLM in S1 — that's S2)

## Architecture layers touched

- [x] migration (`supabase/migrations/`)
- [x] RPC (`.sql` functions)
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

- [ ] `tsc --noEmit -p tsconfig.app.json` clean; vitest suite green
- [ ] On a seeded ISA audit: add / edit / soft-delete notes; rows land in `audit_note_objects`; deleted notes vanish from the pad but keep their rows + deltas
- [ ] `state_history_deltas` gains an `AUDIT_NOTE_OBJECT` delta per mutation, readable via HistoryDrawer's resolver
- [ ] RLS: a second user cannot read or write notes on the audit
- [ ] Create RPC rejects a vendor-workflow audit id
- [ ] PHI microcopy visible under the capture box
