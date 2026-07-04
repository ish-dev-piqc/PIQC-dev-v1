import { describe, it, expect } from 'vitest';
import { stagesForWorkflow } from '../workflowStages';
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
