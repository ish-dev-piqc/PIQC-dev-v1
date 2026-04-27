# Architecture

## Full system layer map (including upstream)

```
[ Raw Clinical Trial Protocol PDF ]
        ↓
[ Reducto API ]  ← third-party document parser
        ↓ structured JSON (sections, tables, hierarchy, metadata)
[ PIQC — separate product ]  ← dev team build
        ↓ domain-mapped structured data
        ↓ visual deliverables → user
        ↓ internal API call
[ Vendor PIQC — this build ]  ← ingests PIQC structured output
        ↓
[ Protocol Risk Spine ]  ← ProtocolRiskObject[] mapped from PIQC output
        ↓
[ Vendor Service Mapping ]  ← VendorServiceObject, VendorServiceMappingObject
        ↓
[ Trust Mode ]  ← TrustAssessmentObject
        ↓
[ Questionnaire Design + Capture ]  ← QuestionnaireResponseObject[]
        ↓
[ Verify Mode / Audit Workspace ]  ← AuditWorkspaceEntryObject[]
        ↓
[ Future: Agentic Reasoning Layer ]  ← reads state, proposes, never finalizes
```

## About Reducto
Reducto is a document parsing API that converts complex unstructured documents (PDFs, clinical protocols, regulatory docs) into structured JSON. It handles multi-column layouts, embedded tables, footnotes, and section hierarchies. PIQC uses Reducto as its parsing engine — Vendor PIQC never calls Reducto directly.

## PIQC → Vendor PIQC API contract (open — must resolve with dev team)
The exact shape of the structured data PIQC sends to Vendor PIQC is not yet defined. Before finalizing the `ProtocolRiskObject` schema, the dev team must confirm:
- What fields PIQC outputs after processing Reducto's JSON
- How protocol sections are identified and keyed
- What metadata is available (section type, page ref, hierarchy level)
- The API format: REST endpoint, payload shape, auth method
This is logged as D-009 in `docs/decisions.md`.



## State history model
All risk, trust, and classification changes are stored as immutable state deltas — not overwrites. Each delta includes:
- `object_id` and `object_type`
- `changed_fields` (before/after)
- `timestamp`
- `actor_id` (always a human in phase 1)
- `reason` (optional auditor note)

This enables: audit trail, trust recalibration history, future agentic replaying of decision chains.

## Object relationships
```
ProtocolRiskObject
  └── linked by → VendorServiceMappingObject
        └── links → VendorServiceObject
              └── informs → TrustAssessmentObject
                    └── informs → QuestionnaireResponseObject[]
                          └── supports → AuditWorkspaceEntryObject[]
                                └── inherits risk attrs from ProtocolRiskObject (via mapping)
```

## Evidence model
- Evidence items are first-class objects linked to `AuditWorkspaceEntryObject` and `QuestionnaireResponseObject`
- Each evidence item references a `checkpoint_id` (SOP or protocol section)
- Phase 1: manual attachment + structured metadata
- Future: version-controlled, with coherence engine comparing process docs vs. deliverable evidence

## Future agentic modules (not in phase 1)
| Module | Reads from | Proposes | Human confirms |
|--------|-----------|---------|----------------|
| Risk-adaptive scope generator | ProtocolRiskObject, VendorServiceMappingObject | Audit agenda depth/focus | Yes |
| Trust escalation engine | TrustAssessmentObject state history, inconsistency flags | Scrutiny level increase | Yes |
| Evidence-weighted observation support | AuditWorkspaceEntryObject, evidence completeness | Provisional finding classification | Yes — always |
| Process–deliverable coherence engine | SOP text, workspace notes, deliverable evidence | Quality drift flags | Yes |

## What the system is not
- Not a chatbot
- Not a document Q&A system
- Not an autonomous auditor
- Not a scoring black box
