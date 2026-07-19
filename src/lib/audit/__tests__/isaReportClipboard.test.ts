import { describe, it, expect } from 'vitest';
import {
  buildFindingHtml,
  buildFindingPlain,
  buildObservationFormHtml,
  buildObservationFormPlain,
  buildReportHtml,
  buildReportPlain,
  RESPONSE_REQUIREMENTS,
} from '../isaReportClipboard';
import { buildIsaReportPacket, type IsaReportMeta } from '../isaReportModel';
import type { IsaFindingObject } from '../../../types/audit';

const GENERATED = new Date('2026-07-19T12:00:00Z');

const META: IsaReportMeta = {
  auditeeName: 'City Hospital Research Unit',
  siteNumber: '104',
  principalInvestigator: 'Dr. Example',
  siteCountry: 'US',
  protocolCode: 'PROTO-1',
  protocolTitle: 'A <study> & trial',
  auditTypeLabel: 'Routine',
  auditDate: '2026-07-15',
  generatedAt: GENERATED,
};

const FINDING: IsaFindingObject = {
  id: 'f1',
  audit_id: 'audit-1',
  title: 'IP accountability records incomplete',
  isa_domain: 'INVESTIGATIONAL_PRODUCT',
  subcategory: 'Accountability log',
  severity: 'MAJOR',
  severity_rule: 'Compliance deficiency',
  observation: 'Investigational product accountability records were not maintained completely.',
  evidence: [
    { text: 'Dispensing log entries for 03–05 Mar were absent.', source_note_ids: ['n1'] },
  ],
  reference: 'ICH E6(R3) 2.10.4',
  response_owner: 'SITE',
  origin: 'PIQC_EDITED',
  created_by: 'u1',
  created_at: '2026-07-19T10:00:00Z',
  updated_at: '2026-07-19T10:00:00Z',
};

const packet = () => buildIsaReportPacket(META, null, [FINDING], []);

describe('buildReportHtml — Word-parseable payload', () => {
  it('carries the DRAFT provenance banner inside the payload', () => {
    const html = buildReportHtml(packet());
    expect(html).toContain('DRAFT — PIQC drafted · requires human review');
    expect(html).toContain('19 Jul 2026');
  });

  it('uses inline styles and table layout only — no stylesheet, no flex/grid', () => {
    const html = buildReportHtml(packet());
    expect(html).not.toContain('<style');
    expect(html).not.toContain('class=');
    expect(html).not.toContain('display:flex');
    expect(html).not.toContain('display:grid');
    expect(html).toContain('<table style=');
    expect(html).toMatch(/font-size:\d+(\.\d+)?pt/);
  });

  it('escapes HTML in user content', () => {
    const html = buildReportHtml(packet());
    expect(html).toContain('A &lt;study&gt; &amp; trial');
    expect(html).not.toContain('A <study>');
  });

  it('renders the finding with severity, domain, evidence and reference', () => {
    const html = buildReportHtml(packet());
    expect(html).toContain('[Major] IP accountability records incomplete');
    expect(html).toContain('Investigational product – Accountability log');
    expect(html).toContain('Dispensing log entries for 03–05 Mar were absent.');
    expect(html).toContain('Reference: ICH E6(R3) 2.10.4');
  });

  it('never emits a participant-initials column', () => {
    expect(buildReportHtml(packet()).toLowerCase()).not.toContain('initials');
    expect(buildReportPlain(packet()).toLowerCase()).not.toContain('initials');
  });
});

describe('buildReportPlain — fallback flavor', () => {
  it('mirrors the banner and the core sections', () => {
    const plain = buildReportPlain(packet());
    expect(plain).toContain('DRAFT — PIQC drafted · requires human review');
    expect(plain).toContain('EXECUTIVE SUMMARY');
    expect(plain).toContain('MAJOR OBSERVATIONS (1)');
    expect(plain).toContain('  - Dispensing log entries');
  });
});

describe('per-finding builders', () => {
  it('single-finding copies carry their own banner in both flavors', () => {
    expect(buildFindingHtml(FINDING, GENERATED)).toContain('DRAFT — PIQC drafted');
    expect(buildFindingPlain(FINDING, GENERATED)).toContain('DRAFT — PIQC drafted');
    expect(buildFindingPlain(FINDING, GENERATED)).toContain('[Major] IP accountability records incomplete');
  });
});

describe('observation form builders', () => {
  it('renders the response vehicle: table, empty response cell with the severity requirement, owner', () => {
    const html = buildObservationFormHtml(packet());
    expect(html).toContain('Audit Observation Form');
    expect(html).toContain('DRAFT — PIQC drafted · requires human review');
    expect(html).toContain('Observation &amp; evidence');
    expect(html).toContain(RESPONSE_REQUIREMENTS.MAJOR);
    expect(html).toContain('Owner: Site');
    expect(html).toContain('Auditee representative completing response');
    expect(html).not.toContain('<style');
    expect(html).not.toContain('class=');
  });

  it('keys the response requirement to the finding severity', () => {
    expect(RESPONSE_REQUIREMENTS.CRITICAL).toContain('root cause');
    expect(RESPONSE_REQUIREMENTS.CRITICAL).toContain('aggressive timeline');
    expect(RESPONSE_REQUIREMENTS.MINOR).toContain('not required');
    expect(RESPONSE_REQUIREMENTS.RECOMMENDATION).toContain('optional');
  });

  it('states the observation-vs-evidence rule in the response process text', () => {
    const html = buildObservationFormHtml(packet());
    expect(html).toContain('address the observation itself');
  });

  it('plain flavor scaffolds the response fields per finding', () => {
    const plain = buildObservationFormPlain(packet());
    expect(plain).toContain('AUDIT OBSERVATION FORM');
    expect(plain).toContain('Root cause:');
    expect(plain).toContain('Corrective action plan / responsible / target date:');
    expect(plain).toContain('Response accepted by:');
    expect(plain.toLowerCase()).not.toContain('initials');
  });
});
