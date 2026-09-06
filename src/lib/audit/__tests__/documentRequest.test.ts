// documentRequest — the Audit prep derivation. Pins the contract the saved
// document relies on: the vocabulary's invariants (unique keys, baseline
// wins, the subject-selection phrasing, no sponsor names), the build
// (baseline first, then each scope module's set in the scope's own order
// with the criticality pinned), the merge that keeps an auditor's includes
// and notes across a rebuild, drift by (domain, criticality), and the one
// grouping every renderer shares.

import { describe, it, expect } from 'vitest';
import type {
  DerivedCriticality,
  DocumentRequestContent,
  IsaDomain,
  SiteScopeModule,
} from '../../../types/audit';
import { ISA_DOMAIN_LABELS } from '../labels';
import {
  BASELINE_DOCUMENTS,
  DEFAULT_SAMPLING_APPROACH,
  DOMAIN_DOCUMENTS,
  SUBJECT_SELECTION_NOTICE,
} from '../documentRequestVocabulary';
import {
  ADDITIONAL_GROUP_HEADING,
  BASELINE_GROUP_HEADING,
  buildDocumentRequestContent,
  groupDocumentRequestItems,
  hasDrift,
  mergeRebuild,
  newAuditorItem,
  newAuditorItemKey,
  requestDrift,
  type DocumentRequestScopeSource,
} from '../documentRequest';

const NOW = '2026-09-06T10:00:00.000Z';

function module(isa_domain: IsaDomain, criticality: DerivedCriticality): SiteScopeModule {
  return { isa_domain, criticality, items: [] };
}

function scope(modules: SiteScopeModule[], id = 'scope-1'): DocumentRequestScopeSource {
  return { id, content: { built_from: { mapping_ids: [], built_at: NOW }, modules } };
}

const DOMAINS = Object.keys(ISA_DOMAIN_LABELS) as IsaDomain[];
const ALL_STANDARD = [...BASELINE_DOCUMENTS, ...DOMAINS.flatMap((d) => DOMAIN_DOCUMENTS[d])];

describe('documentRequestVocabulary — invariants', () => {
  it('every key is unique across the baseline and every domain set', () => {
    const keys = ALL_STANDARD.map((d) => d.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('baseline keys are baseline:*, domain keys are prefixed by their own domain', () => {
    expect(BASELINE_DOCUMENTS).toHaveLength(9);
    for (const doc of BASELINE_DOCUMENTS) expect(doc.key.startsWith('baseline:')).toBe(true);
    for (const domain of DOMAINS) {
      for (const doc of DOMAIN_DOCUMENTS[domain]) expect(doc.key.startsWith(`${domain}:`)).toBe(true);
    }
  });

  it('baseline wins: no domain set re-lists a baseline title; OTHER has no standard set; the rest have 3–6 lines', () => {
    const baselineTitles = new Set(BASELINE_DOCUMENTS.map((d) => d.title));
    expect(DOMAIN_DOCUMENTS.OTHER).toEqual([]);
    for (const domain of DOMAINS) {
      if (domain === 'OTHER') continue;
      expect(DOMAIN_DOCUMENTS[domain].length).toBeGreaterThanOrEqual(3);
      expect(DOMAIN_DOCUMENTS[domain].length).toBeLessThanOrEqual(6);
      for (const doc of DOMAIN_DOCUMENTS[domain]) expect(baselineTitles.has(doc.title)).toBe(false);
    }
  });

  it('titles are non-empty, name no sponsor or vendor, and never a pre-selected sample', () => {
    for (const doc of ALL_STANDARD) {
      expect(doc.title.trim()).toBe(doc.title);
      expect(doc.title.length).toBeGreaterThan(0);
      const text = `${doc.title} ${doc.detail ?? ''}`.toLowerCase();
      expect(text).not.toContain('sponsor');
      expect(text).not.toContain('vendor');
      expect(text).not.toContain('sampled subjects');
    }
  });

  it('every subject-level line asks for the subjects selected during the audit, by subject number only', () => {
    const subjectLevel = ALL_STANDARD.filter((d) => d.title.includes('selected during the audit'));
    expect(subjectLevel.length).toBeGreaterThan(5);
    for (const doc of subjectLevel) expect(doc.title).toContain('(subject numbers only)');
  });

  it('the default sampling approach and the subject-selection notice say what the owner decided', () => {
    expect(DEFAULT_SAMPLING_APPROACH).toContain('selected by the auditor during the audit');
    expect(DEFAULT_SAMPLING_APPROACH).toContain('serious adverse event or a protocol deviation');
    expect(SUBJECT_SELECTION_NOTICE).toContain('subject number only');
    expect(SUBJECT_SELECTION_NOTICE).toContain('must not be sent to the auditor');
    expect(SUBJECT_SELECTION_NOTICE.toLowerCase()).not.toContain('sampled');
  });
});

describe('buildDocumentRequestContent', () => {
  it('lists the baseline first, then each scope module’s standard set in the scope’s own order, criticality pinned', () => {
    const content = buildDocumentRequestContent(
      // The scope's order is inherited, never re-sorted — HIGH before CRITICAL here.
      scope([module('SOURCE_DATA_VERIFICATION', 'HIGH'), module('INFORMED_CONSENT', 'CRITICAL')]),
      NOW,
    );

    const baselineKeys = BASELINE_DOCUMENTS.map((d) => d.key);
    expect(content.items.slice(0, 9).map((i) => i.key)).toEqual(baselineKeys);
    for (const item of content.items.slice(0, 9)) expect(item.basis).toEqual({ kind: 'baseline' });

    const sdv = DOMAIN_DOCUMENTS.SOURCE_DATA_VERIFICATION.map((d) => d.key);
    const ic = DOMAIN_DOCUMENTS.INFORMED_CONSENT.map((d) => d.key);
    expect(content.items.slice(9).map((i) => i.key)).toEqual([...sdv, ...ic]);
    expect(content.items[9].basis).toEqual({
      kind: 'module',
      isa_domain: 'SOURCE_DATA_VERIFICATION',
      criticality: 'HIGH',
    });
    expect(content.items[content.items.length - 1].basis).toEqual({
      kind: 'module',
      isa_domain: 'INFORMED_CONSENT',
      criticality: 'CRITICAL',
    });

    for (const item of content.items) {
      expect(item.included).toBe(true);
      expect(item.note).toBe('');
    }
    expect(content.built_from).toEqual({
      scope_id: 'scope-1',
      scope_modules: [
        { isa_domain: 'SOURCE_DATA_VERIFICATION', criticality: 'HIGH' },
        { isa_domain: 'INFORMED_CONSENT', criticality: 'CRITICAL' },
      ],
      built_at: NOW,
    });
    expect(content.sampling_approach).toBe(DEFAULT_SAMPLING_APPROACH);
    expect(content.instructions).toBe('');
  });

  it('carries the vocabulary’s detail line when there is one, and no detail key otherwise', () => {
    const content = buildDocumentRequestContent(scope([]), NOW);
    const isf = content.items.find((i) => i.key === 'baseline:isf_index');
    const monitoring = content.items.find((i) => i.key === 'baseline:monitoring_visit_log');
    expect(isf?.detail).toContain('table of contents');
    expect(monitoring).not.toHaveProperty('detail');
  });

  it('an OTHER module adds nothing; an empty scope is the baseline alone', () => {
    expect(buildDocumentRequestContent(scope([module('OTHER', 'LOW')]), NOW).items).toHaveLength(9);
    const empty = buildDocumentRequestContent(scope([]), NOW);
    expect(empty.items).toHaveLength(9);
    expect(empty.built_from.scope_modules).toEqual([]);
  });

  it('is deterministic: the same scope and time give the same document', () => {
    const s = scope([module('INFORMED_CONSENT', 'CRITICAL'), module('IRB_EC', 'MODERATE')]);
    expect(buildDocumentRequestContent(s, NOW)).toEqual(buildDocumentRequestContent(s, NOW));
  });
});

describe('mergeRebuild', () => {
  const existing: DocumentRequestContent = {
    ...buildDocumentRequestContent(scope([module('INFORMED_CONSENT', 'HIGH')]), NOW),
    sampling_approach: 'All subjects with a deviation.',
    instructions: 'Room 4.',
  };
  existing.items = existing.items.map((item) =>
    item.key === 'baseline:isf_index'
      ? { ...item, included: false }
      : item.key === 'INFORMED_CONSENT:icf_versions'
      ? { ...item, note: 'Since 2024' }
      : item,
  );
  existing.items.push(newAuditorItem(existing.items, 'Site organisation chart', null, 1));

  const fresh = buildDocumentRequestContent(
    scope([module('INFORMED_CONSENT', 'CRITICAL'), module('IRB_EC', 'MODERATE')]),
    '2026-09-07T10:00:00.000Z',
  );
  const merged = mergeRebuild(existing, fresh);

  it('keeps included and note by key; title, detail and basis come from the fresh build', () => {
    expect(merged.items.find((i) => i.key === 'baseline:isf_index')?.included).toBe(false);
    const icf = merged.items.find((i) => i.key === 'INFORMED_CONSENT:icf_versions');
    expect(icf?.note).toBe('Since 2024');
    // The criticality moved HIGH → CRITICAL; the pinned basis follows the fresh build.
    expect(icf?.basis).toEqual({ kind: 'module', isa_domain: 'INFORMED_CONSENT', criticality: 'CRITICAL' });
  });

  it('new standard lines arrive included with an empty note', () => {
    const roster = merged.items.find((i) => i.key === 'IRB_EC:roster_assurance');
    expect(roster).toMatchObject({ included: true, note: '' });
  });

  it('standard lines no longer derivable are dropped; auditor lines are kept, after the standard ones', () => {
    const shrunk = mergeRebuild(existing, buildDocumentRequestContent(scope([]), NOW));
    expect(shrunk.items.some((i) => i.key.startsWith('INFORMED_CONSENT:'))).toBe(false);
    expect(shrunk.items[shrunk.items.length - 1]).toMatchObject({
      title: 'Site organisation chart',
      basis: { kind: 'auditor', isa_domain: null },
    });
    expect(merged.items[merged.items.length - 1].title).toBe('Site organisation chart');
  });

  it('carries the letter fields from the existing request and built_from from the fresh build', () => {
    expect(merged.sampling_approach).toBe('All subjects with a deviation.');
    expect(merged.instructions).toBe('Room 4.');
    expect(merged.built_from).toEqual(fresh.built_from);
  });
});

describe('requestDrift', () => {
  const content = buildDocumentRequestContent(
    scope([module('INFORMED_CONSENT', 'CRITICAL'), module('IRB_EC', 'MODERATE')]),
    NOW,
  );

  it('no drift while the live modules match, whatever their order', () => {
    const drift = requestDrift(content, [module('IRB_EC', 'MODERATE'), module('INFORMED_CONSENT', 'CRITICAL')]);
    expect(drift).toEqual({ added: 0, removed: 0, changed: 0 });
    expect(hasDrift(drift)).toBe(false);
  });

  it('counts modules added, removed, and those whose criticality changed', () => {
    expect(
      requestDrift(content, [
        module('INFORMED_CONSENT', 'CRITICAL'),
        module('IRB_EC', 'MODERATE'),
        module('SOP_REVIEW', 'LOW'),
      ]),
    ).toEqual({ added: 1, removed: 0, changed: 0 });
    expect(requestDrift(content, [module('INFORMED_CONSENT', 'CRITICAL')])).toEqual({
      added: 0,
      removed: 1,
      changed: 0,
    });
    expect(requestDrift(content, [module('INFORMED_CONSENT', 'HIGH'), module('IRB_EC', 'MODERATE')])).toEqual({
      added: 0,
      removed: 0,
      changed: 1,
    });
    const all = requestDrift(content, [module('INFORMED_CONSENT', 'LOW'), module('SAFETY_AE_SAE', 'HIGH')]);
    expect(all).toEqual({ added: 1, removed: 1, changed: 1 });
    expect(hasDrift(all)).toBe(true);
  });

  it('a vanished scope reads as every module removed', () => {
    expect(requestDrift(content, [])).toEqual({ added: 0, removed: 2, changed: 0 });
  });
});

describe('groupDocumentRequestItems', () => {
  const content = buildDocumentRequestContent(
    scope([module('SOURCE_DATA_VERIFICATION', 'HIGH'), module('INFORMED_CONSENT', 'CRITICAL')]),
    NOW,
  );
  content.items = content.items.map((item) =>
    item.key === 'baseline:monitoring_visit_log' ? { ...item, included: false } : item,
  );
  content.items.push(
    newAuditorItem(content.items, 'Consent training slides', 'INFORMED_CONSENT', 1),
    newAuditorItem(content.items, 'IRB annual report', 'IRB_EC', 2),
    newAuditorItem(content.items, 'Site organisation chart', null, 3),
  );

  it('orders baseline, the scope’s modules in scope order, out-of-scope domains carrying a line, then additional', () => {
    const groups = groupDocumentRequestItems(content, false);
    expect(groups.map((g) => [g.heading, g.criticality])).toEqual([
      [BASELINE_GROUP_HEADING, null],
      ['Source data verification', 'HIGH'],
      ['Informed consent', 'CRITICAL'],
      ['IRB / EC', null],
      [ADDITIONAL_GROUP_HEADING, null],
    ]);
    expect(groups[0].items).toHaveLength(9);
  });

  it('an auditor line tagged with an in-scope module joins that module’s group', () => {
    const consent = groupDocumentRequestItems(content, false).find((g) => g.key === 'INFORMED_CONSENT');
    expect(consent?.items.map((i) => i.title)).toContain('Consent training slides');
    expect(consent?.items).toHaveLength(DOMAIN_DOCUMENTS.INFORMED_CONSENT.length + 1);
  });

  it('includedOnly drops excluded lines and, with them, empty groups', () => {
    const groups = groupDocumentRequestItems(content, true);
    expect(groups[0].items.map((i) => i.key)).not.toContain('baseline:monitoring_visit_log');
    expect(groups[0].items).toHaveLength(8);

    const nothing = { ...content, items: content.items.map((i) => ({ ...i, included: false })) };
    expect(groupDocumentRequestItems(nothing, true)).toEqual([]);
  });
});

describe('newAuditorItemKey', () => {
  it('is auditor:<ms>, suffixed only when that key is already taken', () => {
    expect(newAuditorItemKey([], 1700)).toBe('auditor:1700');
    const taken = [newAuditorItem([], 'A', null, 1700)];
    expect(newAuditorItemKey(taken, 1700)).toBe('auditor:1700-2');
    const twice = [...taken, newAuditorItem(taken, 'B', null, 1700)];
    expect(twice[1].key).toBe('auditor:1700-2');
    expect(newAuditorItemKey(twice, 1700)).toBe('auditor:1700-3');
  });
});
