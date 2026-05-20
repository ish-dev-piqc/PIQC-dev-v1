// =============================================================================
// Site Mode — rule-based dynamic Ask prompts.
//
// Derives 4 protocol-grounded starter prompts from the active protocol's
// clinical phase, the presence/absence of an extracted schedule, and the
// roles staffed on the team. No LLM call — pure rules.
//
// Replaces a hand-tuned list that was identical across protocols. The new
// rules keep the "Schedule of assessments" prompt as a sticky default and
// vary the other three by phase + team composition.
// =============================================================================

import type { Protocol } from '../../context/ProtocolContext';
import type { SiteTeamMember } from './types';

export interface AskPromptInput {
  protocol: Protocol;
  team: SiteTeamMember[];
  hasVisitTemplates: boolean;
}

export interface AskPrompt {
  /** Lucide icon name — caller resolves to the component. */
  icon: 'Calendar' | 'ShieldCheck' | 'ClipboardList' | 'Pill' | 'FlaskConical' | 'Activity' | 'BarChart3' | 'Stethoscope';
  text: string;
}

function phaseBucket(phase: string): 'P1' | 'P2' | 'P3' | 'P4' | 'NA' {
  const p = phase.toUpperCase();
  // Catch "Phase 1" / "Phase 1/2" — anything mentioning 1 before higher digits.
  if (/\b1\b/.test(p) && !/\b3\b/.test(p) && !/\b4\b/.test(p)) return 'P1';
  if (/\b2\b/.test(p) && !/\b3\b/.test(p) && !/\b4\b/.test(p)) return 'P2';
  if (/\b3\b/.test(p) && !/\b4\b/.test(p)) return 'P3';
  if (/\b4\b/.test(p)) return 'P4';
  return 'NA';
}

const SCHEDULE_PROMPT = (code: string): AskPrompt => ({
  icon: 'Calendar',
  text: `What is the schedule of assessments for ${code}?`,
});

const NO_TEMPLATES_PROMPT = (code: string): AskPrompt => ({
  icon: 'Calendar',
  text: `Has the schedule of assessments for ${code} been finalised?`,
});

const ELIGIBILITY_PROMPT = (code: string): AskPrompt => ({
  icon: 'ClipboardList',
  text: `Summarise the inclusion and exclusion criteria for ${code}.`,
});

const PHASE_PROMPTS: Record<ReturnType<typeof phaseBucket>, (code: string) => AskPrompt[]> = {
  P1: (code) => [
    {
      icon: 'FlaskConical',
      text: `What are the dose escalation rules and DLT criteria for ${code}?`,
    },
    {
      icon: 'ShieldCheck',
      text: `What safety stopping rules apply for ${code}?`,
    },
  ],
  P2: (code) => [
    {
      icon: 'BarChart3',
      text: `What are the primary efficacy endpoints for ${code}?`,
    },
    {
      icon: 'Activity',
      text: `Which biomarker assessments are required for ${code}?`,
    },
  ],
  P3: (code) => [
    {
      icon: 'BarChart3',
      text: `How are primary endpoints adjudicated for ${code}?`,
    },
    {
      icon: 'ShieldCheck',
      text: `What SAE reporting timelines apply on ${code}?`,
    },
  ],
  P4: (code) => [
    {
      icon: 'Activity',
      text: `What post-marketing safety signals are being monitored for ${code}?`,
    },
    {
      icon: 'Stethoscope',
      text: `What real-world outcomes data must be collected on ${code}?`,
    },
  ],
  NA: (code) => [
    {
      icon: 'ShieldCheck',
      text: `What safety reporting requirements apply on ${code}?`,
    },
    {
      icon: 'Pill',
      text: `What are the visit windows and key timepoints for ${code}?`,
    },
  ],
};

/**
 * Returns exactly 4 prompts. Order:
 *   1. Schedule (or a hint about the schedule when templates aren't loaded)
 *   2. Eligibility / inclusion-exclusion (always useful)
 *   3-4. Two phase-specific prompts, optionally swapped for role-specific ones
 *        when key staff are present.
 */
export function deriveAskPrompts({
  protocol,
  team,
  hasVisitTemplates,
}: AskPromptInput): AskPrompt[] {
  const code = protocol.code;
  const phase = phaseBucket(protocol.phase ?? 'NA');

  const phaseSlots = PHASE_PROMPTS[phase](code);

  const hasPharmacist = team.some(
    (m) => m.status === 'ACTIVE' && m.role === 'PHARMACIST',
  );
  const hasMonitor = team.some(
    (m) => m.status === 'ACTIVE' && m.role === 'MONITOR',
  );

  // Role-aware swap: a pharmacist on team means drug-accountability is
  // pertinent enough to bump one of the phase prompts. Same for monitors and
  // monitoring-visit prep.
  const finalPhaseSlots = [...phaseSlots];
  if (hasPharmacist) {
    finalPhaseSlots[0] = {
      icon: 'Pill',
      text: `What are the drug accountability and storage requirements for ${code}?`,
    };
  }
  if (hasMonitor) {
    finalPhaseSlots[1] = {
      icon: 'ClipboardList',
      text: `What documentation will the monitor expect to verify for ${code}?`,
    };
  }

  return [
    hasVisitTemplates ? SCHEDULE_PROMPT(code) : NO_TEMPLATES_PROMPT(code),
    ELIGIBILITY_PROMPT(code),
    finalPhaseSlots[0],
    finalPhaseSlots[1],
  ];
}
