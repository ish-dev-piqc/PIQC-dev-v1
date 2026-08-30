---
owner: sixonelabs-piqc
feature: Deliverable generation fan-out (PR-C2) — agenda + confirmation letter join grounded generation; engine consolidated
status: merged
started: 2026-08-30
target_pr:
---

# Deliverable generation fan-out (PR-C2)

## Context

C1 (#547) shipped grounded generation for the checklist. C2 fans out to the agenda and confirmation letter — and consolidates at the moment the rule of three arrives: instead of cloning the 650-line draft engine twice more, ONE `audit-deliverable-draft` edge function takes a `deliverable` param ('checklist' | 'agenda' | 'confirmation_letter'); `audit-checklist-draft` is deleted and the client switches endpoint. Per-deliverable prompts + shapes live in a config module; the engine (ownership proof → service-role retrieval → verbatim-quote ref gate → C-label identity for existing items) is written once. Letter rule: `recipients` (names) never reach the model — the model drafts `body_text` + `scope` only; the client merges current recipients at apply. Agenda owners are ROLES, never names. The two remaining tabs also get C1's same-id resync fix + revise-while-editing gate (same latent seam, now triggered).

## Scope (files allowed)

- supabase/migrations/20260901000000_audit_deliverable_generation_fanout.sql (new — generation columns on agenda_objects + confirmation_letter_objects; apply RPCs wrapping the existing upserts)
- supabase/functions/audit-deliverable-draft/** (new — consolidated engine + per-deliverable config)
- supabase/functions/audit-checklist-draft/** (DELETED — superseded; deploy note: `supabase functions delete audit-checklist-draft` if it was ever deployed)
- supabase/functions/_shared/protocolCandidates.ts (comment-only: consumer rename after the consolidation; prompts.ts also imports its MAX_QUOTE_CHARS)
- src/lib/audit/deliverableGenerationApi.ts (generalize: request/apply per deliverable; computeDeliverableCurrency rename)
- src/lib/audit/__tests__/deliverableGenerationApi.test.ts (extend for the fan-out)
- src/lib/audit/mockPreAudit.ts (agenda/letter generation fields; ChecklistGenerationRef → DeliverableGenerationRef rename ripple)
- src/lib/audit/preAuditApi.ts (flatten pass-through for agenda + letter; rename ripple)
- src/types/audit/objects.ts (rename ChecklistGenerationRef/ChecklistGroundingSnapshot → Deliverable*, no alias per house rule 5)
- src/components/dashboard/audit/stages/PreAuditDraftingWorkspace.tsx (panel generalized to all three tabs; AgendaTab + ConfirmationLetterTab get the updated_at resync fix + onEditingChange gate)
- plans/sixonelabs-piqc/audit-deliverable-generation-fanout.md (this file)
- plans/sixonelabs-piqc/_archive/* (step-0: archive the two merged plans — bot never fired)

## Out of scope (files forbidden)

- C3 export-readiness currency flag; readiness_fingerprint system
- supabase/functions/isa-finding-draft/**, _shared/ingestPipeline.ts
- Checklist behavior changes beyond the endpoint switch (C1 semantics frozen)
- Auto-regenerate (rejected); recipients/personnel names in any prompt
- src/context/**

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

Coordination: `audit-stage-gate-consolidation` (own, active) shares PreAuditDraftingWorkspace — self-coordination, same as C1.

## Verification

CI-first: no Node/npm/tsc/vitest on the authoring machine — CI is where typecheck and tests first execute.

- [ ] CI green (typecheck + vitest + mechanical checks)
- [ ] Staging: checklist Generate/Revise still works end-to-end through the NEW endpoint (regression for the consolidation)
- [ ] Staging: agenda Draft with PIQC → items with role owners (no names), refs verbatim; currency notice on register drift; revise preserves items by identity
- [ ] Staging: letter Draft with PIQC → body_text + scope grounded; recipients untouched by generation (edit recipients, revise, confirm preserved)
- [ ] Staging: approved deliverable demotes to DRAFT on generation apply (latch regression, all three)
- [ ] Deploy: `supabase functions deploy audit-deliverable-draft`; delete audit-checklist-draft if previously deployed
