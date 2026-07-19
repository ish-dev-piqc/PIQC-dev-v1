// =============================================================================
// draftClarificationQuery — the PIQC-drafted sponsor clarification query
// (narrative-first spec §5.4). Deterministic render of a divergence record:
// verbatim/extracted quotes + FIXED per-class connective scaffolding — zero
// generated prose, so the draft is re-derivable in audit and structurally
// incapable of taking a position. It asks; it never asserts.
//
// Bounds that do not move: this is a DRAFT, human-owned and human-sent. No
// outbound send from PIQC, ever. No sponsor contact. No sponsor branding —
// plain text the site sends under its own identity.
// =============================================================================

import type { DivergenceClass, DivergenceReading, DivergenceRecord } from '../../types/divergence';

const CLASS_PHRASE: Record<DivergenceClass, (d: DivergenceRecord) => string> = {
  window_mismatch: (d) => `the scheduling window for ${d.visit_name ?? 'this visit'}`,
  presence: (d) =>
    `whether ${d.procedure_label ?? 'this procedure'} is required at ${d.visit_name ?? 'this visit'}`,
  cohort_scope: () => 'which cohorts this applies to',
};

function readingLine(r: DivergenceReading, name: string): string {
  const where = r.section ? ` (${r.section}${r.page != null ? `, p.${r.page}` : ''})` : '';
  const verb = r.verbatim ? 'states' : 'was recorded by extraction as';
  return `${name}${where} ${verb}:\n    "${r.quote}"`;
}

export function draftClarificationQuery(
  d: DivergenceRecord,
  opts: { protocolCode?: string | null } = {},
): string {
  const code = opts.protocolCode && opts.protocolCode.trim() ? opts.protocolCode.trim() : 'this protocol';
  const locus = [d.visit_name, d.procedure_label].filter(Boolean).join(', ');
  return [
    `Subject: ${code} — clarification request${locus ? `: ${locus}` : ''}`,
    '',
    readingLine(d.reading_b, 'The protocol narrative'),
    readingLine(d.reading_a, 'The Schedule of Assessments'),
    '',
    `These read differently regarding ${CLASS_PHRASE[d.divergence_class](d)}.`,
    'Could you confirm which reading governs, and whether a clarification or amendment is planned?',
  ].join('\n');
}
