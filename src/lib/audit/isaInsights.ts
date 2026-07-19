import type {
  AuditNoteObject,
  IsaDomain,
  IsaFindingObject,
} from '../../types/audit';

// =============================================================================
// ISA conduct insights — pure derivations over pad notes + findings.
//
// Zero LLM, zero fetch: everything here is computed from data the workspace
// already holds. Advisory-only by design (D-008): these functions surface
// signals; they never classify, write, or change severity.
//
//   coverageByDomain  — which of the 15 domains have fieldwork behind them.
//                       The auditor's worst failure mode is the blind spot
//                       discovered by the auditee at the closing meeting;
//                       the strip makes gaps visible while there's still
//                       time to look.
//   escalationSignals — the templates' two accumulation rules, live:
//                       minors accumulating in one domain suggest a systemic
//                       failure (consider Major); majors likewise toward
//                       Critical. The auditor decides; PIQC only cites the
//                       rule.
// =============================================================================

export interface DomainCoverage {
  domain: IsaDomain;
  noteCount: number;
  findingCount: number;
}

export interface CoverageSummary {
  rows: DomainCoverage[];
  /** Live notes with no domain tag — invisible to the strip, so said aloud. */
  untaggedNoteCount: number;
  /** Domains with neither notes nor findings. */
  uncoveredCount: number;
}

/**
 * Coverage per domain, in the caller's display order. Positive notes count —
 * a positive observation is evidence the auditor looked.
 */
export function coverageByDomain(
  notes: AuditNoteObject[],
  findings: IsaFindingObject[],
  domains: IsaDomain[],
): CoverageSummary {
  const noteCounts = new Map<IsaDomain, number>();
  let untaggedNoteCount = 0;
  for (const n of notes) {
    if (n.isa_domain) {
      noteCounts.set(n.isa_domain, (noteCounts.get(n.isa_domain) ?? 0) + 1);
    } else {
      untaggedNoteCount++;
    }
  }

  const findingCounts = new Map<IsaDomain, number>();
  for (const f of findings) {
    findingCounts.set(f.isa_domain, (findingCounts.get(f.isa_domain) ?? 0) + 1);
  }

  const rows: DomainCoverage[] = domains.map((domain) => ({
    domain,
    noteCount: noteCounts.get(domain) ?? 0,
    findingCount: findingCounts.get(domain) ?? 0,
  }));

  return {
    rows,
    untaggedNoteCount,
    uncoveredCount: rows.filter((r) => r.noteCount === 0 && r.findingCount === 0).length,
  };
}

// The S0 escalation rules: "an accumulation of minor errors ... suggests a
// systemic failure" (→ Major) and "an accumulation of major errors ...
// potential for a systemic failure" (→ Critical). Thresholds are the point
// where "accumulation" plausibly starts; the advisory names the rule and the
// auditor judges.
export const MINOR_ACCUMULATION_THRESHOLD = 3;
export const MAJOR_ACCUMULATION_THRESHOLD = 2;

export interface EscalationSignal {
  domain: IsaDomain;
  severity: 'MINOR' | 'MAJOR';
  count: number;
  suggests: 'MAJOR' | 'CRITICAL';
}

export function escalationSignals(findings: IsaFindingObject[]): EscalationSignal[] {
  const byDomain = new Map<IsaDomain, { minor: number; major: number }>();
  for (const f of findings) {
    if (f.severity !== 'MINOR' && f.severity !== 'MAJOR') continue;
    const bucket = byDomain.get(f.isa_domain) ?? { minor: 0, major: 0 };
    if (f.severity === 'MINOR') bucket.minor++;
    else bucket.major++;
    byDomain.set(f.isa_domain, bucket);
  }

  const signals: EscalationSignal[] = [];
  for (const [domain, { minor, major }] of byDomain.entries()) {
    if (major >= MAJOR_ACCUMULATION_THRESHOLD) {
      signals.push({ domain, severity: 'MAJOR', count: major, suggests: 'CRITICAL' });
    }
    if (minor >= MINOR_ACCUMULATION_THRESHOLD) {
      signals.push({ domain, severity: 'MINOR', count: minor, suggests: 'MAJOR' });
    }
  }

  // Highest-stakes first.
  return signals.sort((a, b) =>
    a.suggests === b.suggests ? b.count - a.count : a.suggests === 'CRITICAL' ? -1 : 1,
  );
}
