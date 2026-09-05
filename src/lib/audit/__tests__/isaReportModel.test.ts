import { describe, it, expect } from 'vitest';
import {
  buildExecSummary,
  buildIsaReportPacket,
  buildMatrix,
  buildResponseClause,
  categoryLines,
  VERDICT_PLACEHOLDER,
  VERDICT_SENTENCES,
  type IsaReportMeta,
} from '../isaReportModel';
import type {
  IsaDomain,
  IsaFindingObject,
  IsaReportDraftObject,
  IsaSeverity,
} from '../../../types/audit';

function finding(
  domain: IsaDomain,
  severity: IsaSeverity,
  overrides: Partial<IsaFindingObject> = {},
): IsaFindingObject {
  return {
    id: crypto.randomUUID(),
    audit_id: 'audit-1',
    title: 'Finding',
    isa_domain: domain,
    subcategory: null,
    severity,
    severity_rule: null,
    observation: 'Observed condition.',
    evidence: [{ text: 'Instance.', source_note_ids: ['n1'] }],
    reference: null,
    protocol_refs: [],
    response_owner: 'SITE',
    origin: 'AUDITOR',
    created_by: 'u1',
    created_at: '2026-07-19T10:00:00Z',
    updated_at: '2026-07-19T10:00:00Z',
    ...overrides,
  };
}

function draft(overrides: Partial<IsaReportDraftObject> = {}): IsaReportDraftObject {
  return {
    id: 'draft-1',
    audit_id: 'audit-1',
    exec_summary: null,
    exec_summary_source: null,
    auditee_background: null,
    auditee_background_source: null,
    opening_meeting: null,
    opening_meeting_source: null,
    closing_meeting: null,
    closing_meeting_source: null,
    site_verdict: null,
    site_verdict_text: null,
    response_due_days: 30,
    response_due_basis: 'CALENDAR',
    readiness_fingerprint: null,
    final_signed_off_by: null,
    final_signed_off_at: null,
    exported_at: null,
    created_by: 'u1',
    created_at: '2026-07-19T10:00:00Z',
    updated_at: '2026-07-19T10:00:00Z',
    ...overrides,
  };
}

const META: IsaReportMeta = {
  auditeeName: 'City Hospital Research Unit',
  siteNumber: '104',
  principalInvestigator: 'Dr. Example',
  siteCountry: 'US',
  protocolCode: 'PROTO-1',
  protocolTitle: 'A study',
  auditTypeLabel: 'Routine',
  auditDate: '2026-07-15',
  generatedAt: new Date('2026-07-19T12:00:00Z'),
};

describe('buildExecSummary — the six-beat formula', () => {
  it('renders the no-critical headline and the verdict placeholder when unset', () => {
    const res = buildExecSummary(draft(), [finding('INFORMED_CONSENT', 'MINOR')]);
    expect(res.source).toBe('templated');
    expect(res.verdictSet).toBe(false);
    expect(res.text).toContain('No critical observations were made');
    expect(res.text).toContain('1 minor observation was made');
    expect(res.text).toContain('• Informed consent');
    expect(res.text).toContain(VERDICT_PLACEHOLDER);
    expect(res.text).toContain('within 30 calendar days');
  });

  it('counts criticals and appends verdict nuance when ruled', () => {
    const res = buildExecSummary(
      draft({ site_verdict: 'CONTINUE_INCREASED_MONITORING', site_verdict_text: 'Focused on IP handling.' }),
      [finding('INVESTIGATIONAL_PRODUCT', 'CRITICAL'), finding('INVESTIGATIONAL_PRODUCT', 'MAJOR')],
    );
    expect(res.verdictSet).toBe(true);
    expect(res.text).toContain('1 critical observation was made');
    expect(res.text).toContain(VERDICT_SENTENCES.CONTINUE_INCREASED_MONITORING);
    expect(res.text).toContain('Focused on IP handling.');
    expect(res.text).not.toContain(VERDICT_PLACEHOLDER);
  });

  it('returns the auditor text verbatim once edited', () => {
    const res = buildExecSummary(draft({ exec_summary: 'My own summary.' }), []);
    expect(res).toMatchObject({ text: 'My own summary.', source: 'auditor_edited' });
  });

  it('carries the llm rung of the provenance ladder through to the packet', () => {
    const res = buildExecSummary(
      draft({ exec_summary: 'PIQC-refined summary.', exec_summary_source: 'llm' }),
      [],
    );
    expect(res).toMatchObject({ text: 'PIQC-refined summary.', source: 'llm' });
  });

  it('recommendations never appear in the category list', () => {
    expect(categoryLines([finding('SOP_REVIEW', 'RECOMMENDATION')])).toEqual([]);
  });

  it('deduplicates category lines and honors subcategory', () => {
    const lines = categoryLines([
      finding('INFORMED_CONSENT', 'MINOR', { subcategory: 'Re-consent' }),
      finding('INFORMED_CONSENT', 'MAJOR', { subcategory: 'Re-consent' }),
    ]);
    expect(lines).toEqual(['Informed consent – Re-consent']);
  });
});

describe('buildMatrix / packet assembly', () => {
  it('counts per domain × severity', () => {
    const rows = buildMatrix(
      [
        finding('IRB_EC', 'MINOR'),
        finding('IRB_EC', 'MINOR'),
        finding('IRB_EC', 'CRITICAL'),
      ],
      ['IRB_EC', 'SOP_REVIEW'],
    );
    expect(rows[0]).toMatchObject({ domain: 'IRB_EC', critical: 1, minor: 2, major: 0 });
    expect(rows[1]).toMatchObject({ domain: 'SOP_REVIEW', critical: 0, minor: 0 });
  });

  it('assembles the packet with placeholders for unwritten sections and groups in severity order', () => {
    const packet = buildIsaReportPacket(META, null, [finding('IRB_EC', 'MAJOR')], []);
    expect(packet.auditeeBackground.source).toBe('templated');
    expect(packet.groups.map((g) => g.severity)).toEqual([
      'CRITICAL',
      'MAJOR',
      'MINOR',
      'RECOMMENDATION',
    ]);
    expect(packet.groups[1].findings).toHaveLength(1);
    expect(packet.counts.MAJOR).toBe(1);
  });
});

describe('buildResponseClause', () => {
  it('parameterizes days and basis', () => {
    expect(buildResponseClause(30, 'CALENDAR')).toContain('30 calendar days');
    expect(buildResponseClause(10, 'BUSINESS')).toContain('10 business days');
  });
});
