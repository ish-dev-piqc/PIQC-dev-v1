# Entity Relationship Design — Vendor PIQC Phase 1

**Stack**: Next.js + PostgreSQL + Prisma ORM  
**Root entity**: `Vendor` (D-006: multi-audit scope decided)  
**Status**: Approved draft — ready for Prisma schema

---

## Entity inventory

| Entity | Purpose | Scope |
|---|---|---|
| `User` | Auditor identity. Required for `actor_id` on all state deltas. | Global |
| `Vendor` | Root entity. The vendor organization under audit. | Root |
| `Protocol` | Stable root identifier for a clinical trial. Never changes across amendments. | Global |
| `ProtocolVersion` | One version of a protocol. New version created per amendment. Carries all PIQC payload fields. | Per Protocol |
| `ProtocolRiskObject` | One risk-tagged section of a specific protocol version. Many per version. | Per ProtocolVersion |
| `Audit` | A specific audit engagement. Scoped to one Vendor + one ProtocolVersion + one service engagement. | Per Vendor |
| `VendorServiceObject` | The specific vendor service being audited within an Audit. One per Audit. | Per Audit |
| `VendorServiceMappingObject` | Junction: links a VendorServiceObject to ProtocolRiskObjects. Carries derived criticality context. | Per Audit |
| `TrustAssessmentObject` | Structured capture of front-end vendor intelligence. One per Audit. | Per Audit |
| `QuestionnaireResponseObject` | A single structured Q&A response with evidence and inconsistency tagging. Many per Audit. | Per Audit |
| `AuditWorkspaceEntryObject` | A structured auditor observation. Links protocol risk, vendor domain, checkpoint, evidence. Many per Audit. | Per Audit |
| `AmendmentAlert` | First-class alert when a new ProtocolVersion affects an active Audit. Captures auditor's adopt/stay decision. | Per Audit |
| `EvidenceAttachment` | A file attachment with structured metadata. Linked to workspace entries and questionnaire responses. | Shared |
| `StateHistoryDelta` | Immutable append-only log of all field-level changes across mutable objects. | Global |

**Total: 14 entities**

---

## Entity definitions

### `User`
Minimal identity model for phase 1. Powers `actor_id` across all state deltas.

| Field | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `name` | String | |
| `email` | String UNIQUE | |
| `role` | Enum | `auditor \| lead_auditor \| observer` |
| `created_at` | DateTime | |

---

### `Vendor`
Root entity. The vendor organization. Persists across audits.

| Field | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `name` | String | |
| `legal_name` | String? | |
| `country` | String | |
| `website` | String? | |
| `created_at` | DateTime | |
| `updated_at` | DateTime | |

**Relations**: has many `Audit`

---

### `Protocol`
Stable root identifier for a clinical trial. Never mutated after creation. Amendments create a new `ProtocolVersion`, not a new `Protocol`. The trial registration number, sponsor, and title live here — they do not change across amendments.

| Field | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `study_number` | String UNIQUE | Trial registration identifier (e.g. NCT number, EudraCT). Stable across all amendments. |
| `title` | String | Protocol title. Stable root label. |
| `sponsor` | String | |
| `created_at` | DateTime | |
| `updated_at` | DateTime | |

**Relations**: has many `ProtocolVersion`, has many `Audit` (convenience — reachable via ProtocolVersion)

---

### `ProtocolVersion`
One version of a protocol — the initial version or any subsequent amendment. A new `ProtocolVersion` is created each time PIQC sends an updated protocol payload. All PIQC-sourced fields and all `ProtocolRiskObject`s belong here, not on `Protocol`.

> **D-009 INTEGRATION POINT — PLACEHOLDER FIELDS**  
> Fields marked `[PIQC]` are provisional. Field names, types, and presence must be confirmed against the PIQC API output before finalizing. Do not treat as stable until D-009 is resolved.

| Field | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `protocol_id` | UUID FK → Protocol | |
| `version_number` | Int | Monotonically incrementing per protocol. 1, 2, 3… Unique per protocol. |
| `amendment_label` | String? | Human-readable label (e.g. "Amendment 2", "v3.1"). Optional — set by auditor or from PIQC metadata. |
| `status` | Enum | `draft \| active \| superseded` |
| `effective_date` | Date? | When this version takes clinical effect. Nullable. |
| `piqc_protocol_id` | String | `[PIQC]` PIQC's own identifier for this version's payload. Format TBD. |
| `raw_piqc_payload` | Json | Full JSON payload as received from PIQC for this version. Stored for traceability. Not the source of truth for structured fields. |
| `received_at` | DateTime | When Vendor PIQC ingested this version from PIQC. |
| `created_at` | DateTime | |

**Unique constraint**: `(protocol_id, version_number)`  
**Relations**: belongs to `Protocol`, has many `ProtocolRiskObject`, referenced by `Audit`, has many `AmendmentAlert` (as `from_version` and as `to_version`)

---

### `ProtocolRiskObject`
One risk-tagged section of a specific `ProtocolVersion`. Created when an auditor manually tags protocol sections received from PIQC. Includes lineage tracking to its counterpart in the prior version, enabling diff computation across amendments.

> **D-009 INTEGRATION POINT — PLACEHOLDER FIELDS**  
> `section_identifier` and `section_title` are provisional. The exact keys PIQC uses to identify protocol sections (IDs, slugs, hierarchy path) are TBD until D-009 is resolved.

| Field | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `protocol_version_id` | UUID FK → ProtocolVersion | Belongs to a specific version, not the root Protocol. |
| `section_identifier` | String | `[PIQC]` PIQC's key for this section. Format TBD. |
| `section_title` | String | `[PIQC]` Human-readable section title. |
| `endpoint_tier` | Enum | `primary \| secondary \| safety \| supportive` |
| `impact_surface` | Enum | `data_integrity \| patient_safety \| both` |
| `time_sensitivity` | Boolean | |
| `vendor_dependency_flags` | String[] | One or more vendor/service types this section depends on. Phase 1: string array. |
| `operational_domain_tag` | String | e.g. `ECG \| imaging \| ePRO \| randomization \| central_lab \| IVRS` |
| `previous_version_risk_id` | UUID FK → ProtocolRiskObject? | Self-referencing. Points to the corresponding risk object in the prior version. Null if this object is new in this version. Lineage anchor for diff computation. |
| `version_change_type` | Enum | `added \| modified \| unchanged`. `added` = no `previous_version_risk_id`. `modified` = prior link exists + fields differ. `unchanged` = prior link exists + fields identical (carried forward). Set when this version is processed. |
| `tagged_by` | UUID FK → User | Auditor who tagged this section. |
| `tagged_at` | DateTime | |
| `created_at` | DateTime | |
| `updated_at` | DateTime | |

**Relations**: belongs to `ProtocolVersion`, optionally belongs to `ProtocolRiskObject` (previous version, self-ref), has many `VendorServiceMappingObject`, has many `AuditWorkspaceEntryObject`  
**State history**: yes

---

### `Audit`
A specific audit engagement. Pins to a specific `ProtocolVersion` at the time the audit is initiated. When an auditor adopts a new version, `protocol_version_id` is updated and the change is recorded as a `StateHistoryDelta` for GxP traceability.

| Field | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `vendor_id` | UUID FK → Vendor | |
| `protocol_id` | UUID FK → Protocol | Convenience FK — avoids a join when the root trial identifier is needed. Populated from ProtocolVersion at creation. |
| `protocol_version_id` | UUID FK → ProtocolVersion | The specific version this audit is currently operating against. Updated on version adoption. |
| `audit_name` | String | Human-readable label (e.g. "Acme ECG Q2 2026 Remote Audit"). |
| `audit_type` | Enum | `remote \| onsite \| hybrid` |
| `status` | Enum | `draft \| in_progress \| review \| closed` |
| `lead_auditor_id` | UUID FK → User | |
| `scheduled_date` | Date? | |
| `created_at` | DateTime | |
| `updated_at` | DateTime | |

**Relations**: belongs to `Vendor`, belongs to `Protocol`, belongs to `ProtocolVersion`, has one `VendorServiceObject`, has one `TrustAssessmentObject`, has many `QuestionnaireResponseObject`, has many `AuditWorkspaceEntryObject`, has many `AmendmentAlert`  
**State history**: yes — `protocol_version_id` changes on version adoption are GxP-critical traceability events

---

### `VendorServiceObject`
The specific vendor service being audited. One per Audit.

| Field | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `audit_id` | UUID FK → Audit UNIQUE | One per audit. |
| `service_name` | String | e.g. "Central ECG Reading Service" |
| `service_type` | String | Controlled vocabulary. e.g. `ECG \| central_lab \| ePRO \| IVRS \| imaging \| randomization` |
| `service_description` | String? | |
| `created_at` | DateTime | |
| `updated_at` | DateTime | |

**Relations**: belongs to `Audit`, has many `VendorServiceMappingObject`  
**State history**: yes

---

### `VendorServiceMappingObject`
Junction entity linking a `VendorServiceObject` to one `ProtocolRiskObject`. First-class — carries derived criticality context, not a thin join table.

| Field | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `vendor_service_id` | UUID FK → VendorServiceObject | |
| `protocol_risk_id` | UUID FK → ProtocolRiskObject | |
| `derived_criticality` | Enum | `critical \| high \| moderate \| low`. Derived deterministically from linked ProtocolRiskObject fields. Human-editable. Not LLM-scored. |
| `criticality_rationale` | String? | Auditor-editable explanation. |
| `created_at` | DateTime | |
| `updated_at` | DateTime | |

**Unique constraint**: `(vendor_service_id, protocol_risk_id)`  
**Relations**: belongs to `VendorServiceObject`, belongs to `ProtocolRiskObject`, has many `QuestionnaireResponseObject`, has many `AuditWorkspaceEntryObject`  
**State history**: yes

---

### `TrustAssessmentObject`
Structured capture of front-end vendor intelligence. One per Audit.

> **D-005 OPEN — Trust posture scoring model not yet decided.**  
> `compliance_posture`, `maturity_posture`, and `provisional_trust_posture` use qualitative label enums as a placeholder. If D-005 resolves to numeric scoring or multi-axis, these fields change. Do not finalize UI around these until D-005 is decided.

| Field | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `audit_id` | UUID FK → Audit UNIQUE | One per audit. |
| `certifications_claimed` | String[] | e.g. `["ISO 13485", "21 CFR Part 11"]` |
| `regulatory_claims` | String[] | |
| `compliance_posture` | Enum | `[D-005 PLACEHOLDER] strong \| adequate \| weak \| unknown` |
| `maturity_posture` | Enum | `[D-005 PLACEHOLDER] mature \| developing \| early \| unknown` |
| `provisional_trust_posture` | Enum | `[D-005 PLACEHOLDER] high \| moderate \| low \| unknown` |
| `risk_hypotheses` | String[] | Auditor-authored risk hypothesis statements. |
| `notes` | String? | Narrative notes. Minimal — structured fields are the source of truth. |
| `assessed_by` | UUID FK → User | |
| `assessed_at` | DateTime? | |
| `created_at` | DateTime | |
| `updated_at` | DateTime | |

**Relations**: belongs to `Audit`  
**State history**: yes

---

### `QuestionnaireResponseObject`
A single structured question-and-response entry. Many per Audit.

| Field | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `audit_id` | UUID FK → Audit | |
| `vendor_service_mapping_id` | UUID FK → VendorServiceMappingObject? | Optional. Ties this response to a specific protocol risk domain. |
| `question_text` | String | |
| `question_domain` | String | Operational domain this question targets. |
| `response_text` | String? | Nullable until answered. |
| `response_status` | Enum | `answered \| unanswered \| partial \| deferred` |
| `inconsistency_flag` | Boolean | Default false. Set by auditor. |
| `inconsistency_note` | String? | |
| `responded_by` | UUID FK → User? | |
| `responded_at` | DateTime? | |
| `created_at` | DateTime | |
| `updated_at` | DateTime | |

**Relations**: belongs to `Audit`, optionally belongs to `VendorServiceMappingObject`, has many `EvidenceAttachment` (via junction), referenced by `AuditWorkspaceEntryObject`  
**State history**: yes

---

### `AuditWorkspaceEntryObject`
A structured auditor observation. The primary output of Verify mode. Risk attributes are copied from the linked `ProtocolRiskObject` at link time (stable snapshot). When an amendment changes a linked risk object, `risk_context_outdated` is set to true by the system — the auditor must explicitly re-confirm before the entry is considered current.

> **D-004 OPEN — SOP/checkpoint phasing not yet decided.**  
> `checkpoint_ref` is a plain text stub for phase 1. Phase 2 replaces this with a FK to a `ControlCheckpointObject` table.

| Field | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `audit_id` | UUID FK → Audit | |
| `protocol_risk_id` | UUID FK → ProtocolRiskObject? | Optional. Source of inherited risk context. |
| `vendor_service_mapping_id` | UUID FK → VendorServiceMappingObject? | Optional. Source of criticality context. |
| `questionnaire_response_id` | UUID FK → QuestionnaireResponseObject? | Optional. Links observation to a questionnaire exchange. |
| `checkpoint_ref` | String? | `[D-004 STUB]` Plain text SOP/checkpoint reference. Phase 2: FK to ControlCheckpointObject. |
| `vendor_domain` | String | Which vendor operational domain this entry addresses. |
| `observation_text` | String | Auditor's structured observation. Required. |
| `provisional_impact` | Enum | `critical \| major \| minor \| observation \| none`. Human-assigned only. |
| `provisional_classification` | Enum | `finding \| observation \| opportunity_for_improvement \| not_yet_classified`. Human-assigned only. |
| `risk_attrs_inherited` | Boolean | True if inherited fields were auto-populated from the linked ProtocolRiskObject. |
| `inherited_endpoint_tier` | Enum? | Copied from ProtocolRiskObject at link time. Nullable. |
| `inherited_impact_surface` | Enum? | Copied from ProtocolRiskObject at link time. Nullable. |
| `inherited_time_sensitivity` | Boolean? | Copied from ProtocolRiskObject at link time. Nullable. |
| `risk_context_outdated` | Boolean | Default false. Set to true by the system (not the auditor) when an AmendmentAlert is processed and the linked ProtocolRiskObject has `version_change_type = modified` or was removed in the new version. |
| `risk_context_confirmed_at` | DateTime? | Set when auditor explicitly re-confirms this entry after an amendment. Null until confirmed. |
| `risk_context_confirmed_by` | UUID FK → User? | Null until confirmed. |
| `created_by` | UUID FK → User | |
| `created_at` | DateTime | |
| `updated_at` | DateTime | |

**Relations**: belongs to `Audit`, optionally belongs to `ProtocolRiskObject`, optionally belongs to `VendorServiceMappingObject`, optionally belongs to `QuestionnaireResponseObject`, has many `EvidenceAttachment` (via junction)  
**State history**: yes — `provisional_impact`, `provisional_classification`, `risk_context_outdated`, and `risk_context_confirmed_at` changes tracked

---

### `AmendmentAlert`
Created automatically when a new `ProtocolVersion` is ingested and one or more active `Audit`s are pinned to the previous version. The auditor's adopt/stay decision is explicit and traced in `StateHistoryDelta`. The system also sets `risk_context_outdated = true` on affected `AuditWorkspaceEntryObject`s when this alert is processed (Option A: deterministic write, not a live computed flag).

| Field | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `audit_id` | UUID FK → Audit | The affected audit. |
| `from_version_id` | UUID FK → ProtocolVersion | The version the audit was pinned to before the amendment. |
| `to_version_id` | UUID FK → ProtocolVersion | The new version that triggered the alert. |
| `status` | Enum | `pending \| reviewed \| adopted \| dismissed` |
| `decision` | Enum? | `adopt_new_version \| stay_on_current`. Null until reviewed. |
| `decision_note` | String? | Auditor-authored rationale. |
| `reviewed_by` | UUID FK → User? | Null until reviewed. |
| `reviewed_at` | DateTime? | Null until reviewed. |
| `created_at` | DateTime | |
| `updated_at` | DateTime | |

**Relations**: belongs to `Audit`, belongs to `ProtocolVersion` (from_version), belongs to `ProtocolVersion` (to_version)  
**State history**: yes — status/decision change is a GxP-critical traceability event

---

### `EvidenceAttachment`
A file attachment with structured metadata. Always linked to at least one structured object — never stored as a loose file.

| Field | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `filename` | String | Original filename. |
| `storage_key` | String | Storage path/key (e.g. S3 object key). Not a public URL. |
| `mime_type` | String | |
| `file_size_bytes` | Int | |
| `checkpoint_ref` | String? | Optional SOP or protocol section this evidence pertains to. |
| `uploaded_by` | UUID FK → User | |
| `uploaded_at` | DateTime | |

**Junction tables** (evidence is many-to-many with both workspace entries and questionnaire responses):
- `EvidenceOnWorkspaceEntry`: `(workspace_entry_id FK, evidence_id FK)` — unique pair
- `EvidenceOnQuestionnaireResponse`: `(questionnaire_response_id FK, evidence_id FK)` — unique pair

---

### `StateHistoryDelta`
Immutable, append-only log of all field-level changes to mutable objects. Never updated or deleted. Powers audit trail, trust recalibration history, amendment traceability, and future agentic replay.

| Field | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `object_type` | Enum | `ProtocolRiskObject \| VendorServiceObject \| VendorServiceMappingObject \| TrustAssessmentObject \| QuestionnaireResponseObject \| AuditWorkspaceEntryObject \| Audit \| AmendmentAlert` |
| `object_id` | String | UUID of the changed object. Stored as string (polymorphic — no FK constraint). |
| `changed_fields` | Json | Before/after snapshot of changed fields only. e.g. `{ "protocol_version_id": { "from": "uuid-v1", "to": "uuid-v2" } }` |
| `actor_id` | UUID FK → User | Always a human in phase 1. |
| `reason` | String? | Auditor-authored note explaining the change. |
| `created_at` | DateTime | Immutable. Set at insert. No `updated_at`. |

**No update, no delete. Append-only.**

---

## Full relationship map

```
User
  ├── leads → Audit (lead_auditor_id)
  ├── authors → StateHistoryDelta (actor_id)
  ├── tags → ProtocolRiskObject (tagged_by)
  ├── assesses → TrustAssessmentObject (assessed_by)
  ├── creates → AuditWorkspaceEntryObject (created_by)
  ├── confirms → AuditWorkspaceEntryObject (risk_context_confirmed_by)
  ├── reviews → AmendmentAlert (reviewed_by)
  ├── uploads → EvidenceAttachment (uploaded_by)
  └── captures → QuestionnaireResponseObject (responded_by)

Vendor (root)
  └── has many → Audit

Protocol (stable root — never amended)
  ├── has many → ProtocolVersion
  └── has many → Audit (convenience — protocol_id on Audit)

ProtocolVersion
  ├── belongs to → Protocol
  ├── has many → ProtocolRiskObject
  ├── referenced by → Audit (protocol_version_id)
  ├── has many → AmendmentAlert (as from_version)
  └── has many → AmendmentAlert (as to_version)

ProtocolRiskObject
  ├── belongs to → ProtocolVersion
  ├── optionally belongs to → ProtocolRiskObject (previous_version_risk_id, self-ref)
  ├── has many → VendorServiceMappingObject
  └── has many → AuditWorkspaceEntryObject

Audit
  ├── belongs to → Vendor
  ├── belongs to → Protocol (convenience)
  ├── belongs to → ProtocolVersion (active version)
  ├── has one → VendorServiceObject
  ├── has one → TrustAssessmentObject
  ├── has many → QuestionnaireResponseObject
  ├── has many → AuditWorkspaceEntryObject
  └── has many → AmendmentAlert

VendorServiceObject
  ├── belongs to → Audit
  └── has many → VendorServiceMappingObject

VendorServiceMappingObject
  ├── belongs to → VendorServiceObject
  ├── belongs to → ProtocolRiskObject
  ├── has many → QuestionnaireResponseObject (optional link)
  └── has many → AuditWorkspaceEntryObject (optional link)

TrustAssessmentObject
  └── belongs to → Audit

QuestionnaireResponseObject
  ├── belongs to → Audit
  ├── optionally belongs to → VendorServiceMappingObject
  ├── has many → EvidenceAttachment (via EvidenceOnQuestionnaireResponse)
  └── optionally referenced by → AuditWorkspaceEntryObject

AuditWorkspaceEntryObject
  ├── belongs to → Audit
  ├── optionally belongs to → ProtocolRiskObject
  ├── optionally belongs to → VendorServiceMappingObject
  ├── optionally belongs to → QuestionnaireResponseObject
  └── has many → EvidenceAttachment (via EvidenceOnWorkspaceEntry)

AmendmentAlert
  ├── belongs to → Audit
  ├── belongs to → ProtocolVersion (from_version)
  └── belongs to → ProtocolVersion (to_version)

EvidenceAttachment
  ├── linked to → AuditWorkspaceEntryObject[] (via EvidenceOnWorkspaceEntry)
  └── linked to → QuestionnaireResponseObject[] (via EvidenceOnQuestionnaireResponse)

StateHistoryDelta
  └── polymorphic reference → any tracked mutable object (object_type + object_id)
```

---

## Cardinality summary

| Relationship | Cardinality |
|---|---|
| Vendor → Audit | 1:many |
| Protocol → ProtocolVersion | 1:many |
| Protocol → Audit | 1:many (convenience) |
| ProtocolVersion → ProtocolRiskObject | 1:many |
| ProtocolVersion → Audit | 1:many |
| ProtocolRiskObject → ProtocolRiskObject (lineage) | 1:0..1 (self-ref) |
| Audit → VendorServiceObject | 1:1 |
| Audit → TrustAssessmentObject | 1:1 |
| Audit → QuestionnaireResponseObject | 1:many |
| Audit → AuditWorkspaceEntryObject | 1:many |
| Audit → AmendmentAlert | 1:many |
| ProtocolVersion → AmendmentAlert (from) | 1:many |
| ProtocolVersion → AmendmentAlert (to) | 1:many |
| VendorServiceObject → VendorServiceMappingObject | 1:many |
| ProtocolRiskObject → VendorServiceMappingObject | 1:many |
| VendorServiceMappingObject → QuestionnaireResponseObject | 1:many (optional) |
| VendorServiceMappingObject → AuditWorkspaceEntryObject | 1:many (optional) |
| AuditWorkspaceEntryObject → EvidenceAttachment | many:many (via junction) |
| QuestionnaireResponseObject → EvidenceAttachment | many:many (via junction) |
| Any tracked object → StateHistoryDelta | 1:many |

---

## Amendment flow (how it works end to end)

```
1. New ProtocolVersion ingested from PIQC
   → ProtocolVersion created (status: active)
   → Previous ProtocolVersion set to status: superseded
   → ProtocolRiskObjects created for new version with version_change_type set
      (added / modified / unchanged) and previous_version_risk_id populated

2. AmendmentAlert created for each active Audit pinned to the old version
   → AmendmentAlert.status = pending

3. System writes risk_context_outdated = true on AuditWorkspaceEntryObjects
   where linked protocol_risk_id.version_change_type = modified OR
   the linked ProtocolRiskObject has no counterpart in the new version
   (Option A: deterministic write — no live computation in queries)

4. Auditor reviews AmendmentAlert
   → Decision: adopt_new_version
      → Audit.protocol_version_id updated to new version
      → StateHistoryDelta written (object_type: Audit, changed_fields: protocol_version_id before/after)
      → AmendmentAlert.status = adopted
      → StateHistoryDelta written (object_type: AmendmentAlert, changed_fields: status/decision)
   → Decision: stay_on_current
      → Audit.protocol_version_id unchanged
      → AmendmentAlert.status = dismissed
      → StateHistoryDelta written (object_type: AmendmentAlert, changed_fields: status/decision)

5. Auditor reviews flagged AuditWorkspaceEntryObjects
   → Re-confirms each entry against new risk context
   → risk_context_confirmed_at and risk_context_confirmed_by set
   → StateHistoryDelta written
```

---

## Open decisions still affecting this schema

| Decision | Status | Affected entities | Risk if built now |
|---|---|---|---|
| D-009 (PIQC API contract) | **Open** | `ProtocolVersion`, `ProtocolRiskObject` | PIQC-sourced fields are placeholders. Must confirm with PIQC team before finalizing field names. |
| D-005 (Trust posture scoring) | **Open** | `TrustAssessmentObject` | Three posture fields use qualitative label enums as placeholders. |
| D-004 (SOP checkpoint phasing) | **Open** | `AuditWorkspaceEntryObject` | `checkpoint_ref` is a text stub. Phase 2 adds FK to ControlCheckpointObject. |

---

## What is deferred to Phase 2

- `ControlCheckpointObject` — SOP checkpoint entity; `checkpoint_ref` stubs its future FK
- Evidence versioning — `EvidenceAttachment` has no version history in phase 1 (D-007 deferred)
- Coherence engine stubs (D-008 deferred)
- Auth/session model — `User` table is minimal; proper auth (NextAuth, Clerk, etc.) not designed here
- `vendor_dependency_flags` on ProtocolRiskObject — `String[]` for phase 1; junction table candidate for phase 2

---

## What is NOT in scope (ever)

- Autonomous finding finalization
- Black-box severity scoring
- Autonomous vendor communication
- Investigator site mode
