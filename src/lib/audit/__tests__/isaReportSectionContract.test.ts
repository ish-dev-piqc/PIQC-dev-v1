import { describe, it, expect } from 'vitest';
// Deno-side section contract, unit-tested cross-tree like the finding gates.
import {
  buildResponseClause as denoBuildResponseClause,
  COMPLIANCE_STATEMENT,
  gateSection,
  ISA_DOMAIN_LABELS as DENO_DOMAIN_LABELS,
  VERDICT_SENTENCES as DENO_VERDICT_SENTENCES,
} from '../../../../supabase/functions/isa-report-draft/sectionContract';
import {
  buildExecSummary,
  buildResponseClause,
  VERDICT_SENTENCES,
} from '../isaReportModel';
import { ISA_DOMAIN_LABELS } from '../labels';

// =============================================================================
// PARITY — the anchor constants are duplicated Deno-side because edge
// functions can't import the client tree. These tests are the sync contract:
// if either copy drifts, a test fails and the drift is a decision, not an
// accident.
// =============================================================================

describe('client ↔ edge constant parity', () => {
  it('verdict sentences match exactly', () => {
    expect(DENO_VERDICT_SENTENCES).toEqual(VERDICT_SENTENCES);
  });

  it('response clause builders agree on both bases', () => {
    expect(denoBuildResponseClause(30, 'CALENDAR')).toBe(buildResponseClause(30, 'CALENDAR'));
    expect(denoBuildResponseClause(14, 'BUSINESS')).toBe(buildResponseClause(14, 'BUSINESS'));
  });

  it('domain labels match exactly', () => {
    expect(DENO_DOMAIN_LABELS).toEqual(ISA_DOMAIN_LABELS);
  });

  it('the compliance statement is the one the client template derives', () => {
    // COMPLIANCE_STATEMENT is not exported client-side; the derived template
    // is the source of truth — the Deno copy must appear in it verbatim.
    const derived = buildExecSummary(null, []);
    expect(derived.text).toContain(COMPLIANCE_STATEMENT);
  });
});

// =============================================================================
// The anchor gate
// =============================================================================

describe('gateSection', () => {
  const anchors = [
    { label: 'Compliance statement', text: COMPLIANCE_STATEMENT },
    { label: 'Site-continuation sentence', text: DENO_VERDICT_SENTENCES.CONTINUE },
    { label: 'Response clause', text: denoBuildResponseClause(30, 'CALENDAR') },
  ];
  const goodDraft = [
    COMPLIANCE_STATEMENT,
    'No critical observations were made during the audit.',
    DENO_VERDICT_SENTENCES.CONTINUE,
    denoBuildResponseClause(30, 'CALENDAR'),
  ].join(' ');

  it('passes a draft carrying every anchor verbatim', () => {
    expect(gateSection('exec_summary', goodDraft, anchors)).toEqual({ ok: true, missing: [] });
  });

  it('withholds a draft that rewrote an anchor, naming what is missing', () => {
    const paraphrased = goodDraft.replace(
      DENO_VERDICT_SENTENCES.CONTINUE,
      'The site can keep going without extra monitoring.',
    );
    const res = gateSection('exec_summary', paraphrased, anchors);
    expect(res.ok).toBe(false);
    expect(res.missing).toEqual(['Site-continuation sentence']);
  });

  it('rejects empty and over-length drafts', () => {
    expect(gateSection('exec_summary', '   ', anchors).ok).toBe(false);
    expect(gateSection('auditee_background', 'x'.repeat(3_001), []).ok).toBe(false);
  });

  it('note sections gate on emptiness/length only (no anchors)', () => {
    expect(gateSection('opening_meeting', 'The meeting was hosted by the investigator.', [])).toEqual({
      ok: true,
      missing: [],
    });
  });
});
