import { describe, expect, it } from 'vitest';
import {
  DELIVERABLE_EXPORT_CONFIGS,
  isExportableArtifactType,
} from '../deliverableExportConfig';
import {
  ARTIFACT_TYPE_LABELS,
  type DeliverableArtifactType,
} from '../../../types/deliverables';

// =============================================================================
// deliverableExportConfig — invariants every artifact type's export vocabulary
// must satisfy, so a new type can't ship a broken (or non-compliant) export.
// ARTIFACT_TYPE_LABELS is the canonical enumerator (whitelist-from-the-map).
// =============================================================================

const ALL_TYPES = Object.keys(ARTIFACT_TYPE_LABELS) as DeliverableArtifactType[];

describe('DELIVERABLE_EXPORT_CONFIGS', () => {
  it('has an entry for every artifact type (and no orphans)', () => {
    expect(Object.keys(DELIVERABLE_EXPORT_CONFIGS).sort()).toEqual([...ALL_TYPES].sort());
  });

  it('gives every type a filesystem-safe, unique filename slug', () => {
    const slugs = ALL_TYPES.map((t) => DELIVERABLE_EXPORT_CONFIGS[t].filenameSlug);
    for (const slug of slugs) expect(slug).toMatch(/^[a-z0-9_]+$/);
    expect(new Set(slugs).size).toBe(slugs.length); // unique
  });

  it('every header label carries the PIQC-drafted + DRAFT attribution', () => {
    for (const t of ALL_TYPES) {
      const label = DELIVERABLE_EXPORT_CONFIGS[t].headerLabel;
      expect(label, t).toMatch(/PIQC drafted/);
      expect(label, t).toMatch(/DRAFT/);
      expect(label, t).toContain('·');
    }
  });

  it('every disclaimer is a source-backed draft, control-stays-outside-PIQC, no approval vocab', () => {
    for (const t of ALL_TYPES) {
      const d = DELIVERABLE_EXPORT_CONFIGS[t].disclaimer;
      expect(d, t).toMatch(/PIQC/);
      expect(d, t).toMatch(/source-backed/);
      expect(d.toLowerCase(), t).toContain('draft');
      expect(d, t).toMatch(/outside PIQC/);
      expect(d.toLowerCase(), t).not.toContain('approv'); // draft-only doctrine
    }
  });

  it('labels every section it orders (no unlabeled section keys)', () => {
    for (const t of ALL_TYPES) {
      const { sectionOrder, sectionLabels } = DELIVERABLE_EXPORT_CONFIGS[t];
      expect(sectionOrder.length, t).toBeGreaterThan(0);
      for (const key of sectionOrder) {
        expect(sectionLabels[key], `${t} → ${key}`).toBeTruthy();
      }
    }
  });

  it('the monitoring entry preserves the original filename slug (back-compat)', () => {
    expect(DELIVERABLE_EXPORT_CONFIGS.monitoring_prep_checklist.filenameSlug).toBe(
      'monitoring_prep_checklist',
    );
  });
});

describe('isExportableArtifactType', () => {
  it('accepts every known artifact type', () => {
    for (const t of ALL_TYPES) expect(isExportableArtifactType(t)).toBe(true);
  });

  it('rejects unknown / non-string values', () => {
    expect(isExportableArtifactType('fragility_map')).toBe(false);
    expect(isExportableArtifactType('')).toBe(false);
    expect(isExportableArtifactType(null)).toBe(false);
    expect(isExportableArtifactType(undefined)).toBe(false);
    expect(isExportableArtifactType(42)).toBe(false);
    // Must not be fooled by inherited Object.prototype keys.
    expect(isExportableArtifactType('toString')).toBe(false);
    expect(isExportableArtifactType('constructor')).toBe(false);
  });
});
