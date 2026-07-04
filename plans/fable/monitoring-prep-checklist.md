---
owner: fable-dev-piqc
feature: monitoring-prep-checklist
status: in-review
started: 2026-07-03
target_pr:
---

# Protocol Deliverable Engine + Monitoring Preparation Checklist (Phase 1)

## Context

First vertical slice of the founder's Protocol Intelligence Platform handover:
a draft, evidence-linked, editable, reviewable, exportable **Monitoring
Preparation Checklist** generated from the protocol facts SOTR already
extracts, surfaced as a **"Protocol Intelligence" sub-tab on the Sponsor
page** (enterprise-gated). It rides on a new shared, non-mode **Protocol
Deliverable Engine** (`src/lib/deliverables/`) that future deliverables
(sponsor risk overview, CRA monitoring focus, SIV package) reuse —
"parse once, generate many." No new extraction pipeline: the engine
**selects** from `protocol_extracted_items`; it never re-parses.

Why the engine can't be a view over SOTR alone: the founder's 3-way content
taxonomy (`protocol_fact` / `derived_operational_framing` /
`human_editorial`) is not expressible in SOTR's 2-way model
(`extracted_value` frozen vs `current_text` overlay), and SOTR RLS is
owner-only (`documents.user_id`), which a sponsor can never pass.

## Design

### Data spine (migration 1)

Three tables + enums, mirroring proven SOTR/VEW shapes:

- `protocol_deliverables` (= Artifact): protocol_id, `artifact_type`
  (enum, one value `monitoring_prep_checklist` for now), title,
  `protocol_version` stamped at generate time, generated_by/at,
  regenerated_at.
- `protocol_deliverable_blocks` (= ArtifactBlock): deliverable_id,
  `section_key`, `block_type` (`checklist_item` | `section_intro` |
  `site_question`), **`content_origin`** (enum `protocol_fact` |
  `derived_operational_framing` | `human_editorial` — never blurred),
  `derived_text` (frozen) + `current_text` (human edit; display =
  COALESCE), `extracted_item_id` → protocol_extracted_items,
  `source_evidence_id` → protocol_source_evidence, `source_quote`
  (denormalized verbatim), `confidence_state` (reuse existing enum; NULL
  for framing/human), `review_state` (enum `draft` | `needs_review` |
  `reviewed` | `edited` | `rejected` | `human_added` — `rejected` =
  removed from render/export but preserved so regeneration can't
  resurrect it), review_note, protocol_version,
  sort_order, version.
- `deliverable_block_edits` (= audit trail, mirrors
  `visit_requirement_human_edits`): action, previous/new text, reviewer,
  block_version, timestamps.

Indexes: `blocks(deliverable_id, sort_order)`,
`deliverables(protocol_id, artifact_type)`, `edits(block_id, created_at
DESC)`, partial on `blocks(extracted_item_id)`.

### Authorization (the critical decision)

- RLS on all three tables: `user_can_access_protocol(auth.uid(),
  protocol_id)` (blocks/edits join up through the deliverable). This is
  the intended extension point of that primitive; sponsors light up
  automatically once `sponsor_relationships` rows land.
- `deliverable_generate` is **SECURITY DEFINER** so it can read SOTR's
  owner-only rows internally (same pattern as
  `visit_execution_persist_*`). All read/edit/export RPCs are SECURITY
  INVOKER.
- Known debt: the sponsor clause of `user_can_access_protocol()` is
  dormant until sponsor_relationships rows exist → Phase-1 validation is
  by the document owner / enterprise org-member. Revisit trigger: those
  rows ship.

### RPCs (migration 2)

`deliverable_generate(p_protocol_id, p_artifact_type)` (DEFINER,
transactional; regenerate **preserves** `human_editorial` blocks and any
block with non-null `current_text`), `deliverable_get_packet`
(self-contained JSON packet — client never imports sotr TS),
`deliverable_set_block_review`, `deliverable_edit_block_text` (bumps
version, appends edit row), `deliverable_add_block` /
`deliverable_delete_block` (added blocks are `human_editorial` +
`human_added`), `deliverable_export_packet` (server-stamped, trimmed,
**sponsor-name-free**).

### Selection ruleset (deterministic, no LLM)

`src/lib/deliverables/selection/monitoringChecklist.ts` — pure TS,
unit-tested; the same rules are ported into the generate RPC. Keys off
the REAL persisted `field_type` values: `inclusion_criterion`,
`exclusion_criterion`, `endpoint`, `visit`, `dosing`, `metadata` (see
`src/lib/sotr/sourceEvidenceAdapter.ts`). Sections:
`eligibility_verification` (full), `exclusion_prohibited_med_review`
(partial — prohibited meds absent from extraction; emit a framing
coverage-gap block), `visit_window_verification` (full),
`endpoint_critical_checks` (full), `arm_cohort_randomization_deps`
(from `protocol_cohorts`; partial), `safety_specimen_imaging_vendor_checks`
(heuristic over visit procedures; low confidence),
`source_doc_focus` + `site_questions` (derived framing),
`amendment_sensitive` (partial; diffing is a later phase).

### UI + export

Generic block components in non-dashboard `src/components/deliverables/`
(importable by any future lens), reusing the VEW drawer patterns
(`RequirementTextDrawer` / `TraceabilityDrawer` / `EditLogDrawer`).
Sponsor mount in `src/components/dashboard/sponsor/deliverables/`
(`ProtocolIntelligenceTab`, `MonitoringChecklistPanel`); one-line insert
into `SponsorPage.tsx` gated by `canUseSponsorMode(subscription)` —
its first consumer (`src/lib/entitlements.ts` stays read-only).
Export: 3-layer pipeline copied from `visitExecutionExportApi.ts`
(fetch packet → pure `buildDeliverablePdf` → download) with DRAFT
watermark, "requires human review" disclaimer, traceability appendix,
sponsor-name-free filename.

## Scope (files allowed)

- `plans/fable/monitoring-prep-checklist.md` — this file.
- `docs/CODEOWNERS.md` — add Fable ownership lines only.
- `src/types/deliverables/` — new types spine.
- `src/lib/deliverables/` — API, adapter, mutations, export, selection, tests.
- `src/components/deliverables/` — generic block UI.
- `src/components/dashboard/sponsor/deliverables/` — sponsor mount host.
- `src/components/dashboard/sponsor/SponsorPage.tsx` — single-line sub-tab insertion.
- `supabase/migrations/*_protocol_deliverables_schema.sql` — tables + RLS.
- `supabase/migrations/*_deliverable_rpcs.sql` — engine RPCs.

## Out of scope (files forbidden)

- `src/lib/sotr/`, `src/lib/site/`, `src/lib/audit/`,
  `src/lib/visit-execution/` — read via RPC packets only, never import.
- `src/components/dashboard/sotr/`, `.../site/`, `.../audit/`,
  `.../visit-execution/` — no cross-mode UI touches.
- `src/types/sponsor/index.ts`, `SponsorProtocolDrawer.tsx`,
  `src/lib/sponsor/` — Kiara's active sponsor-mode-v2 territory.
- `src/lib/entitlements.ts` — consume `canUseSponsorMode`, do not edit.
- `src/context/` — no new contexts in Phase 1 (no realtime yet).
- `supabase/functions/` — no ingest/extraction changes (prohibited-med
  extraction is a later, Roger-lane change).
- Amendment diffing, LLM framing, SIV package, action cards — later phases.

## Architecture layers touched

- [x] migration (2 new, append-only)
- [x] RPC (generate / get_packet / review / edit / add / delete / export)
- [x] adapter (`deliverablesAdapter.ts`, pure)
- [ ] context
- [x] component (generic block UI + sponsor mount)
- [x] test (selection rules, adapter, mutations, PDF builder)

## Mock data plan

None.

## Approved-by

- Roger (`@rv61`) — `supabase/migrations/*`
- Kiara (`@ki-dev-piqc`) — `SponsorPage.tsx` one-line insertion
  (sequenced AFTER `plans/kiara/sponsor-mode-v2.md` merges)
- Ishika (`@ish-dev-piqc`) — `docs/CODEOWNERS.md` new ownership lines

## Verification

- [x] `npm run typecheck`, `npm run build`, `npm test` clean (incl. new
  `src/lib/deliverables/__tests__/*`).
- [x] Unit: selection rules (section grouping, content_origin tagging,
  evidence passthrough, prohibited-med gap block); adapter partial-null
  tolerance; `buildDeliverablePdf` (DRAFT watermark, disclaimer,
  traceability appendix, sponsor-name-free) mirroring
  `visitExecutionExportApi.test.ts`.
- [ ] Manual (as protocol owner/org-member): Sponsor → Protocol
  Intelligence → Generate checklist → blocks grouped by section with
  evidence + confidence → Traceability drawer shows section/page/quote →
  edit a block (version bumps, edit-log records) → mark reviewed / flag →
  regenerate (human-edited block preserved) → Export PDF (DRAFT
  watermark, disclaimer, sponsor-name-free filename).
- [ ] RLS: non-member denied on `deliverable_generate` / `_get_packet`;
  owner/org-member succeeds.
- [x] `piqc-review` clean.

## Decisions encoded (don't re-litigate without reading these)

1. **Engine-first, single artifact_type.** Generic tables/RPCs (cheap to
   keep generic), but ONE selection ruleset and ONE PDF builder ship. No
   plugin registry, no second lens, no premature PDF-chrome extraction
   (copy the ~40 lines from VEW; extract only when a second builder
   needs them).
2. **3-way `content_origin` is the point.** Facts carry evidence +
   confidence; framing carries neither (no false provenance); human text
   is never overwritten by regeneration.
3. **Selection is deterministic.** No LLM in Phase 1. Generative framing
   arrives later via the `audit-summary` edge-fn pattern (LLM proposes,
   RPC writes back, human reviews).
4. **Auth via `user_can_access_protocol` + DEFINER generate**, not
   SOTR's owner-only gate (which would make the deliverable invisible to
   sponsors forever).
5. **Draft-only vocabulary.** `review_state` never contains "approved";
   every export says DRAFT + requires-human-review (Issue/CAPA + VEW
   precedent).
6. **Mount = Sponsor sub-tab, not a new mode.** CRA mode is a later
   phase; sponsor oversight is periodic → a tab suffices.
7. **Sequencing:** the `SponsorPage.tsx` touch lands after Kiara's
   sponsor-mode-v2 merges to avoid a conflict on her active scope.
8. `owner:` handle `fable-dev-piqc` is a placeholder until Fable's real
   GitHub account is confirmed — update this file + `docs/CODEOWNERS.md`
   together when it exists.
