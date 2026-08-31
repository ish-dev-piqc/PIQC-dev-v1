---
owner: sixonelabs-piqc
feature: Internal audit notification (PR-D1) — 4th kind in the consolidated deliverable engine; non-gating Stage-5 tab
status: active
started: 2026-08-30
target_pr:
---

# Internal audit notification (PR-D1)

## Context

Nine-deliverables queue (handover v3): UX1 #557 + UX2 #559 merged; D1 is next. v8's
`internal_audit_notification` is the cheapest missing deliverable: a short document
addressed to INTERNAL stakeholders announcing the upcoming vendor audit and explicitly
**inviting scope input before the opening meeting** (that invitation framing is the
deliverable's point — keep it). It becomes the 4th `DeliverableKind` in the consolidated
`audit-deliverable-draft` engine and the 4th tab in Stage 5. It does **NOT** gate stage
advance — the 5→6 gate stays exactly {letter, agenda, checklist} (server readout
20260730000000 untouched; client `allApproved` untouched).

**Mental model.** Workflow stage: pre-audit drafting (stage 5). Operator: lead auditor.
Source of truth: new `internal_notification_objects` row (1:1 with audit), DRAFT/APPROVED
latch, demote-on-edit — identical lifecycle to the letter. Provenance: generation refs +
grounding snapshot via the existing apply-RPC pattern; deltas via `audit_mode_write_delta`
under a new `INTERNAL_NOTIFICATION_OBJECT` tracked type. Failure mode if wrong: a
fabricated study-specific claim in an internal notice — mitigated by the same
verbatim-quote gate every kind rides. Human review point: the tab's Approve latch.
Smallest safe path: letter-shaped content (`body_text` + `scope`), **no recipients field**
(internal distribution happens outside PIQC; roles-only addressing keeps the deliverable
name-free end to end — one fewer names surface than the letter).

**Key shape decision (altitude).** The engine's `kind === "confirmation_letter"` special
cases become a `shape: 'letter' | 'items'` field on the `DELIVERABLES` config — the
notification is the second letter-shaped kind, so the branch generalizes instead of
gaining `|| kind === "internal_notification"` sprinkles.

## Scope (files allowed)

- supabase/migrations/20260904000000_audit_internal_notification_schema.sql (NEW — `ALTER TYPE tracked_object_type ADD VALUE IF NOT EXISTS 'INTERNAL_NOTIFICATION_OBJECT'`; `internal_notification_objects` table cloning confirmation_letter_objects WITH the three generation columns inline; touch trigger; via-audit RLS. Enum in its own file per the 20260707000200 same-transaction hazard precedent)
- supabase/migrations/20260904000100_audit_internal_notification_rpcs.sql (NEW — `audit_mode_can_view_tracked_object` replaced with the new ELSIF branch, cloned from its LATEST version in 20260725000100 (not phase-1); `audit_mode_upsert_internal_notification` (demote-on-edit, from 20260430170000's letter upsert); `audit_mode_approve_internal_notification` (CAS `p_expected_updated_at`, cloned from 20260730000000's letter approve — NOT the pre-CAS phase-1 shape); `audit_mode_apply_internal_notification_generation` (from 20260901000000); grants)
- supabase/functions/audit-deliverable-draft/index.ts (kind union + config map + `shape` field; allowlist; letter-branch generalization; 502-on-empty guard covers the new kind via the shared letter-shaped branch)
- supabase/functions/audit-deliverable-draft/prompts.ts (INTERNAL_NOTIFICATION_PROMPT — internal stakeholders, roles only, invite scope input before the opening meeting; same SHARED_RULES spine)
- src/types/audit/enums.ts (TrackedObjectType + 'INTERNAL_NOTIFICATION_OBJECT')
- src/types/audit/objects.ts (comment-only if at all — DeliverableGenerationRef item_id doc gains the 'notification' constant)
- src/lib/audit/mockPreAudit.ts (MockInternalNotificationContent/MockInternalNotification types; MockPreAuditBundle field; `internal_notification: null` on the three seeded demo entries — type-mirror ripple, not new mock data)
- src/lib/audit/preAuditApi.ts (flatten + fetch 4th query + upsert/approve wrappers; NO prefill for this kind)
- src/lib/audit/deliverableGenerationApi.ts (kind union, APPLY_RPC, DRAFT_NOUN, apply content branch without recipients merge)
- src/lib/audit/lineageAdapter.ts (LineageEntityType + 4th deliverable node entry)
- src/components/dashboard/audit/TraceabilityDrawer.tsx (ENTITY_LABELS + filter-group membership for the new entity type)
- src/components/dashboard/audit/stages/PreAuditDraftingWorkspace.tsx (4th TabKey + TAB_DEF; InternalNotificationTab cloning ConfirmationLetterTab minus recipients; persist fn; generation panel wiring incl. preview guard; gating list split so the transition panel keeps listing exactly the three gating kinds; header copy updated to say the notification is optional)
- src/components/dashboard/audit/stages/FinalReviewExportWorkspace.tsx (currency panel `push('Internal notification', …)` — the export-panel visibility the handover asks for)
- src/lib/audit/__tests__/preAuditApi.test.ts (extend)
- src/lib/audit/__tests__/deliverableGenerationApi.test.ts (extend)
- src/lib/audit/__tests__/lineageAdapter.test.ts (extend if fixtures need the bundle field — type ripple)
- src/components/dashboard/audit/stages/__tests__/PreAuditDraftingWorkspace.test.tsx (extend: 4th tab renders; advance stays enabled with the trio approved + notification absent/DRAFT; preview guard on the new tab)
- src/components/dashboard/audit/stages/__tests__/FinalReviewExportWorkspace.test.tsx (fixture ripple for the bundle field)
- src/lib/audit/__tests__/*.test.ts fixture ripples where MockPreAuditBundle literals exist
- plans/sixonelabs-piqc/audit-internal-notification.md (this file)

## Out of scope (files forbidden)

- 20260730000000 gate/readout RPCs and `audit_mode_advance_audit_stage` — the notification never gates (D2 owns gate changes, held for the migrations partner)
- Prefill RPCs / 20260515020000 pattern — no templated prefill for this kind (empty state = manual edit or Draft with PIQC)
- src/context/** (bundle type flows through `Record<string, MockPreAuditBundle>` untouched)
- Any recipients/personnel-names field on the new deliverable
- Other modes (sotr/site); ScopeReview/QuestionnaireReview/other stage workspaces
- Editing any merged migration

## Architecture layers touched

- [x] migration (`supabase/migrations/` — additive: enum value, new table, new RPCs; the only CREATE OR REPLACE is `audit_mode_can_view_tracked_object` gaining one ELSIF branch, behavior-preserving for every existing type)
- [x] RPC (edge function + .sql)
- [ ] adapter
- [ ] context
- [x] component
- [x] test

## Mock data plan

none (the `internal_notification: null` additions to `MOCK_PRE_AUDIT` are the type mirror for the existing gated demo set, not new mock data)

## Approved-by

- @karl-dev-piqc — src/lib/audit/**, src/components/dashboard/audit/**, src/types/audit/**
- @rv61 (self) — supabase/**

## Decision debt ledger

- **Deliverable plan awareness** deferred to D2 — until then the notification tab is always shown (all-in-scope default matches D2's absent-row semantics).
- **No distribution/recipients list** — revisit only if users ask to track internal recipients; today's honest model is roles-only text.
- **Edge-fn deploy debt** — generation for the new tab cannot work on the hosted site until `audit-deliverable-draft` is (re)deployed (handover §6; not this PR's to run). Everything non-generation (manual draft, approve, deltas, currency panel) works once the migrations are applied.
- **Vacation constraint honored** — both migrations are additive/self-appliable via the dashboard SQL editor; apply BOTH in order at merge (schema first). The visibility-helper replace is the one function replace; it only appends a branch.

## Verification

CI-first: no Node/npm/tsc/vitest on the authoring machine — CI is where typecheck and tests first execute.

E2E (user, after applying both migrations + deploying the edge fn):
1. Vendor audit at Stage 5 → 4th tab "Internal notification" appears with an empty edit form; header copy says it's optional.
2. Manual draft → Save → row persists; HistoryDrawer shows the create delta; Approve latches; editing demotes to DRAFT with a delta.
3. Draft with PIQC → body + scope proposal lands as DRAFT with refs; Revise respects existing text; no personnel names in output.
4. Approve only letter+agenda+checklist (notification left DRAFT) → advance to Stage 6 still unlocks; transition list never mentions the notification.
5. Stage-8: currency panel lists "Internal notification" once it was PIQC-drafted; register change flags it; export gates unchanged.
6. Stage-4 audit previewing Stage 5 (one-ahead): new tab shows "Nothing recorded yet", CTA disabled, no writes.
