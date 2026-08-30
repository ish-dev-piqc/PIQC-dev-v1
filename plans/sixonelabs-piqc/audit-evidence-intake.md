---
owner: sixonelabs-piqc
feature: Audit evidence intake (PR-B) — audit-level source evidence register, text/paste slice
status: active
started: 2026-08-30
target_pr:
---

# Audit evidence intake (PR-B)

## Context

Auditors receive source evidence — most importantly the vendor's completed questionnaire — as emailed Word/Excel files, at any stage of the audit. PR-B gives every audit an evidence register: paste the document text into an audit-level drawer, it ingests through the existing `documents` + `chunks` pipeline (text path only — `ingestPipeline.ts` untouched), and an `audit_source_documents` join row records provenance (`source_type`, optional locator, `include_in_generation`). PR-C consumes the register for grounded deliverable generation + Revise-with-AI. Attach and remove both write `'AUDIT'` deltas.

**Questionnaire duality rule:** the structured in-app questionnaire (latch, prefill, gates) is the workflow source of truth; an attached questionnaire *file* is provenance + RAG grounding. They complement, never compete.

## Scope (files allowed)

- supabase/migrations/20260830000000_audit_evidence_register.sql (new)
- supabase/functions/ingest/index.ts (~15-line additive change: optional `kind` param, text-path `content_hash`, reject AUDIT_EVIDENCE+pdf)
- src/lib/audit/evidenceApi.ts (new)
- src/lib/audit/__tests__/evidenceApi.test.ts (new)
- src/components/dashboard/audit/EvidenceDrawer.tsx (new)
- src/components/dashboard/audit/__tests__/EvidenceDrawer.test.tsx (new)
- src/components/dashboard/audit/AuditWorkspaceShell.tsx (6th header button, drawer mount, onOpenEvidence prop)
- src/components/dashboard/audit/stages/PreAuditDraftingWorkspace.tsx (evidence summary chip)
- src/components/dashboard/audit/stages/QuestionnaireReviewWorkspace.tsx (one-line attach affordance)
- src/types/audit/enums.ts (DocumentKind)
- src/types/audit/objects.ts (AuditSourceDocument + list-row DTO)
- plans/sixonelabs-piqc/audit-evidence-intake.md (this file)

## Out of scope (files forbidden)

- supabase/functions/_shared/ingestPipeline.ts (~13 open plans claim it; text-only slice avoids it entirely)
- supabase/functions/reducto-webhook/, supabase/functions/ingest-recover/ (PDF path — PR-B3+)
- src/context/** (house audit-drawer pattern is fetch-on-open via lib API, not context)
- src/lib/audit/auditApi.ts, auditCreationApi.ts, intakeApi.ts, reportApi.ts (patterns copied, files untouched)
- Any `evidence_attachments` or `protocol_source_evidence` table/code (no third evidence model)
- Existing migrations (append-only)

## Architecture layers touched

- [x] migration (`supabase/migrations/`)
- [x] RPC (`supabase/functions/` or `.sql`) — `audit_mode_attach_evidence`, `audit_mode_remove_evidence` (SQL); `ingest` edge function (additive)
- [ ] adapter (`src/lib/*/*Adapter.ts`)
- [ ] context (`src/context/`)
- [x] component (`src/components/`)
- [x] test (`src/**/__tests__/`)

## Mock data plan

none

## Approved-by

- @karl-dev-piqc — for src/lib/audit/**, src/components/dashboard/audit/**, src/types/audit/**
- @rv61 (self) — supabase/**

Coordination notes: `plans/ishika/ingest-async.md` + `parse-review.md` (in-review) also touch `ingest/index.ts` — additive change, notify Ishika on merge order. `plans/sixonelabs-piqc/audit-stage-gate-consolidation.md` (active, mine) shares `PreAuditDraftingWorkspace.tsx` / `QuestionnaireReviewWorkspace.tsx` — self-coordination.

## Verification

CI-first: no Node/npm/tsc/vitest on the authoring machine — CI is where typecheck and tests first execute.

- [ ] CI green: typecheck + vitest (evidenceApi.test.ts, EvidenceDrawer.test.tsx run for the first time in CI) + all 13 mechanical checks
- [ ] Staging: create audit → open Evidence from header at Stage 1 → paste checkbox-bearing text → row appears `ready`, glyphs normalized (`[ ]`/`[x]`) in chunk content
- [ ] Staging: Stage-3 line + Stage-5 chip both open the same drawer; chip count matches register
- [ ] Staging: Remove a row → HistoryDrawer/Traceability shows attach + remove `'AUDIT'` deltas
- [ ] Staging: evidence doc absent from protocol-scoped chat/search (`protocol_id` NULL)
- [ ] Staging: repeat on an ISA audit — button + drawer only (no stage affordances)
