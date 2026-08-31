import { describe, it, expect } from 'vitest';
import { hasReachedStage, stagesForWorkflow } from '../workflowStages';
import { AUDIT_STAGES, AUDIT_WORKFLOW_TYPES } from '../../../types/audit';

// Regression gate for the two-workflow foundation: VENDOR_AUDIT must resolve to
// exactly the canonical 8-stage pipeline, in order, so wiring the shell/StageNav
// through the resolver instead of the global AUDIT_STAGES is behavior-preserving.
describe('stagesForWorkflow', () => {
  it('VENDOR_AUDIT returns the canonical 8-stage pipeline verbatim', () => {
    expect(stagesForWorkflow('VENDOR_AUDIT')).toEqual([
      'INTAKE',
      'VENDOR_ENRICHMENT',
      'QUESTIONNAIRE_REVIEW',
      'SCOPE_AND_RISK_REVIEW',
      'PRE_AUDIT_DRAFTING',
      'AUDIT_CONDUCT',
      'REPORT_DRAFTING',
      'FINAL_REVIEW_EXPORT',
    ]);
  });

  it('VENDOR_AUDIT is identical to AUDIT_STAGES (no drift)', () => {
    expect(stagesForWorkflow('VENDOR_AUDIT')).toEqual([...AUDIT_STAGES]);
  });

  it('INVESTIGATOR_SITE_AUDIT returns the 7-stage ISA pipeline in order', () => {
    expect(stagesForWorkflow('INVESTIGATOR_SITE_AUDIT')).toEqual([
      'ISA_SITE_INTAKE',
      'ISA_RISK_ASSESSMENT',
      'ISA_SCOPE_BUILDER',
      'ISA_PREP',
      'ISA_CONDUCT',
      'ISA_REPORT',
      'ISA_EXPORT',
    ]);
  });

  it('the two workflows share no stage (dispatch stays isolated)', () => {
    const vendor = new Set(stagesForWorkflow('VENDOR_AUDIT'));
    const investigator = stagesForWorkflow('INVESTIGATOR_SITE_AUDIT');
    for (const stage of investigator) {
      expect(vendor.has(stage)).toBe(false);
    }
  });

  it('resolves a non-empty stage list for every declared workflow type', () => {
    for (const wf of AUDIT_WORKFLOW_TYPES) {
      expect(stagesForWorkflow(wf).length).toBeGreaterThan(0);
    }
  });
});

describe('hasReachedStage', () => {
  it('current and past stages are reached; the one-ahead preview is not', () => {
    expect(hasReachedStage('VENDOR_AUDIT', 'AUDIT_CONDUCT', 'AUDIT_CONDUCT')).toBe(true);
    expect(hasReachedStage('VENDOR_AUDIT', 'AUDIT_CONDUCT', 'INTAKE')).toBe(true);
    expect(hasReachedStage('VENDOR_AUDIT', 'AUDIT_CONDUCT', 'REPORT_DRAFTING')).toBe(false);
  });

  it('holds at both pipeline ends', () => {
    expect(hasReachedStage('VENDOR_AUDIT', 'INTAKE', 'INTAKE')).toBe(true);
    expect(hasReachedStage('VENDOR_AUDIT', 'INTAKE', 'FINAL_REVIEW_EXPORT')).toBe(false);
    expect(hasReachedStage('VENDOR_AUDIT', 'FINAL_REVIEW_EXPORT', 'INTAKE')).toBe(true);
    expect(hasReachedStage('VENDOR_AUDIT', 'FINAL_REVIEW_EXPORT', 'FINAL_REVIEW_EXPORT')).toBe(true);
  });

  it('works for the investigator pipeline', () => {
    expect(hasReachedStage('INVESTIGATOR_SITE_AUDIT', 'ISA_CONDUCT', 'ISA_PREP')).toBe(true);
    expect(hasReachedStage('INVESTIGATOR_SITE_AUDIT', 'ISA_PREP', 'ISA_CONDUCT')).toBe(false);
  });

  it('fails safe when a stage does not belong to the workflow pipeline', () => {
    expect(hasReachedStage('VENDOR_AUDIT', 'AUDIT_CONDUCT', 'ISA_CONDUCT')).toBe(false);
    expect(hasReachedStage('INVESTIGATOR_SITE_AUDIT', 'ISA_CONDUCT', 'AUDIT_CONDUCT')).toBe(false);
  });
});
