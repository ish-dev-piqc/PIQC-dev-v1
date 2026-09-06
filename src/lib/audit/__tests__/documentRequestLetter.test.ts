// documentRequestLetter — the request letter that leaves PIQC, in its
// paste-ready HTML and plain-text flavors. Pins what the owner decided the
// site sees and does not see: the APPROVED banner, only included lines,
// domain headings with no criticality, the fixed subject-selection
// paragraph followed by the sampling approach, the audit dates instead of
// a due date, escaping, and the signature. Idiom: isaReportClipboard.test.ts.

import { describe, it, expect } from 'vitest';
import type { IsaReportMeta } from '../isaReportModel';
import type { DerivedCriticality, DocumentRequestContent, IsaDomain, SiteScopeModule } from '../../../types/audit';
import { buildDocumentRequestContent, newAuditorItem } from '../documentRequest';
import { DEFAULT_SAMPLING_APPROACH, SUBJECT_SELECTION_NOTICE } from '../documentRequestVocabulary';
import {
  buildDocumentRequestHtml,
  buildDocumentRequestPlain,
  type DocumentRequestPacket,
} from '../documentRequestLetter';

const GENERATED = new Date('2026-07-19T12:00:00Z');
const BUILT_AT = '2026-07-18T10:00:00.000Z';

const META: IsaReportMeta = {
  auditeeName: 'City Hospital Research Unit',
  siteNumber: '104',
  principalInvestigator: 'Dr. Example',
  siteCountry: 'US',
  protocolCode: 'PROTO-1',
  protocolTitle: 'A <study> & trial',
  auditTypeLabel: 'Onsite',
  auditDate: 'Sep 15 – 17, 2026',
  generatedAt: GENERATED,
};

function module(isa_domain: IsaDomain, criticality: DerivedCriticality): SiteScopeModule {
  return { isa_domain, criticality, items: [] };
}

function content(): DocumentRequestContent {
  const base = buildDocumentRequestContent(
    {
      id: 'scope-1',
      content: { built_from: { mapping_ids: [], built_at: BUILT_AT }, modules: [module('INFORMED_CONSENT', 'CRITICAL')] },
    },
    BUILT_AT,
  );
  const items = base.items.map((item) =>
    item.key === 'baseline:monitoring_visit_log'
      ? { ...item, included: false }
      : item.key === 'baseline:delegation_log'
      ? { ...item, note: 'Include the <2025> log' }
      : item,
  );
  items.push(newAuditorItem(items, 'IRB annual report', 'IRB_EC', 1));
  items.push(newAuditorItem(items, 'Site organisation chart', null, 2));
  return { ...base, items, instructions: 'Documents in room 4.\nElectronic records via read-only access.' };
}

function packet(over: Partial<DocumentRequestPacket> = {}): DocumentRequestPacket {
  return {
    meta: META,
    content: content(),
    approvedByName: 'Ada Auditor',
    approvedAt: '2026-09-05T11:00:00Z',
    signatoryName: 'Ada Auditor',
    ...over,
  };
}

describe('buildDocumentRequestHtml — what the site receives', () => {
  it('carries the APPROVED provenance banner inside the payload', () => {
    const html = buildDocumentRequestHtml(packet());
    expect(html).toMatch(/APPROVED — reviewed and approved by Ada Auditor on 0?5 Sep 2026/);
    expect(html).toContain('generated 19 Jul 2026');
    expect(html).not.toContain('DRAFT');
  });

  it('uses inline styles and table layout only — no stylesheet, no flex/grid', () => {
    const html = buildDocumentRequestHtml(packet());
    expect(html).not.toContain('<style');
    expect(html).not.toContain('class=');
    expect(html).not.toContain('display:flex');
    expect(html).toContain('<table style=');
    expect(html).toMatch(/font-size:\d+(\.\d+)?pt/);
  });

  it('prints included lines with their notes and leaves excluded lines out', () => {
    const html = buildDocumentRequestHtml(packet());
    expect(html).toContain('Delegation of authority log, all versions, with start and end dates');
    expect(html).toContain('Include the &lt;2025&gt; log');
    expect(html).toContain('IRB annual report');
    expect(html).toContain('Site organisation chart');
    expect(html).not.toContain('Monitoring visit log and monitoring follow-up letters');
  });

  it('groups under domain headings and never shows the criticality', () => {
    const html = buildDocumentRequestHtml(packet());
    expect(html).toContain('>Baseline documents<');
    expect(html).toContain('>Informed consent<');
    expect(html).toContain('>IRB / EC<');
    expect(html).toContain('>Additional documents<');
    expect(html.toLowerCase()).not.toContain('critical');
    expect(html).not.toContain('criticality');
  });

  it('addresses the site from the audit record, with the audit dates and no due date', () => {
    const html = buildDocumentRequestHtml(packet());
    expect(html).toContain('<strong>Site</strong></td><td style=');
    expect(html).toContain('City Hospital Research Unit');
    expect(html).toContain('Dr. Example');
    expect(html).toContain('<strong>Audit dates</strong>');
    expect(html).toContain('Sep 15 – 17, 2026');
    expect(html).toContain('scheduled for Sep 15 – 17, 2026');
    expect(html).toContain('available for review at the site on the audit dates');
    expect(html).not.toContain('Documents due');

    const unscheduled = buildDocumentRequestHtml(packet({ meta: { ...META, auditDate: null } }));
    expect(unscheduled).not.toContain('Audit dates');
    expect(unscheduled).not.toContain('scheduled for');
  });

  it('renders delivery instructions with line breaks, and omits the section when empty', () => {
    const html = buildDocumentRequestHtml(packet());
    expect(html).toContain('>Delivery instructions<');
    expect(html).toContain('Documents in room 4.<br>Electronic records via read-only access.');

    const none = buildDocumentRequestHtml(packet({ content: { ...content(), instructions: '' } }));
    expect(none).not.toContain('Delivery instructions');
  });

  it('always carries the subject-selection paragraph, then the sampling approach when set', () => {
    const html = buildDocumentRequestHtml(packet());
    expect(html).toContain(SUBJECT_SELECTION_NOTICE);
    expect(html).toContain('<strong>Sampling approach.</strong> ' + DEFAULT_SAMPLING_APPROACH);
    // "initials" appears exactly once — inside the prohibition, never as a column.
    expect(html.toLowerCase().split('initials').length - 1).toBe(1);

    const blank = buildDocumentRequestHtml(packet({ content: { ...content(), sampling_approach: '  ' } }));
    expect(blank).toContain(SUBJECT_SELECTION_NOTICE);
    expect(blank).not.toContain('Sampling approach');
  });

  it('escapes HTML in every user-facing field', () => {
    const html = buildDocumentRequestHtml(packet());
    expect(html).toContain('A &lt;study&gt; &amp; trial');
    expect(html).not.toContain('A <study>');
  });

  it('signs as the lead auditor, with the signatory name when known', () => {
    expect(buildDocumentRequestHtml(packet())).toContain('Ada Auditor<br>Lead auditor</p>');
    const anonymous = buildDocumentRequestHtml(packet({ signatoryName: null, approvedByName: null }));
    expect(anonymous).toContain('>Lead auditor</p>');
    expect(anonymous).not.toContain('<br>Lead auditor');
    expect(anonymous).toMatch(/APPROVED — reviewed and approved on 0?5 Sep 2026/);
  });

  it('says so when nothing is requested', () => {
    const empty = content();
    empty.items = empty.items.map((i) => ({ ...i, included: false }));
    expect(buildDocumentRequestHtml(packet({ content: empty }))).toContain('No documents are requested.');
  });
});

describe('buildDocumentRequestPlain — fallback flavor', () => {
  it('mirrors the banner, the sections, and numbers lines continuously across groups', () => {
    const plain = buildDocumentRequestPlain(packet());
    expect(plain).toMatch(/^APPROVED — reviewed and approved by Ada Auditor on 0?5 Sep 2026/);
    expect(plain).toContain('DOCUMENT REQUEST — INVESTIGATOR SITE AUDIT');
    expect(plain).toContain('Audit dates: Sep 15 – 17, 2026');
    expect(plain).toContain('DELIVERY INSTRUCTIONS\nDocuments in room 4.\nElectronic records via read-only access.');
    expect(plain).toContain('DOCUMENTS REQUESTED');
    expect(plain).toContain('BASELINE DOCUMENTS\n1. Investigator site file (regulatory binder) with its current index');
    expect(plain).toContain('   Note: Include the <2025> log');
    expect(plain).not.toContain('Monitoring visit log');
    // 8 baseline lines (one excluded) + 6 consent lines → the IRB line is 15th, the chart 16th.
    expect(plain).toContain('IRB / EC\n15. IRB annual report');
    expect(plain).toContain('ADDITIONAL DOCUMENTS\n16. Site organisation chart');
    expect(plain.toLowerCase()).not.toContain('critical');
    expect(plain).toContain(`SUBJECT-LEVEL RECORDS\n${SUBJECT_SELECTION_NOTICE}\nSampling approach: ${DEFAULT_SAMPLING_APPROACH}`);
    expect(plain.endsWith('Ada Auditor\nLead auditor')).toBe(true);
  });
});
