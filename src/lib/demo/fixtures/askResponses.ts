import { DEMO_PROTOCOL_IDS } from '../ids';

// Pre-canned responses for the Ask tab when in demo mode. Keyed by protocol
// id; each protocol has a handful of question → answer pairs covering the
// same prompts AskTab.tsx surfaces as suggested questions. Content is themed
// to each study's real design (synthetic specifics, no PHI).
//
// Matching is loose: the demo repo's "ask" function looks for the first
// response whose key is a substring of the user's question (case-insensitive).
// Fallback response is included so unmatched questions still get a sensible
// reply rather than a dead end.

export interface DemoAskResponse {
  key: string;       // substring matched against the user's question (lowercased)
  answer: string;
  citations?: Array<{ document_title: string; page?: number; snippet: string }>;
}

export const DEMO_ASK_RESPONSES: Record<string, DemoAskResponse[]> = {
  // PP06489 — PledOx / colorectal CIPN
  [DEMO_PROTOCOL_IDS['BRIGHTEN-2']]: [
    {
      key: 'schedule of assessments',
      answer:
        'PledOx/placebo is given as a short i.v. infusion (~5 minutes) 10 minutes before each modified FOLFOX6 cycle, on a Q2W schedule for the adjuvant chemotherapy course (up to 12 cycles). Neuropathy (CIPN) is assessed at baseline and at scheduled cycles using the FACT/GOG-Ntx instrument, with a safety follow-up roughly 30 days after the last dose.',
      citations: [
        { document_title: 'PP06489 — PledOx Protocol v5.0', page: 38, snippet: 'Schedule of assessments — Table 6.1' },
      ],
    },
    {
      key: 'inclusion',
      answer:
        'PP06489 enrolls adults with Stage III or high-risk Stage II colorectal cancer who are candidates for adjuvant mFOLFOX6, with adequate bone-marrow reserve (e.g. ANC and platelets above protocol thresholds) and organ function. Key exclusions include clinically significant pre-existing peripheral neuropathy and prior oxaliplatin exposure.',
      citations: [
        { document_title: 'PP06489 — PledOx Protocol v5.0', page: 20, snippet: 'Section 4.1 Inclusion criteria' },
        { document_title: 'PP06489 — PledOx Protocol v5.0', page: 22, snippet: 'Section 4.2 Exclusion criteria' },
      ],
    },
    {
      key: 'safety reporting',
      answer:
        'Adverse events are graded per NCI-CTCAE v4.03 and recorded each cycle. Serious adverse events (SAEs) are reported to the sponsor within 24 hours of investigator awareness; PledOx-attributable toxicities are tracked separately from chemotherapy-related toxicities. SUSARs follow ICH E2A timelines.',
      citations: [
        { document_title: 'PP06489 — PledOx Protocol v5.0', page: 55, snippet: 'Section 8 Safety reporting' },
      ],
    },
    {
      key: 'visit window',
      answer:
        'Cycle visits follow the Q2W chemotherapy schedule with a ±2-day window; the post-treatment safety follow-up allows ±7 days. Visits outside these windows are protocol deviations requiring PI sign-off and a logged justification.',
      citations: [
        { document_title: 'PP06489 — PledOx Protocol v5.0', page: 40, snippet: 'Section 6.2 Visit windows' },
      ],
    },
  ],

  // CLR_18_06 — K0706 / early Parkinson's
  [DEMO_PROTOCOL_IDS['CARDIAC-7']]: [
    {
      key: 'schedule of assessments',
      answer:
        'CLR_18_06 is a 40-week, randomized, double-blind, placebo-controlled study of once-daily oral K0706. Key visits are Screening (~Day -28), Baseline (Day 1, randomization), Week 8, Week 24, and the Week 40 primary-endpoint visit. MDS-UPDRS is collected at most visits; EQ-5D-5L, CGI-S, SCOPA-AUT and PK samples are collected per the schedule.',
      citations: [
        { document_title: 'CLR_18_06 — K0706 Protocol Amendment 02', page: 11, snippet: 'Table 5.1 Schedule of activities' },
      ],
    },
    {
      key: 'inclusion',
      answer:
        'CLR_18_06 enrolls adults with early Parkinson’s disease who do not yet require symptomatic dopaminergic therapy at entry. Exclusion criteria include atypical or secondary parkinsonism, prior use of disallowed PD medications, and clinically significant cardiac or hepatic abnormalities.',
    },
    {
      key: 'safety reporting',
      answer:
        'Standard ICH E2A reporting applies: SAEs to the sponsor within 24 hours, SUSARs within 7–15 days depending on severity. K0706 carries protocol-specified cardiac monitoring (including ECG/QT review) given its mechanism.',
    },
    {
      key: 'visit window',
      answer:
        'Early visits use a ±3-day window; later milestone visits (Week 24, Week 40) allow up to ±7 days. The Week 40 MDS-UPDRS (Parts 2+3) is the primary-endpoint assessment, so out-of-window visits there are escalated and logged as deviations.',
    },
  ],

  // ND-L02-s0201-005 — IPF
  [DEMO_PROTOCOL_IDS['IMMUNE-14']]: [
    {
      key: 'schedule of assessments',
      answer:
        'ND-L02-s0201-005 administers ND-L02-s0201 by i.v. infusion (45 mg or 90 mg) every 2 weeks for 24 weeks (12 doses). Spirometry (FVC) and DLCO are collected at screening, mid-study, and the Day 169 primary timepoint. Day 169 also serves as the end-of-treatment visit.',
      citations: [
        { document_title: 'ND-L02-s0201-005 — Protocol Amendment 04', page: 13, snippet: 'Schedule of assessments — Visit 1–14' },
      ],
    },
    {
      key: 'inclusion',
      answer:
        'ND-L02-s0201-005 enrolls adults with a confirmed diagnosis of idiopathic pulmonary fibrosis (per ATS/ERS criteria, central HRCT read) within the protocol-defined FVC range. Exclusions include other interstitial lung diseases, recent respiratory infection, and clinically significant comorbidities.',
    },
    {
      key: 'safety reporting',
      answer:
        'The primary endpoints are the incidence of AEs/SAEs and the proportion of subjects discontinuing study treatment due to AEs, so safety capture is central. Infusion-related reactions are monitored at each dosing visit; SAEs are reported to the sponsor within 24 hours per ICH E2A.',
    },
    {
      key: 'visit window',
      answer:
        'Q2W infusion visits use a ±2-day window; spirometry milestone visits (mid-study and Day 169) allow ±5 days. The Day 169 FVC assessment anchors the key secondary efficacy analysis, so deviations there are logged with justification.',
    },
  ],
};

export const DEMO_FALLBACK_ASK_RESPONSE: DemoAskResponse = {
  key: '__fallback__',
  answer:
    "I don't have a specific demo answer for that. In production, the assistant would search the protocol's tagged documents and return a cited response. Try one of the suggested prompts above for a worked example.",
};
