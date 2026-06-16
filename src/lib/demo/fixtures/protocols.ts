import type { Protocol } from '../../../context/ProtocolContext';
import { DEMO_PROTOCOL_IDS } from '../ids';
import { addDays } from '../relativeDate';

// Three demo protocols — real study identities (study number / title / sponsor
// / phase taken from the parsed protocol PDFs), with synthetic site-mode data
// underneath. Anchored to "today" so visit projection always looks current.
// The DEMO_PROTOCOL_IDS keys are internal aliases (see ids.ts) — the real
// identity is what's set on `code` / `name` / `sponsor` / `phase` here.
export function getDemoProtocols(): Protocol[] {
  return [
    {
      id: DEMO_PROTOCOL_IDS['BRIGHTEN-2'],
      code: 'PP06489',
      name: 'A Phase 3, double-blind, placebo-controlled study of PledOx on top of modified FOLFOX6 to prevent chemotherapy-induced peripheral neuropathy (CIPN) in adjuvant treatment of Stage III / high-risk Stage II colorectal cancer',
      sponsor: 'PledPharma AB',
      phase: 'Phase 3',
      demoAnchorDate: addDays(-28), // mid-trial so chemo-cycle visits land "today-ish"
      timezone: null,
    },
    {
      id: DEMO_PROTOCOL_IDS['CARDIAC-7'],
      code: 'CLR_18_06',
      name: 'A Phase 2, randomized, double-blind, placebo-controlled study of K0706 in subjects with early Parkinson’s disease',
      sponsor: 'Sun Pharma Advanced Research Company (SPARC)',
      phase: 'Phase 2',
      demoAnchorDate: addDays(-14),
      timezone: null,
    },
    {
      id: DEMO_PROTOCOL_IDS['IMMUNE-14'],
      code: 'ND-L02-s0201-005',
      name: 'A Phase 2, randomized, double-blind, placebo-controlled study to evaluate the safety, tolerability, biological activity, and PK of ND-L02-s0201 in subjects with idiopathic pulmonary fibrosis (IPF)',
      sponsor: 'Nitto Denko Corporation',
      phase: 'Phase 2',
      demoAnchorDate: addDays(-15),
      timezone: null,
    },
  ];
}
