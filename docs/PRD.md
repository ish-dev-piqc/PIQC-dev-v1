# Vendor PIQC — Product Requirements Document

## Project overview
Build Vendor PIQC as a protocol-aware audit cognition system for GxP vendor audits. The first product is a structured auditor workspace anchored to a minimal protocol risk spine so the system can carry risk context from protocol review into questionnaire design and later audit execution, reducing auditor cognitive load while creating the substrate for later agentic behavior.

## Goals
- Create a minimal structured protocol mapping layer that captures vendor-relevant risk context from a clinical trial protocol
- Build a structured auditor workspace that replaces free-text note taking with relational, evidence-linked audit entries
- Support the vendor audit lifecycle upstream from audit execution, beginning with protocol-to-vendor service mapping and questionnaire drafting
- Preserve structured state across phases so later modules can add adaptive agentic behaviors without reworking the data model
- Enable future agentic functions including risk-adaptive scope generation, trust recalibration, evidence-weighted observation support, and process–deliverable coherence detection
- Keep all judgment human-governed; system proposes and structures reasoning but does not autonomously classify or finalize findings

## Agentic workflow

### 1. Protocol risk structuring
- Input: uploaded protocol
- User manually tags protocol sections into a minimal risk schema
- Required fields per protocol section:
  - `endpoint_tier`: primary | secondary | safety | supportive
  - `impact_surface`: data_integrity | patient_safety | both
  - `time_sensitivity`: true | false
  - `vendor_dependency_flag`: one or more vendor/service types
  - `operational_domain_tag`: e.g. ECG, imaging, ePRO, randomization, lab
- Output: `ProtocolRiskObject[]`

### 2. Vendor service mapping
- User defines the vendor service under review
- System links vendor service to relevant protocol risk objects
- Output includes derived vendor criticality context for downstream use
- Output: `VendorServiceObject` and `VendorServiceMappingObject`

### 3. Trust mode: front-end vendor intelligence review
- User records initial public-facing intelligence from vendor website and materials
- This is not autonomous web research; it is a structured capture layer for auditor judgment
- Fields include certifications claimed, regulatory/compliance claims, maturity posture, provisional trust posture, and risk hypotheses
- Output: `TrustAssessmentObject`

### 4. Questionnaire design support
- Questionnaire is drafted based on protocol risk context + vendor service mapping + trust assessment
- The system should eventually support risk-weighted questionnaire generation, but initial version can be structured templates tied to mapped protocol/service domains
- Questionnaire responses are captured in structured form with evidence attachments and inconsistency tagging
- Output: `QuestionnaireResponseObject[]`

### 5. Verify mode: structured auditor workspace
- During questionnaire review and later remote/onsite audit execution, auditor creates structured workspace entries instead of unstructured notes
- Each entry links to protocol section, vendor domain, optional SOP checkpoint, evidence, deliverable, and provisional impact/classification state
- Risk attributes should auto-inherit from linked protocol/service objects
- Output: `AuditWorkspaceEntryObject[]`

### 6. Future agentic behaviors (layered on structured state)
- Risk-adaptive scope generator: recommend agenda depth/focus based on protocol and vendor criticality
- Dynamic trust escalation engine: increase scrutiny when inconsistencies appear across trust and verify phases
- Evidence-weighted observation support: propose provisional classification based on impact and evidence completeness, always human-confirmed
- Process–deliverable coherence engine: compare written process, verbal/process notes, and deliverable evidence to flag systemic quality drift

#### Guardrails for all future agentic behaviors
- No autonomous finding finalization
- No black-box severity scoring
- No autonomous vendor communication
- Recommendations must be explainable and editable by auditor

## Tech stack & integrations
- Web app with protocol upload and structured UI workflows
- LLM support may be used later; initial architecture must be schema-first and relational, not prompt-first
- Use deterministic, explainable logic first for coherence/risk flags before adding LLM reasoning
- Database must support relational linking and versioned state changes
- Evidence/document attachments must be linked to structured objects and checkpoint IDs
- Stripe is part of the broader product context for user access/payment, but not required for first build
- Remote/onsite audit note capture should support future transcript or interview-note ingestion; initial version relies on manual structured entry

## Key constraints & decisions
- Start with Vendor PIQC mode, not investigator site mode
- The first build priority is the Structured Auditor Workspace
- A minimal Protocol Risk Spine v0.1 must exist first so the workspace can inherit risk context automatically
- Build upstream continuity: protocol review → vendor service mapping → front-end trust assessment → questionnaire review → audit execution
- Do not build this as a chatbot or generic AI assistant
- Do not store critical reasoning as unstructured text blobs only — use explicit relational objects
- Do not build autonomous judgment features yet
- Do not overbuild the protocol ontology; only include the minimum fields needed to anchor workspace cognition
- All risk/trust/escalation changes must be stored as state deltas/history so later agentic modules can reuse them
- Agentic should be framed as stateful, human-governed structured decision support, not autonomous audit execution

## Open questions
- Which exact frontend stack and backend framework should be used for implementation
- Whether protocol tagging in v0.1 is fully manual, semi-assisted, or parser-assisted
- How questionnaire templates should be represented: static schema, rule-based generator, or editable template library
- How SOP parsing and ControlCheckpointObject extraction should be phased in relative to the workspace MVP
- What scoring or representation should be used for provisional trust posture in TrustAssessmentObject
- Whether phase 1 should persist memory across multiple audits for the same vendor, or stay scoped to a single audit instance
- What evidence attachment model is needed now versus later for audit traceability and version control
- How much of the future coherence engine should be visible in the initial UI, even if not yet automated

## First task for Claude Code
Create a technical design and initial code scaffold for the core relational data model implementing `ProtocolRiskObject`, `VendorServiceObject`, `VendorServiceMappingObject`, `TrustAssessmentObject`, `QuestionnaireResponseObject`, and `AuditWorkspaceEntryObject`, including migrations/schema definitions, object relationships, and versioned state history support.
