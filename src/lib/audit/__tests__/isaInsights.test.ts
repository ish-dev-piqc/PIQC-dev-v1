import { describe, it, expect } from 'vitest';
import {
  coverageByDomain,
  escalationSignals,
  MAJOR_ACCUMULATION_THRESHOLD,
  MINOR_ACCUMULATION_THRESHOLD,
} from '../isaInsights';
import type {
  AuditNoteObject,
  IsaDomain,
  IsaFindingObject,
  IsaSeverity,
} from '../../../types/audit';

const DOMAINS: IsaDomain[] = ['INFORMED_CONSENT', 'INVESTIGATIONAL_PRODUCT', 'IRB_EC'];

function note(overrides: Partial<AuditNoteObject> = {}): AuditNoteObject {
  return {
    id: crypto.randomUUID(),
    audit_id: 'audit-1',
    body: 'note',
    isa_domain: null,
    is_positive: false,
    deleted_at: null,
    promoted_finding_id: null,
    created_by: 'user-1',
    created_at: '2026-07-19T10:00:00Z',
    updated_at: '2026-07-19T10:00:00Z',
    ...overrides,
  };
}

function finding(domain: IsaDomain, severity: IsaSeverity): IsaFindingObject {
  return {
    id: crypto.randomUUID(),
    audit_id: 'audit-1',
    title: 't',
    isa_domain: domain,
    subcategory: null,
    severity,
    severity_rule: null,
    observation: 'o',
    evidence: [],
    reference: null,
    response_owner: 'SITE',
    origin: 'AUDITOR',
    created_by: 'user-1',
    created_at: '2026-07-19T10:00:00Z',
    updated_at: '2026-07-19T10:00:00Z',
  };
}

describe('coverageByDomain', () => {
  it('counts notes and findings per domain in display order', () => {
    const res = coverageByDomain(
      [
        note({ isa_domain: 'INFORMED_CONSENT' }),
        note({ isa_domain: 'INFORMED_CONSENT', is_positive: true }),
        note(),
      ],
      [finding('INVESTIGATIONAL_PRODUCT', 'MINOR')],
      DOMAINS,
    );

    expect(res.rows).toEqual([
      { domain: 'INFORMED_CONSENT', noteCount: 2, findingCount: 0 },
      { domain: 'INVESTIGATIONAL_PRODUCT', noteCount: 0, findingCount: 1 },
      { domain: 'IRB_EC', noteCount: 0, findingCount: 0 },
    ]);
    expect(res.untaggedNoteCount).toBe(1);
    expect(res.uncoveredCount).toBe(1);
  });

  it('positive notes count as coverage — the auditor looked', () => {
    const res = coverageByDomain(
      [note({ isa_domain: 'IRB_EC', is_positive: true })],
      [],
      DOMAINS,
    );
    expect(res.rows[2].noteCount).toBe(1);
    expect(res.uncoveredCount).toBe(2);
  });
});

describe('escalationSignals', () => {
  it('stays silent below both thresholds', () => {
    const findings = [
      ...Array.from({ length: MINOR_ACCUMULATION_THRESHOLD - 1 }, () =>
        finding('INFORMED_CONSENT', 'MINOR'),
      ),
      finding('IRB_EC', 'MAJOR'),
      finding('INVESTIGATIONAL_PRODUCT', 'CRITICAL'),
    ];
    expect(escalationSignals(findings)).toEqual([]);
  });

  it('fires the minor-accumulation rule per domain, not globally', () => {
    const findings = [
      ...Array.from({ length: MINOR_ACCUMULATION_THRESHOLD }, () =>
        finding('INFORMED_CONSENT', 'MINOR'),
      ),
      finding('IRB_EC', 'MINOR'),
      finding('IRB_EC', 'MINOR'),
    ];
    const signals = escalationSignals(findings);
    expect(signals).toEqual([
      {
        domain: 'INFORMED_CONSENT',
        severity: 'MINOR',
        count: MINOR_ACCUMULATION_THRESHOLD,
        suggests: 'MAJOR',
      },
    ]);
  });

  it('fires both rules for one domain and orders Critical suggestions first', () => {
    const findings = [
      ...Array.from({ length: MINOR_ACCUMULATION_THRESHOLD }, () =>
        finding('INFORMED_CONSENT', 'MINOR'),
      ),
      ...Array.from({ length: MAJOR_ACCUMULATION_THRESHOLD }, () =>
        finding('INFORMED_CONSENT', 'MAJOR'),
      ),
    ];
    const signals = escalationSignals(findings);
    expect(signals).toHaveLength(2);
    expect(signals[0].suggests).toBe('CRITICAL');
    expect(signals[1].suggests).toBe('MAJOR');
  });

  it('ignores CRITICAL and RECOMMENDATION findings entirely', () => {
    const findings = [
      finding('IRB_EC', 'CRITICAL'),
      finding('IRB_EC', 'CRITICAL'),
      finding('IRB_EC', 'RECOMMENDATION'),
      finding('IRB_EC', 'RECOMMENDATION'),
      finding('IRB_EC', 'RECOMMENDATION'),
    ];
    expect(escalationSignals(findings)).toEqual([]);
  });
});
