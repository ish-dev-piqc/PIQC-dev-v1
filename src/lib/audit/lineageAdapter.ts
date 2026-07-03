// =============================================================================
// lineageAdapter — assembles one audit's objects into a seed→tree lineage graph.
//
// PIQC's audit data model already IS a lineage graph: FKs (audit → stage
// objects), cross-links (mapping → risk, finding → risk/mapping/response), and
// prefill provenance (deliverable → risk summary / questionnaire). This adapter
// gives that graph a normalized shape a view can render: nodes with parentId
// (the tree) plus reference edges (the cross-links), every node carrying a
// status, a human-readable origin, and — where the object is state-history
// tracked — the TrackedObjectType needed to open its HistoryDrawer.
//
// Auditee-neutral by design: the seed is a generic AUDITEE (today always the
// vendor; the investigator-site initiative reuses this unchanged — see
// docs/audit/two-workflow-architecture.md).
//
// Pure module — no supabase, no React. Fetch composition lives in lineageApi.
// =============================================================================

import type { AuditWorkflowType, TrackedObjectType } from '../../types/audit';
import type { AuditWithContext } from '../../context/AuditContext';
import {
  AUDIT_STATUS_LABELS,
  DERIVED_CRITICALITY_LABELS,
  ENDPOINT_TIER_LABELS,
  PROVISIONAL_CLASSIFICATION_LABELS,
  QUESTIONNAIRE_INSTANCE_STATUS_LABELS,
  SERVICE_TYPE_OPTIONS,
  TRUST_POSTURE_LABELS,
} from './labels';
import type { TaggedSection } from './mockProtocolRisks';
import type {
  MockVendorService,
  MockServiceMapping,
  MockTrustAssessment,
} from './mockVendorEnrichment';
import type { MockQuestionnaireBundle } from './mockQuestionnaire';
import type { MockRiskSummary } from './mockRiskSummary';
import type { MockPreAuditBundle } from './mockPreAudit';
import type { MockWorkspaceEntry } from './mockWorkspaceEntries';
import type { MockReportDraft } from './mockReport';

// -----------------------------------------------------------------------------
// Graph shapes
// -----------------------------------------------------------------------------

export type LineageEntityType =
  | 'AUDITEE'            // the seed — vendor today, investigator site later
  | 'AUDIT'
  | 'PROTOCOL_RISK'
  | 'VENDOR_SERVICE'
  | 'SERVICE_MAPPING'
  | 'TRUST_ASSESSMENT'
  | 'QUESTIONNAIRE'
  | 'RISK_SUMMARY'
  | 'CONFIRMATION_LETTER'
  | 'AGENDA'
  | 'CHECKLIST'
  | 'WORKSPACE_ENTRY'
  | 'REPORT';

export interface LineageNode {
  /** Graph-unique id. Prefixed per entity so DB ids can never collide. */
  id: string;
  entityType: LineageEntityType;
  title: string;
  /** Short display status, e.g. "Approved", "Draft", "Finding". null = stateless. */
  status: string | null;
  /** Tone bucket for status chips/graph fill. */
  statusTone: 'approved' | 'attention' | 'neutral';
  /** Tree edge. null only for the seed. */
  parentId: string | null;
  /** Which stage (1-8) produced this object. null for seed/audit. */
  stage: number | null;
  /** Human origin line — teaches a first-time auditor where the record came from. */
  origin: string;
  /** Set when the object is state-history tracked → enables HistoryDrawer. */
  trackedObjectType: TrackedObjectType | null;
  /** Bare DB id (unprefixed) for history lookups. */
  objectId: string;
}

/** Non-tree relationships: cross-links + provenance. Rendered as chips/dashed edges. */
export interface LineageEdge {
  fromId: string;
  toId: string;
  kind: 'reference' | 'provenance';
  /** e.g. "maps to", "cites", "prefilled from" */
  label: string;
}

export interface LineageGraph {
  nodes: LineageNode[];
  edges: LineageEdge[];
  seedId: string;
}

export interface LineageInput {
  audit: AuditWithContext;
  risks: TaggedSection[];
  service: MockVendorService | null;
  mappings: MockServiceMapping[];
  trust: MockTrustAssessment | null;
  questionnaire: MockQuestionnaireBundle | null;
  riskSummary: MockRiskSummary | null;
  preAudit: MockPreAuditBundle;
  entries: MockWorkspaceEntry[];
  report: MockReportDraft | null;
}

// -----------------------------------------------------------------------------
// Builders
// -----------------------------------------------------------------------------

const nid = (type: LineageEntityType, id: string): string => `${type}:${id}`;

const approvalTone = (status: string | null): LineageNode['statusTone'] =>
  status === 'APPROVED' ? 'approved' : 'neutral';

// Display labels for the two-value approval enums (no shared map exists —
// DeliverableApprovalStatus / RiskSummaryApprovalStatus are DRAFT|APPROVED).
const APPROVAL_LABELS: Record<string, string> = { DRAFT: 'Draft', APPROVED: 'Approved' };

function seedLabel(workflowType: AuditWorkflowType): string {
  return workflowType === 'VENDOR_AUDIT' ? 'Vendor (auditee)' : 'Investigator site (auditee)';
}

export function buildLineageGraph(input: LineageInput): LineageGraph {
  const { audit } = input;
  const nodes: LineageNode[] = [];
  const edges: LineageEdge[] = [];

  // --- Seed: the auditee ------------------------------------------------------
  const seedId = nid('AUDITEE', audit.id);
  nodes.push({
    id: seedId,
    entityType: 'AUDITEE',
    title: audit.vendor_name || 'Auditee',
    status: seedLabel(audit.workflow_type),
    statusTone: 'neutral',
    parentId: null,
    stage: null,
    origin: 'Seed of this audit’s lineage — every record below traces back here.',
    trackedObjectType: null,
    objectId: audit.id,
  });

  // --- Audit -------------------------------------------------------------------
  const auditNodeId = nid('AUDIT', audit.id);
  nodes.push({
    id: auditNodeId,
    entityType: 'AUDIT',
    title: audit.audit_name,
    status: AUDIT_STATUS_LABELS[audit.status],
    statusTone: audit.status === 'CLOSED' ? 'approved' : 'neutral',
    parentId: seedId,
    stage: null,
    origin: `Initiated against protocol ${audit.protocol_code || '—'}.`,
    trackedObjectType: 'AUDIT',
    objectId: audit.id,
  });

  // --- Stage 1: protocol risks --------------------------------------------------
  for (const risk of input.risks) {
    nodes.push({
      id: nid('PROTOCOL_RISK', risk.id),
      entityType: 'PROTOCOL_RISK',
      title: `${risk.section_identifier} ${risk.section_title}`,
      status: ENDPOINT_TIER_LABELS[risk.endpoint_tier],
      statusTone: 'neutral',
      parentId: auditNodeId,
      stage: 1,
      origin:
        risk.tagging_mode === 'MANUAL'
          ? 'Tagged by the auditor in Intake.'
          : 'PIQC-assisted tag, auditor-confirmed in Intake.',
      trackedObjectType: 'PROTOCOL_RISK_OBJECT',
      objectId: risk.id,
    });
  }

  // --- Stage 2: service, mappings, trust ----------------------------------------
  if (input.service) {
    const serviceId = nid('VENDOR_SERVICE', input.service.id);
    nodes.push({
      id: serviceId,
      entityType: 'VENDOR_SERVICE',
      title: input.service.service_name,
      status:
        SERVICE_TYPE_OPTIONS.find((o) => o.value === input.service?.service_type)?.label ??
        input.service.service_type,
      statusTone: 'neutral',
      parentId: auditNodeId,
      stage: 2,
      origin: 'Service definition from Vendor enrichment.',
      trackedObjectType: 'VENDOR_SERVICE_OBJECT',
      objectId: input.service.id,
    });

    for (const mapping of input.mappings) {
      const mappingId = nid('SERVICE_MAPPING', mapping.id);
      nodes.push({
        id: mappingId,
        entityType: 'SERVICE_MAPPING',
        title: 'Service ↔ risk mapping',
        status: DERIVED_CRITICALITY_LABELS[mapping.derived_criticality],
        statusTone: mapping.derived_criticality === 'CRITICAL' ? 'attention' : 'neutral',
        parentId: serviceId,
        stage: 2,
        origin: 'Maps the service onto a Stage 1 protocol risk; anchors criticality.',
        trackedObjectType: 'VENDOR_SERVICE_MAPPING_OBJECT',
        objectId: mapping.id,
      });
      edges.push({
        fromId: mappingId,
        toId: nid('PROTOCOL_RISK', mapping.protocol_risk_id),
        kind: 'reference',
        label: 'maps to',
      });
    }
  }

  if (input.trust) {
    nodes.push({
      id: nid('TRUST_ASSESSMENT', input.trust.id),
      entityType: 'TRUST_ASSESSMENT',
      title: 'Trust intelligence',
      status: TRUST_POSTURE_LABELS[input.trust.provisional_trust_posture],
      statusTone: input.trust.provisional_trust_posture === 'LOW' ? 'attention' : 'neutral',
      parentId: auditNodeId,
      stage: 2,
      origin: 'Compliance / maturity / trust postures from Vendor enrichment.',
      trackedObjectType: 'TRUST_ASSESSMENT_OBJECT',
      objectId: input.trust.id,
    });
  }

  // --- Stage 3: questionnaire -----------------------------------------------------
  const questionnaireNodeId = input.questionnaire
    ? nid('QUESTIONNAIRE', input.questionnaire.instance.id)
    : null;
  if (input.questionnaire) {
    const inst = input.questionnaire.instance;
    const answered = Object.values(input.questionnaire.responses).filter(
      (r) => r.response_status === 'ANSWERED',
    ).length;
    nodes.push({
      id: questionnaireNodeId as string,
      entityType: 'QUESTIONNAIRE',
      title: `Questionnaire (${answered}/${input.questionnaire.questions.length} answered)`,
      status: QUESTIONNAIRE_INSTANCE_STATUS_LABELS[inst.status],
      statusTone: inst.approved_at ? 'approved' : 'neutral',
      parentId: auditNodeId,
      stage: 3,
      origin: 'Standard questionnaire instance; addenda generated from Stage 2 mappings.',
      trackedObjectType: 'QUESTIONNAIRE_INSTANCE',
      objectId: inst.id,
    });
  }

  // --- Stage 4: risk summary -------------------------------------------------------
  const riskSummaryNodeId = input.riskSummary
    ? nid('RISK_SUMMARY', input.riskSummary.id)
    : null;
  if (input.riskSummary) {
    nodes.push({
      id: riskSummaryNodeId as string,
      entityType: 'RISK_SUMMARY',
      title: 'Vendor risk summary',
      status: APPROVAL_LABELS[input.riskSummary.approval_status],
      statusTone: approvalTone(input.riskSummary.approval_status),
      parentId: auditNodeId,
      stage: 4,
      origin: 'Aggregates Stage 1–3 into the approved risk narrative.',
      trackedObjectType: 'VENDOR_RISK_SUMMARY_OBJECT',
      objectId: input.riskSummary.id,
    });
  }

  // --- Stage 5: pre-audit deliverables ----------------------------------------------
  const deliverables: Array<{
    obj:
      | MockPreAuditBundle['confirmation_letter']
      | MockPreAuditBundle['agenda']
      | MockPreAuditBundle['checklist'];
    entityType: Extract<LineageEntityType, 'CONFIRMATION_LETTER' | 'AGENDA' | 'CHECKLIST'>;
    title: string;
    tracked: TrackedObjectType;
  }> = [
    {
      obj: input.preAudit.confirmation_letter,
      entityType: 'CONFIRMATION_LETTER',
      title: 'Confirmation letter',
      tracked: 'CONFIRMATION_LETTER_OBJECT',
    },
    { obj: input.preAudit.agenda, entityType: 'AGENDA', title: 'Agenda', tracked: 'AGENDA_OBJECT' },
    {
      obj: input.preAudit.checklist,
      entityType: 'CHECKLIST',
      title: 'Checklist',
      tracked: 'CHECKLIST_OBJECT',
    },
  ];
  for (const d of deliverables) {
    if (!d.obj) continue;
    const id = nid(d.entityType, d.obj.id);
    const prefilled = Boolean(d.obj.prefilled_at);
    nodes.push({
      id,
      entityType: d.entityType,
      title: d.title,
      status: APPROVAL_LABELS[d.obj.approval_status],
      statusTone: approvalTone(d.obj.approval_status),
      parentId: auditNodeId,
      stage: 5,
      origin: prefilled
        ? 'PIQC drafted from approved upstream context; auditor reviews and approves.'
        : 'Drafted in Pre-audit drafting.',
      trackedObjectType: d.tracked,
      objectId: d.obj.id,
    });
    // Prefill provenance edges — the "PIQC drafted from X" claim, as a link.
    const srcSummary = 'source_risk_summary_id' in d.obj ? d.obj.source_risk_summary_id : null;
    if (srcSummary && riskSummaryNodeId) {
      edges.push({ fromId: id, toId: riskSummaryNodeId, kind: 'provenance', label: 'prefilled from' });
    }
    const srcQuestionnaire =
      'source_questionnaire_instance_id' in d.obj ? d.obj.source_questionnaire_instance_id : null;
    if (srcQuestionnaire && questionnaireNodeId) {
      edges.push({
        fromId: id,
        toId: questionnaireNodeId,
        kind: 'provenance',
        label: 'prefilled from',
      });
    }
  }

  // --- Stage 6: workspace entries (findings/observations) ----------------------------
  for (const entry of input.entries) {
    const entryId = nid('WORKSPACE_ENTRY', entry.id);
    const isFinding = entry.provisional_classification === 'FINDING';
    nodes.push({
      id: entryId,
      entityType: 'WORKSPACE_ENTRY',
      title: entry.observation_text.length > 72
        ? `${entry.observation_text.slice(0, 72)}…`
        : entry.observation_text,
      status: PROVISIONAL_CLASSIFICATION_LABELS[entry.provisional_classification],
      statusTone: isFinding ? 'attention' : 'neutral',
      parentId: auditNodeId,
      stage: 6,
      origin: `Recorded during Audit conduct (${entry.vendor_domain}).`,
      trackedObjectType: 'AUDIT_WORKSPACE_ENTRY_OBJECT',
      objectId: entry.id,
    });
    if (entry.protocol_risk_id) {
      edges.push({
        fromId: entryId,
        toId: nid('PROTOCOL_RISK', entry.protocol_risk_id),
        kind: 'reference',
        label: 'cites risk',
      });
    }
    if (entry.vendor_service_mapping_id) {
      edges.push({
        fromId: entryId,
        toId: nid('SERVICE_MAPPING', entry.vendor_service_mapping_id),
        kind: 'reference',
        label: 'cites mapping',
      });
    }
    if (entry.questionnaire_response_id && questionnaireNodeId) {
      edges.push({
        fromId: entryId,
        toId: questionnaireNodeId,
        kind: 'reference',
        label: 'cites response',
      });
    }
  }

  // --- Stage 7/8: report --------------------------------------------------------------
  if (input.report) {
    const reportId = nid('REPORT', input.report.id);
    const exported = Boolean(input.report.exported_at);
    nodes.push({
      id: reportId,
      entityType: 'REPORT',
      title: 'Audit report',
      status: exported ? 'Exported' : APPROVAL_LABELS[input.report.approval_status],
      statusTone: exported || input.report.approval_status === 'APPROVED' ? 'approved' : 'neutral',
      parentId: auditNodeId,
      stage: exported ? 8 : 7,
      origin: input.report.source_risk_summary_id
        ? 'PIQC drafted the narrative from the approved risk summary + Stage 6 findings.'
        : 'Composed in Report drafting.',
      trackedObjectType: 'REPORT_DRAFT_OBJECT',
      objectId: input.report.id,
    });
    if (input.report.source_risk_summary_id && riskSummaryNodeId) {
      edges.push({
        fromId: reportId,
        toId: riskSummaryNodeId,
        kind: 'provenance',
        label: 'prefilled from',
      });
    }
  }

  // Drop dangling edges (e.g. a mapping whose risk was deleted upstream). Every
  // surviving edge is guaranteed to have both endpoints in `nodes`.
  const ids = new Set(nodes.map((n) => n.id));
  const validEdges = edges.filter((e) => ids.has(e.fromId) && ids.has(e.toId));

  return { nodes, edges: validEdges, seedId };
}

// -----------------------------------------------------------------------------
// View helpers (pure)
// -----------------------------------------------------------------------------

/** Depth from seed (seed = 0). Used by the SVG layout. */
export function nodeDepth(graph: LineageGraph, node: LineageNode): number {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  let depth = 0;
  let cur: LineageNode | undefined = node;
  while (cur?.parentId) {
    depth += 1;
    cur = byId.get(cur.parentId);
    if (depth > graph.nodes.length) break; // cycle guard — cannot happen by construction
  }
  return depth;
}
