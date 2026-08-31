---
owner: sixonelabs-piqc
feature: Evidence Gap Summary (PR-D3) — 5th deliverable kind; non-gating Stage-5 tab grounded in the evidence register + risk domains + checklist
status: active
started: 2026-08-30
target_pr:
---

# Evidence Gap Summary (PR-D3)

## Context

Nine-deliverables queue (handover v3): UX1 #557, UX2 #559, D1 #561 merged. D2 (deliverable
plan) is skipped-not-dropped — its gate-RPC `CREATE OR REPLACE` is held for the migrations
partner. D3 is v8's `evidence_gap_summary`: a generated document that checks scope coverage
against collected evidence and lists what is outstanding — per scope area, what evidence
exists and what has not arrived. It supersedes v1's `audit_evidence_requests` lifecycle
("outstanding" lines in this document ARE the request tracking). 5th `DeliverableKind` in
the consolidated engine, 5th Stage-5 tab, **non-gating** — the 5→6 gate stays exactly
{letter, agenda, checklist}.

**Mental model.** Workflow stage: pre-audit drafting (stage 5). Operator: lead auditor.
Source of truth: new `evidence_gap_summary_objects` row (1:1 with audit), DRAFT/APPROVED
latch, demote-on-edit — the D1 lifecycle verbatim. Provenance: generation refs + grounding
snapshot via the apply-RPC pattern; deltas under a new `EVIDENCE_GAP_SUMMARY_OBJECT`
tracked type. Failure mode if wrong: the summary claims evidence exists that doesn't (or
silently omits withheld evidence, making coverage look worse than the auditor chose it to
be) — mitigated by grounding the prompt in the actual register listing and naming withheld
docs as withheld. Human review point: the tab's Approve latch. Smallest safe path:
letter-shaped content (`body_text` + `scope`), no prefill, no stub, no new content shape.

**Key shape decision (altitude).** `shape: 'letter'`, `blobRefId: 'gap_summary'`,
`revisionHeading: 'CURRENT SUMMARY'`. NOT a third shape and NOT `'items'`: the engine's
items branch is a hardcoded checklist-vs-agenda ternary (index.ts:151, :630, :641-680 — a
5th items kind silently gets agenda field shaping), and a third shape would ripple through
four engine branch sites plus `applyDeliverableGeneration`'s binary letter/items arm. The
per-domain structure is prompt-enforced prose reviewed by a human — the same honesty model
as every letter kind, and the handover's deferred ledger already blesses "outstanding
lines in the gap summary" as text rather than tracked state.

**What makes D3 bigger than D1 (verified against main @ 6cd9500).** D1 was config-only in
the engine; D3 is not. Three context-assembly additions, all scoped to this kind only
(other kinds' context stays byte-identical):

1. **Risk domains**: nothing in the engine fetches `vendor_risk_summary_objects` today.
   Gap-summary requests additionally fetch the risk summary's `focus_areas` (approved
   or not — see the no-gate ledger decision below) and the junction rows →
   `protocol_risk_objects` (`section_identifier`, `section_title`,
   `operational_domain_tag`) — these free-text domains are the "scope areas" the
   coverage listing is organized by. `study_context` is deliberately not fetched.
2. **Checklist items**: index.ts:391 reads only the kind's own table. Gap-summary requests
   additionally read `checklist_objects.content.items` (prompt + `evidence_expected`) —
   the "what is outstanding" basis.
3. **Withheld evidence**: index.ts:420 currently discards `include_in_generation = false`
   register rows before anything reaches the prompt — withheld docs are silently absent
   from every deliverable. For the gap summary the register listing carries BOTH lists:
   included docs (title + status) and withheld docs as **titles only, marked withheld** —
   their content is never retrieved (withholding keeps content out of generation; that
   boundary is the point of the lever). Passage retrieval (hybrid_search) continues to run
   over included docs only, unchanged.

**Currency decision (revised by the adversarial review).** The snapshot's `evidence`
field keeps recording **included** docs only (legacy semantics, shared with all kinds),
which covers the withhold/include toggle directions. But the review confirmed two blind
axes unique to this kind: a doc filed *as withheld* after generation appears in neither
diff set (summary stale, UI says current), and checklist/scope edits never touch
currency at all. So the gap kind's snapshot additionally persists `register` (full
listing incl. withheld flags) and `checklist_item_ids` — opaque extra fields today's
`computeDeliverableCurrency` ignores — and the client slice adds a kind-aware
comparison gated on presence of those fields (legacy snapshots and other kinds
byte-identical).

## Scope (files allowed)

- supabase/migrations/20260905000000_audit_evidence_gap_summary_schema.sql (NEW — `ALTER TYPE tracked_object_type ADD VALUE IF NOT EXISTS 'EVIDENCE_GAP_SUMMARY_OBJECT'`; `evidence_gap_summary_objects` cloning internal_notification_objects (20260904000000) with the generation columns inline; touch trigger; via-audit RLS. Enum in its own file per the same-transaction hazard, documented at 20260904000000:15-17)
- supabase/migrations/20260905000100_audit_evidence_gap_summary_rpcs.sql (NEW — `audit_mode_can_view_tracked_object` replaced with the new ELSIF branch, cloned from its LATEST version in 20260904000100; `audit_mode_upsert_evidence_gap_summary` (demote-on-edit, incl. `approved_at`/`approved_by` in the demote diff like D1's); `audit_mode_approve_evidence_gap_summary` (CAS `p_expected_updated_at`); `audit_mode_apply_evidence_gap_summary_generation`; grants)
- supabase/functions/audit-deliverable-draft/index.ts (5th DELIVERABLES entry `shape:'letter'`; gap-summary-only context assembly: risk summary + junction fetch, checklist_objects fetch, withheld-titles list from the register select at :410-428; `buildUserMessage` gains the gap-summary context block — register listing with withheld markers, scope areas, checklist expectations)
- supabase/functions/audit-deliverable-draft/prompts.ts (EVIDENCE_GAP_SUMMARY_PROMPT — per-scope-area coverage listing: evidence present (cite register/E passages), outstanding (checklist items expecting evidence with none), withheld docs named as withheld; factual and even, no adequacy verdicts; same SHARED_RULES spine + `REVISION MODE (when CURRENT SUMMARY is provided)`)
- src/types/audit/enums.ts (TrackedObjectType + 'EVIDENCE_GAP_SUMMARY_OBJECT')
- src/types/audit/objects.ts (DeliverableGenerationRef item_id doc gains 'gap_summary'; DeliverableGroundingSnapshot gains OPTIONAL `register`/`checklist_item_ids` fields for the revised currency decision — absent on legacy snapshots)
- src/lib/audit/mockPreAudit.ts (MockEvidenceGapSummaryContent/MockEvidenceGapSummary interfaces; MockPreAuditBundle 5th field; header comment "Four" → "Five". **Interfaces-only — see sequencing precondition**)
- src/lib/audit/preAuditApi.ts (5th query + error line + flattener (no prefill fields) + return key in fetchPreAuditDeliverables; upsertEvidenceGapSummary/approveEvidenceGapSummary wrappers; prefillStage5Deliverables stays trio-only)
- src/lib/audit/deliverableGenerationApi.ts (DeliverableKind union; KIND_SHAPE/APPLY_RPC/DRAFT_NOUN — all three are exhaustive Records, compiler-forced; apply content flows through the existing letter arm untouched)
- src/lib/audit/lineageAdapter.ts (LineageEntityType + 'EVIDENCE_GAP_SUMMARY'; the two hand-written unions at :293-301; 5th deliverables entry — the no-prefill guards already handle it)
- src/components/dashboard/audit/TraceabilityDrawer.tsx (ENTITY_LABELS (Record, compiler-forced) + FILTER_GROUPS DELIVERABLES membership (NOT type-checked — silent-drop hazard, must not forget); fix the stale ":54 13 raw entity types" comment in passing)
- src/components/dashboard/audit/stages/PreAuditDraftingWorkspace.tsx (5th TabKey + TAB_DEFS entry `gating: false` (gate list + allApproved derive from TAB_DEFS — zero gate changes); EMPTY_BUNDLE; approvalStatuses; persistEvidenceGapSummary wrapper (persistDeliverable's generic widens automatically); PANEL_NOUNS + generation-panel deliverable union; EvidenceGapSummaryTab cloning InternalNotificationTab incl. preview guard; `allMissing` conjunction gains the 5th kind (hand-written — an existing row must not hide behind the stub screen); header/empty-state copy "Four/four" → "Five/five"; notification-first escape hatch stays notification-only)
- src/components/dashboard/audit/stages/FinalReviewExportWorkspace.tsx (one `push('Evidence gap summary', …)` line at :110)
- src/lib/audit/__tests__/preAuditApi.test.ts (extend: upsert/approve pair incl. CAS/STALE_CONTENT, mirroring the D1 section)
- src/lib/audit/__tests__/deliverableGenerationApi.test.ts (extend: gap summary routes letter-shaped to `audit_mode_apply_evidence_gap_summary_generation`)
- src/lib/audit/__tests__/lineageAdapter.test.ts (fixture 5th field; gap-summary node test; the exhaustive trackedObjectType test covers it)
- src/lib/audit/__tests__/lineageApi.test.ts (fixture 5th field — typed literal, will not compile without it)
- src/components/dashboard/audit/stages/__tests__/PreAuditDraftingWorkspace.test.tsx (vi.mock gains the two new fns — module mock is incomplete without them; bundle literals; extend D1 section: 5th tab renders, advance stays enabled with trio approved + gap summary absent/DRAFT, gate list never names it, preview guard)
- src/components/dashboard/audit/stages/__tests__/FinalReviewExportWorkspace.test.tsx (currency-panel test for the 5th push; local bundle type is optional-keyed so existing literals survive)
- plans/sixonelabs-piqc/audit-evidence-gap-summary.md (this file)

## Out of scope (files forbidden)

- 20260730000000 gate/readout RPCs and `audit_mode_advance_audit_stage` — never gates (D2 owns gate changes, held for the partner)
- Prefill RPCs / stub creators — no prefill, no stub for this kind (empty state = manual edit or Draft with PIQC)
- Any UI for toggling `include_in_generation` (the withhold lever still has no writer — separate feature if asked)
- `computeDeliverableCurrency`'s legacy behavior for the four existing kinds (the client slice may only ADD a gap-kind comparison gated on presence of the new snapshot fields)
- The engine's items-branch ternaries (letter shape sidesteps them; refactor only when an items-shaped 5th+ kind actually lands)
- src/context/** (bundle flows through `Record<string, MockPreAuditBundle>` untouched)
- Other modes (sotr/site); other stage workspaces
- Editing any merged migration

## Sequencing precondition

The two dead-code branches (`sixonelabs-piqc/audit-mock-preaudit-dead-code`,
`sixonelabs-piqc/audit-mock-dead-constants`) must merge BEFORE D3's implementation slices:
the first deletes the dead `MOCK_PRE_AUDIT` constant (mockPreAudit.ts:160-295). Until it
lands, adding a required 5th field to `MockPreAuditBundle` would force `evidence_gap_summary:
null` entries inside that constant — a guaranteed delete-vs-modify conflict. After they
merge: `git merge main` into this branch, then mockPreAudit.ts is an interfaces-only edit.
This plan commit is intentionally the only commit until then (no stacked-PR violation —
nothing here depends on the dead-code diffs).

## Architecture layers touched

- [x] migration (additive: enum value, new table, new RPCs; the only CREATE OR REPLACE is `audit_mode_can_view_tracked_object` gaining one ELSIF — behavior-preserving for every existing type, same precedent D1 set)
- [x] RPC (edge function + .sql)
- [ ] adapter
- [ ] context
- [x] component
- [x] test

## Mock data plan

none

## Approved-by

- @karl-dev-piqc — src/lib/audit/**, src/components/dashboard/audit/**, src/types/audit/**
- @rv61 (self) — supabase/**

## Decision debt ledger

- **Scope-areas decision (handover deferred item, resolved here)**: risk-summary
  `focus_areas` + per-risk `operational_domain_tag`s ARE the scope areas — no parallel
  free-text scope field. Revisit only if users ask to define audit scope independently of
  the risk summary.
- **Withheld = titles only, by design**: a withheld doc contributes its register title and
  the "withheld" marker to the prompt, never content or passages. If users want withheld
  docs summarized, that's a deliberate un-withholding, not a D3 change.
- **No approved-risk-summary requirement**: the gap summary generates from whatever risk
  summary exists (approved or not) plus the register; if no risk summary exists the prompt
  organizes by register + checklist only. Honest degradation over a hard prerequisite —
  v8 declares no upstream prerequisite for this deliverable. Revisit if users expect the
  gate.
- **D2 plan-awareness deferred**: tab always shown until D2 lands (all-in-scope default
  matches D2's absent-row semantics; D2 wires one more tab when it lands).
- **Engine items-branch blind spot recorded**: `shape:'items'` field layout is a
  checklist-vs-agenda ternary, not kind-generic. First future items-shaped kind must
  generalize it (trigger: that PR).
- **Edge-fn deploy debt inherited**: generation for the new tab is dead on hosted until
  `audit-deliverable-draft` is redeployed (already on the outstanding list; each D-PR
  touching the engine re-deploys it). Manual draft/approve/deltas/currency work once
  migrations are applied.
- **Vacation constraint honored**: both migrations additive/self-appliable via the
  dashboard SQL editor, apply in order (schema first). NOTE: D1's pair (20260904000000/
  000100) must be applied BEFORE this merges — the ≤1-unapplied-stack rule is already at
  its limit.
- **Inherited, not fixed here** (from D1's ledger, all still true for the 5th kind):
  provenance survives human rewrite; phantom-id approve race; `fetchPreAuditDeliverables`
  swallows per-table errors (the 5th query follows the existing semantics); 5× (now)
  duplicate `user_profiles` lookups when all rows approved.

### From the slice-1/2 adversarial review (accepted, not fixed here)

- **SQL lifecycle is a 5th verbatim clone** (upsert / CAS approve / apply-generation,
  plus the 21-branch visibility-helper re-paste). Already-diverging: D1's demote-diff
  improvement exists in D1+D3 but not the trio. Depth-correct fix is one generic
  `audit_mode_upsert_deliverable`/`approve_deliverable` pair dispatching on a kind→table
  map — a live-RPC rework for the migrations partner. Trigger: the 6th kind, or her
  return, whichever first.
- **CAS staleness on no-op saves** (all five letter/notification-family kinds, cloned
  from D1): a byte-identical re-save moves `updated_at` (touch trigger) without writing
  a delta, so a held `p_expected_updated_at` fails approve with STALE_CONTENT for
  content that provably didn't change. Proper fix is trigger- or upsert-level no-op
  detection — partner's-return migration.
- **Client currency filter lacks the engine's `kind === 'AUDIT_EVIDENCE'` filter**
  (pre-existing, all kinds): a non-evidence doc in `audit_source_documents` with
  `include_in_generation=true` is permanently flagged `newSinceGeneration`. Fix when
  next touching `computeDeliverableCurrency` (the D3 client slice is a natural moment).
- **Names-in-titles is a prompt-level soft control**: the gap prompt now instructs
  referring to person-titled documents by type + non-name detail, but freetext titles
  have no mechanical name scrubber and a bad model call persists into the append-only
  trail. Durable fix if this ever bites: a doc-type/role field on the register instead
  of raw titles reaching the prompt. Trigger: any name observed in a generated summary.
- **Register cap discloses, withheld rows exempt**: on-file rows past
  `GAP_MAX_REGISTER_DOCS` (120) are dropped deterministically (newest-first order) and
  the count is disclosed to the model; withheld rows are never dropped. Revisit the cap
  if real registers approach it.

## Verification

CI-first: no Node/npm/tsc/vitest on the authoring machine — CI is where typecheck and
tests first execute.

E2E (user, after applying both migrations + redeploying the edge fn):
1. Vendor audit at Stage 5 → 5th tab "Evidence gap summary" appears with an empty edit
   form; header copy says five deliverables, gap summary optional.
2. Manual draft → Save → row persists; HistoryDrawer shows the create delta; Approve
   latches; editing demotes to DRAFT with a delta.
3. Draft with PIQC → per-scope-area coverage listing lands as DRAFT with refs: evidence
   present cites register docs; outstanding items trace to checklist expectations;
   a register row with `include_in_generation = false` is named as **withheld** (by
   title), not silently absent, and none of its content appears.
4. Approve only letter+agenda+checklist (gap summary left DRAFT/absent) → advance to
   Stage 6 still unlocks; the gate list never mentions the gap summary.
5. Stage-8: currency panel lists "Evidence gap summary" once PIQC-drafted; adding or
   withholding a register doc after generation flags it stale.
6. One-ahead preview from Stage 4: 5th tab shows "Nothing recorded yet", CTA disabled,
   no writes.
7. Traceability drawer: gap-summary node appears under the Deliverables filter group.
