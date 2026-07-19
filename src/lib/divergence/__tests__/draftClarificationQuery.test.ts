import { describe, it, expect } from 'vitest';
import { adaptDivergenceRow } from '../divergenceAdapter';
import { draftClarificationQuery } from '../draftClarificationQuery';
import { validDivergenceRow as validRow } from './fixtures';
import type { DivergenceRecord } from '../../../types/divergence';

// =============================================================================
// draftClarificationQuery — the advisory boundary in test form. The draft must
// carry BOTH readings, label a non-verbatim one honestly, and take no position
// on which is right. PIQC drafts; the human sends; nobody here adjudicates.
// =============================================================================

describe('draftClarificationQuery', () => {
  const record = adaptDivergenceRow(validRow) as DivergenceRecord;

  it('carries both readings and the fixed asking scaffold — no verdict', () => {
    const q = draftClarificationQuery(record, { protocolCode: 'PP06489' });
    expect(q).toContain('Subject: PP06489 — clarification request: Visit 3');
    expect(q).toContain('"Visit 3 Day 15 (±2 days)"');
    expect(q).toContain('The Schedule of Assessments (Schedule of Assessments) states:');
    expect(q).toContain('was recorded by extraction as'); // non-verbatim honestly labeled
    expect(q).toContain('the scheduling window for Visit 3');
    expect(q).toContain('Could you confirm which reading governs');
    // position-free: the draft never says which reading is right
    expect(q).not.toMatch(/should be|is correct|is wrong|error\b/i);
  });

  it('is deterministic (re-derivable in audit)', () => {
    expect(draftClarificationQuery(record, { protocolCode: 'PP06489' })).toBe(
      draftClarificationQuery(record, { protocolCode: 'PP06489' }),
    );
  });
});
