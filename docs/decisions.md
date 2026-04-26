# Decisions log

## Format
Each decision is logged as:
- **Status**: open | decided | superseded
- **Question**: what needs to be resolved
- **Options**: candidates considered
- **Decision**: what was chosen (if resolved)
- **Rationale**: why
- **Impact**: what this affects downstream

---

## Open questions (unresolved — do not build past these without human decision)

### D-001 Frontend + backend stack
- **Status**: open
- **Question**: Which frontend framework and backend framework to use?
- **Options**: Next.js full-stack | React + separate API (Node/FastAPI/Rails) | other
- **Impact**: Affects scaffolding, ORM choice, deployment model

### D-002 Protocol tagging mode in v0.1
- **Status**: decided
- **Question**: Is protocol section tagging fully manual, semi-assisted (highlights + human confirm), or parser-assisted?
- **Decision**: Progressive enhancement across phases. Phase 1: manual only. Phase 2: PIQC-assisted (candidate tags from PIQC payload as pre-fill). Phase 3: LLM-assisted proposals with auditor review.
- **Rationale**: Building for billable auditors across all phases. Architecture is suggestion-aware from day one — the same RiskTaggingForm handles all modes; only the suggestion layer changes. This avoids a rework at phase 2/3 boundary.
- **Decided by**: user
- **Date**: 2026-04-20
- **Impact**: `ProtocolRiskObject` gains `taggingMode` (enum: MANUAL | PIQC_ASSISTED | LLM_ASSISTED) and `suggestionProvenance` (Json? — stores suggested vs. confirmed values per field). `RiskTaggingForm` component built with suggestion-aware props from the start. PIQC ingest endpoint designed to optionally accept candidate tags per section — system works without them.

### D-003 Questionnaire template representation
- **Status**: decided
- **Question**: How are questionnaire templates stored and generated?
- **Decision**: Single canonical template, seeded from a generic, unbranded Standard GCP Vendor Questionnaire (no sponsor name baked in — auditors add sponsor branding externally on export). Stored as versioned `QuestionnaireTemplate` + `QuestionnaireQuestion` rows. Each Audit forks a `QuestionnaireInstance` from a template version at start (stable artifact). Section 5.3.x is a dynamic addendum slot auto-populated by the system from mapped VendorServiceMappingObject entries — no pre-seeded domain question bank. Final output is an exportable "first draft" for auditor polish in external tooling (Word/Google Docs); the system does not own final header/footer design.
- **Rationale**: The question set is near-constant across GCP vendor audits; what varies is (a) service-specific addenda and (b) responses. Storing the template relationally gives version control, enables pre-population, and makes response provenance structured. Leaving 5.3.x to the service-mapping-driven generator keeps auditor cognitive load low while matching the actual workflow.
- **Decided by**: user
- **Date**: 2026-04-24
- **Impact**: New models: `QuestionnaireTemplate`, `QuestionnaireTemplateVersion`, `QuestionnaireQuestion`, `QuestionnaireInstance`. `QuestionnaireResponseObject` becomes a child of QuestionnaireInstance, keyed by question_id, with `source` enum (PENDING | AUDITOR_PREFILL_WEB | VENDOR | NOT_APPLICABLE). Addendum generator reads from `VendorServiceMappingObject`. Export endpoint produces docx/markdown. Phase 1: deterministic rule table for 5.3.x. Phase 2: PIQC-assisted. Phase 3: LLM-assisted (same suggestion-aware pattern as risk tagging).

### D-004 SOP parsing and ControlCheckpointObject phasing
- **Status**: open
- **Question**: When does SOP parsing and checkpoint extraction get built relative to workspace MVP?
- **Options**: Phase 1 (manual checkpoint entry only) | Phase 2 (SOP upload + extraction) | Phase 2 with stub checkpoint model in phase 1
- **Impact**: Affects AuditWorkspaceEntryObject checkpoint linkage design

### D-005 Trust posture scoring model
- **Status**: open
- **Question**: How is provisional trust posture represented in TrustAssessmentObject?
- **Options**: Qualitative label (low/medium/high) | Numeric score (1–5) | Multi-axis (compliance posture + maturity posture separately)
- **Impact**: Affects TrustAssessmentObject schema, escalation engine input format

### D-006 Single vs. multi-audit vendor memory
- **Status**: open
- **Question**: Does phase 1 persist state across multiple audits for the same vendor, or stay scoped to a single audit instance?
- **Options**: Single audit scope only | Vendor record with audit history linked
- **Impact**: Affects top-level data model (VendorObject vs. AuditObject as root entity)

### D-007 Evidence attachment model
- **Status**: open
- **Question**: What evidence attachment model is needed now vs. later for traceability and version control?
- **Options**: Phase 1: file upload + manual metadata | Phase 2: versioned evidence with diff tracking
- **Impact**: Affects storage architecture, evidence linkage schema

### D-009 PIQC → Vendor PIQC API contract
- **Status**: open
- **Question**: What is the exact shape of the structured data PIQC sends to Vendor PIQC via API?
- **Context**: PIQC uses Reducto to parse raw clinical trial protocol PDFs into structured JSON. PIQC then domain-maps that output and sends it to Vendor PIQC via an internal API call. The field names, payload shape, section identifiers, and auth method are not yet defined.
- **Must resolve with**: dev team building PIQC
- **Specific questions for dev team**:
  - What fields does PIQC output after processing Reducto's JSON?
  - How are protocol sections identified and keyed (IDs, slugs, hierarchy)?
  - What metadata is available per section (type, page ref, hierarchy level)?
  - What is the API format — REST endpoint, payload shape, auth method?
- **Impact**: Blocks finalization of `ProtocolRiskObject` schema. Do not finalize field names until this is resolved.

### D-008 Coherence engine UI surface
- **Status**: decided
- **Question**: How much of the future coherence engine should be visible in the initial UI, even if not yet automated?
- **Decision**: Phase 1 exposes human-governed fields only (`provisionalImpact`, `provisionalClassification`). No coherence analysis surface, no "coming soon" placeholder. The `riskContextOutdated` flag (system-written on amendment ingestion) surfaces passively as a warning chip on affected entries. All classification is auditor-assigned; no autonomous proposals.
- **Rationale**: No agentic coherence engine exists yet. Surfacing a "coming soon" state adds UI debt and false expectations. The human-governed fields (`ProvisionalImpact` × `ProvisionalClassification`) are the Phase 1 complete surface — coherence analysis layers on top in Phase 3 without requiring UI changes to entry cards.
- **Decided by**: user
- **Date**: 2026-04-26
- **Impact**: `AuditConductWorkspace` exposes impact + classification selects on each entry (human-assigned). Amendment outdated warning chip is the only system-generated surface. No coherence score, no automated flag fields in Phase 1 UI.

---

## Decided

### D-001 Frontend + backend stack
- **Status**: decided
- **Question**: Which frontend framework and backend framework to use?
- **Decision**: Next.js full-stack with PostgreSQL. Prisma as ORM.
- **Rationale**: Full-stack Next.js reduces surface area; Prisma gives typed schema-first migrations compatible with Postgres relational model required by architecture.
- **Decided by**: user
- **Date**: 2026-04-20
- **Impact**: All schema files will be Prisma schema format. Migrations via `prisma migrate`. Type generation via `prisma generate`.

### D-006 Single vs. multi-audit vendor memory
- **Status**: decided
- **Question**: Does phase 1 persist state across multiple audits for the same vendor, or stay scoped to a single audit instance?
- **Decision**: Multi-audit. `Vendor` is the root entity. Each Vendor has many Audits. Each Audit is scoped to one protocol and one vendor service engagement.
- **Rationale**: Auditors manage multiple vendors and multiple audits over time. Single-scope would require a rework of the root model in phase 2.
- **Decided by**: user
- **Date**: 2026-04-20
- **Impact**: `Vendor` table is the top-level root. `Audit` is a child of `Vendor`. All per-audit objects (VendorServiceObject, TrustAssessmentObject, workspace entries, etc.) are scoped via `audit_id`.

### D-010 Unified audit stage model + VendorRiskSummaryObject + approval propagation
- **Status**: decided
- **Question**: How is the auditor's current stage represented? What is the shape of `VendorRiskSummaryObject`? How does approval propagate to downstream drafting?
- **Decision**:
  - **Stage model — A1 collapsed to 8 stages**: Single authoritative `Audit.currentStage` enum. The design's stages 5–7 (Confirmation Letter, Agenda, Checklist) collapse into a single **Pre-Audit Drafting** stage so the auditor moves through one drafting workspace with three tabs/sub-artifacts rather than three separate stage transitions. Final 8 stages: `INTAKE` → `VENDOR_ENRICHMENT` → `QUESTIONNAIRE_REVIEW` → `SCOPE_AND_RISK_REVIEW` → `PRE_AUDIT_DRAFTING` → `AUDIT_CONDUCT` → `REPORT_DRAFTING` → `FINAL_REVIEW_EXPORT`. Per-artifact statuses still exist for fine-grained workflow; `currentStage` is the source of truth for navigation, worklist, and downstream agent gating. Stage transitions are explicit, delta-tracked auditor actions.
  - **VendorRiskSummaryObject — B1 with deterministic stub**: One row per Audit (1:1) with `studyContext` (therapeutic space, primary/secondary endpoints — copied from ProtocolVersion at link time, not duplicated as live FK), `vendorRelevanceNarrative` (auditor-editable text; **populated by a deterministic stub at creation** that concatenates a templated paragraph from `studyContext` + matched `ProtocolRiskObject` operational domains + mapped `VendorServiceObject` types — gives the auditor something concrete to edit down rather than a blank page), `focusAreas[]` (structured operational-domain tags), `protocolRiskRefs[]` (FK array to driving ProtocolRiskObjects), `approvalStatus` (DRAFT | APPROVED), `approvedBy`, `approvedAt`. Future LLM stubs replace the deterministic generator behind the same write-shape.
  - **Approval propagation — direct fields**: `approvedAt` + `approvedBy` added directly on `QuestionnaireInstance` and `VendorRiskSummaryObject`. No generic `ArtifactApproval` table yet — YAGNI; revisit when the third approvable artifact lands.
- **Rationale**: A1 keeps stage state queryable in a single column for the worklist; collapsing to 8 stages matches how the three pre-audit deliverables are co-drafted in practice (the auditor doesn't really finish the confirmation letter before opening the agenda — they cross-reference). B1 with a deterministic stub honors the rule that the system collapses cognitive load to human review wherever possible — auditors edit a draft, not write from blank. Direct approval fields are simpler than a polymorphic table for two artifacts.
- **Decided by**: user
- **Date**: 2026-04-24
- **Impact**:
  - Schema: new `AuditStage` enum (8 values), `Audit.currentStage` field, new `VendorRiskSummaryObject` model with the fields above, `approvedAt`/`approvedBy` added to `QuestionnaireInstance` and `VendorRiskSummaryObject`. `AUDIT`, `VENDOR_RISK_SUMMARY` added to `TrackedObjectType`.
  - Library: `lib/risk-summary.ts` exposing `createRiskSummaryStub(auditId)` (deterministic generator), `updateRiskSummary`, `approveRiskSummary`, `transitionAuditStage`. All writes delta-tracked.
  - API routes: `app/api/audits/[auditId]/risk-summary/route.ts` (GET + PATCH + POST approve), `app/api/audits/[auditId]/stage/route.ts` (PATCH).
  - UI: 3-pane workspace shell (left: stage nav with 8 stages; center: current primary artifact; right: risk summary + traceability). Audit Index/Worklist screen surfaces `currentStage` per row. Pre-Audit Drafting stage is one workspace with three tabs (Confirmation Letter / Agenda / Checklist) — each its own deliverable model in a later task.
  - Sequencing: see `tasks/backlog.md` D-010 entry — schema + risk summary stub → stage model + transitions → 3-pane shell → worklist → individual deliverable workspaces.
- **Sponsor branding rule still applies**: stub narratives, focus-area labels, and any generated draft text must remain sponsor-name-free.

### Template
```
### D-00X [Short title]
- **Status**: decided
- **Question**:
- **Decision**:
- **Rationale**:
- **Decided by**: [human name/role]
- **Date**:
- **Impact**:
```
