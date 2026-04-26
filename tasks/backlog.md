# Backlog

## Phase 1 — Protocol Risk Spine + Workspace MVP

### Next after data model
- [ ] Protocol upload UI + manual section tagging interface (ProtocolRiskObject creation)
- [ ] Vendor service definition + mapping UI (VendorServiceObject + VendorServiceMappingObject)
- [ ] Trust mode UI — structured capture of vendor intelligence (TrustAssessmentObject)
- [ ] Questionnaire template system — first version (see D-003)
- [ ] Questionnaire response capture UI with evidence attachment
- [ ] Audit Workspace (Verify mode) — entry creation, risk auto-inheritance, evidence linking
- [ ] State history viewer — auditor-facing trail of changes per object
- [ ] Basic auth + user model (auditor identity for actor_id on state deltas)

### D-010 build sequence — Stage model + VendorRiskSummaryObject + approval propagation
**Decided 2026-04-24.** Build in this order — each step gates the next. Do not jump ahead.

**1. Schema additions** (single migration `d010_stage_and_risk_summary`)
- [ ] Add `AuditStage` enum: `INTAKE`, `VENDOR_ENRICHMENT`, `QUESTIONNAIRE_REVIEW`, `SCOPE_AND_RISK_REVIEW`, `PRE_AUDIT_DRAFTING`, `AUDIT_CONDUCT`, `REPORT_DRAFTING`, `FINAL_REVIEW_EXPORT`
- [ ] Add `Audit.currentStage AuditStage @default(INTAKE)` (keep existing `Audit.status` — coarse health flag, not workflow position)
- [ ] Add `VendorRiskSummaryObject` model: `id`, `auditId` (1:1 unique), `studyContext` (Json — therapeutic space + endpoints copied at link time), `vendorRelevanceNarrative` (Text), `focusAreas` (Json — operational-domain tag array), `protocolRiskRefs` (relation table to ProtocolRiskObject), `approvalStatus` (DRAFT | APPROVED), `approvedBy` (String?), `approvedAt` (DateTime?), `createdAt`, `updatedAt`
- [ ] Add `approvedBy` / `approvedAt` to `QuestionnaireInstance` (existing `COMPLETE` status is not the same as approved)
- [ ] Add `AUDIT`, `VENDOR_RISK_SUMMARY` to `TrackedObjectType`
- [ ] Run migration; regenerate Prisma client

**2. Risk summary library + deterministic stub**
- [ ] `lib/types/risk-summary.ts` — Zod schemas + input/output types
- [ ] `lib/risk-summary.ts` — `createRiskSummaryStub(auditId)` (deterministic generator: composes a paragraph from copied `studyContext` + matched ProtocolRiskObject operational domains + mapped VendorServiceObject types — sponsor-name-free), `getRiskSummary`, `updateRiskSummary`, `approveRiskSummary`. All writes delta-tracked
- [ ] Wire creation: when an Audit reaches `SCOPE_AND_RISK_REVIEW`, auto-create the stub if missing

**3. Stage transition library**
- [ ] `lib/audit-stage.ts` — `transitionAuditStage(auditId, toStage, actorId)` with linear-progression guards (no skipping forward without explicit override; backward allowed). Delta-tracked. Enforce gates: cannot enter `PRE_AUDIT_DRAFTING` until QuestionnaireInstance + VendorRiskSummaryObject both APPROVED

**4. API routes**
- [ ] `app/api/audits/[auditId]/risk-summary/route.ts` — GET + PATCH (edit narrative/focus areas) + POST `/approve`
- [ ] `app/api/audits/[auditId]/stage/route.ts` — PATCH (transition)
- [ ] `app/api/audits/[auditId]/questionnaire/approve/route.ts` — POST (sets approvedAt/approvedBy on QuestionnaireInstance)

**5. UI shell**
- [ ] `components/workspace/AuditWorkspaceShell.tsx` — 3-pane layout: left stage nav (8 stages, current highlighted, gates visualized), center primary artifact slot, right risk summary + traceability
- [ ] `components/workspace/StageNav.tsx` — clickable stages with gate state
- [ ] `components/workspace/RiskSummaryPanel.tsx` — read/edit + approve, uses stub on first load
- [ ] Per-stage center components: reuse `QuestionnaireWorkspace` for `QUESTIONNAIRE_REVIEW`; placeholder for others

**6. Audit Index / Worklist (Screen 1)**
- [ ] `app/audits/page.tsx` — table view with study/protocol, vendor, service category, tentative date, currentStage, draft status. No queue gymnastics — keep flat
- [ ] `app/audits/new/page.tsx` — Audit Intake (Screen 2). Uses existing audit creation API

**7. Pre-Audit Drafting workspace** (collapsed stages 5–7 from design)
- [ ] Single workspace at `PRE_AUDIT_DRAFTING` stage with 3 tabs: Confirmation Letter / Agenda / Checklist. Each tab's deliverable model (`ConfirmationLetterObject`, `AgendaObject`, `ChecklistObject`) is its own follow-up task — schema scaffolding only in this pass
- [ ] Each deliverable has `approvedAt`/`approvedBy`; downstream `REPORT_DRAFTING` reads from approved deliverables

### Gating decisions needed before build (see docs/decisions.md)
- D-001: Stack — blocks all scaffolding ✓ decided
- D-002: Protocol tagging mode — blocks protocol upload UI ✓ decided
- D-003: Questionnaire template format — blocks questionnaire UI ✓ decided
- D-006: Single vs. multi-audit scope — blocks top-level data model root ✓ decided
- D-009: PIQC → Vendor PIQC API contract — blocks ProtocolRiskObject schema finalization
- D-010: Stage model + risk summary + approval ✓ decided

---

## Phase 2 — SOP Integration + Coherence Stubs

- [ ] SOP upload + ControlCheckpointObject extraction (D-004)
- [ ] Checkpoint linkage in AuditWorkspaceEntryObject
- [ ] Evidence versioning model (D-007)
- [ ] Coherence engine UI stubs (D-008)
- [ ] Inconsistency flagging logic (deterministic, pre-LLM)

---

## Phase 3 — Agentic Layer

- [ ] Risk-adaptive scope generator
- [ ] Dynamic trust escalation engine
- [ ] Evidence-weighted observation support (always human-confirmed)
- [ ] Process–deliverable coherence engine
- [ ] LLM integration (layered on structured state, not replacing it)

---

## Out of scope (for now)
- Investigator site mode
- Stripe / payment integration
- Autonomous finding finalization
- Any black-box scoring
