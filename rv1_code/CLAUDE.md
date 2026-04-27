# Vendor PIQC

## What this is
A protocol-aware audit cognition system for GxP vendor audits. The system carries risk context from protocol review into questionnaire design and audit execution — reducing auditor cognitive load while building the substrate for later agentic behavior. All judgment is human-governed. The system proposes and structures reasoning; it does not autonomously classify or finalize findings.

## Current build phase
**Phase 1 — Protocol Risk Spine + Structured Auditor Workspace**
See `tasks/active.md` for what is being built right now.

## Agentic workflow (upstream → downstream)
1. Protocol risk structuring → `ProtocolRiskObject[]`
2. Vendor service mapping → `VendorServiceObject`, `VendorServiceMappingObject`
3. Trust mode: front-end vendor intelligence review → `TrustAssessmentObject`
4. Questionnaire design + response capture → `QuestionnaireResponseObject[]`
5. Verify mode: structured auditor workspace → `AuditWorkspaceEntryObject[]`
6. Future: risk-adaptive scope, trust escalation, coherence engine (see `docs/architecture.md`)

## Core data objects
- `ProtocolRiskObject` — endpoint tier, impact surface, time sensitivity, vendor dependency flag, operational domain tag
- `VendorServiceObject` — vendor service under review
- `VendorServiceMappingObject` — links vendor service to protocol risk objects, derives criticality context
- `TrustAssessmentObject` — certifications claimed, compliance posture, provisional trust posture, risk hypotheses
- `QuestionnaireResponseObject` — structured responses with evidence attachments and inconsistency tagging
- `AuditWorkspaceEntryObject` — relational audit entries linking protocol section, vendor domain, SOP checkpoint, evidence, provisional impact

All objects must support versioned state history (state deltas, not overwrites) so future agentic modules can reuse change history.

## Tech rules Claude Code must follow
- Schema-first and relational — not prompt-first, not text-blob storage
- Deterministic, explainable logic first; LLM reasoning layered on top later
- Every risk/trust/escalation change stored as a state delta with timestamp and actor
- Evidence and documents linked to structured objects and checkpoint IDs, not stored as loose files
- No autonomous finding finalization
- No black-box severity scoring
- No autonomous vendor communication
- All agentic recommendations must be explainable and editable by the auditor

## Upstream system integration (critical context)
Vendor PIQC does NOT parse protocols itself. It sits downstream of a separate PIQC product built by the dev team. The data flow is:

```
Raw clinical trial protocol (PDF)
        ↓
Reducto API (third-party document parsing client)
        ↓ structured JSON chunks (sections, tables, hierarchy, metadata)
PIQC (separate product, separate build)
        ↓ domain-mapped structured data + visual deliverables for user
        ↓ API call
Vendor PIQC (this build)
        ↓ ingests PIQC's structured output
        ↓ runs audit cognition workflow
```

### What this means for this build
- Do NOT build a protocol parser or PDF ingestion layer
- Do NOT integrate with Reducto directly — that is PIQC's responsibility
- Vendor PIQC receives already-structured protocol data via an internal API call from PIQC
- The schema for `ProtocolRiskObject` must be compatible with what PIQC outputs — confirm the exact field mapping with the dev team before finalizing the schema
- The handoff point (PIQC → Vendor PIQC API contract) is an open question that must be resolved with the dev team

## What NOT to build
- Do not build a chatbot or generic AI assistant interface
- Do not build investigator site mode (Vendor PIQC mode only for now)
- Do not overbuild the protocol ontology — only minimum fields needed to anchor workspace cognition
- Do not add autonomous judgment features in this phase

## Open questions (do not resolve without human input)
See `docs/decisions.md` for unresolved architectural questions that require a decision before building.

## References
- Full project brief: `docs/PRD.md`
- UX/UI design system (canonical workflow + IA): `docs/ux-design-system.md`
- Architecture decisions: `docs/decisions.md`
- Active task: `tasks/active.md`
- Backlog: `tasks/backlog.md`
- Schema definitions: `schema/`
