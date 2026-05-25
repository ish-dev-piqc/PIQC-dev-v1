import type { Protocol } from '../../../context/ProtocolContext';
import { DEMO_PROTOCOL_IDS } from '../ids';
import { addDays } from '../relativeDate';

// Three demo protocols — anchored to "today" so visit projection always
// looks current. Phase labels match the PHASE_LABELS map in ProtocolContext.
export function getDemoProtocols(): Protocol[] {
  return [
    {
      id: DEMO_PROTOCOL_IDS['BRIGHTEN-2'],
      code: 'BRIGHTEN-2',
      name: 'BRIGHTEN-2: Phase 2 study evaluating investigational therapy in major depressive disorder',
      sponsor: 'Demo Sponsor A',
      phase: 'Phase 2',
      demoAnchorDate: addDays(-28), // anchor 4 weeks ago so mid-trial visits land "today-ish"
      timezone: null,
    },
    {
      id: DEMO_PROTOCOL_IDS['CARDIAC-7'],
      code: 'CARDIAC-7',
      name: 'CARDIAC-7: Phase 3 outcomes trial in chronic heart failure',
      sponsor: 'Demo Sponsor B',
      phase: 'Phase 3',
      demoAnchorDate: addDays(-14),
      timezone: null,
    },
    {
      id: DEMO_PROTOCOL_IDS['IMMUNE-14'],
      code: 'IMMUNE-14',
      name: 'IMMUNE-14: Phase 1 first-in-human dose-escalation in autoimmune disease',
      sponsor: 'Demo Sponsor C',
      phase: 'Phase 1',
      demoAnchorDate: addDays(-15),
      timezone: null,
    },
  ];
}
