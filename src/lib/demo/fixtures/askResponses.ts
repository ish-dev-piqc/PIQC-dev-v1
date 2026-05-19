import { DEMO_PROTOCOL_IDS } from '../ids';

// Pre-canned responses for the Ask tab when in demo mode. Keyed by protocol
// id; each protocol has a handful of question → answer pairs covering the
// same prompts AskTab.tsx surfaces as suggested questions.
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
  [DEMO_PROTOCOL_IDS['BRIGHTEN-2']]: [
    {
      key: 'schedule of assessments',
      answer:
        'BRIGHTEN-2 has six scheduled visits per participant: Screening (Day -14), Day 1 baseline, Week 1 (Day 7), Week 2 (Day 14), Week 6 (Day 42), and End of Study (Day 84). Most visit windows are ±2 days, with screening allowing up to +7 days and end-of-study up to ±7 days.',
      citations: [
        { document_title: 'BRIGHTEN-2 — Protocol v4.0', page: 12, snippet: 'Schedule of events table 6.1' },
      ],
    },
    {
      key: 'inclusion',
      answer:
        'BRIGHTEN-2 enrolls adults 18-65 with a DSM-5 diagnosis of moderate-to-severe MDD (HAM-D ≥ 22) and a HAM-D score that has not responded to at least one adequate prior antidepressant trial in the current episode. Key exclusion criteria include active suicidality (C-SSRS ≥ 4), bipolar disorder, primary psychotic disorder, and concurrent ECT/TMS.',
      citations: [
        { document_title: 'BRIGHTEN-2 — Protocol v4.0', page: 18, snippet: 'Section 4.1 Inclusion criteria' },
        { document_title: 'BRIGHTEN-2 — Protocol v4.0', page: 19, snippet: 'Section 4.2 Exclusion criteria' },
      ],
    },
    {
      key: 'safety reporting',
      answer:
        'Adverse events are graded per CTCAE v5.0 and recorded at every visit. Serious adverse events (SAEs) require reporting to the sponsor within 24 hours of investigator awareness; suspected unexpected serious adverse reactions (SUSARs) follow ICH E2A timelines (7 days for fatal/life-threatening, 15 days for others).',
      citations: [
        { document_title: 'BRIGHTEN-2 — Protocol v4.0', page: 31, snippet: 'Section 7.4 Safety reporting' },
      ],
    },
    {
      key: 'visit window',
      answer:
        'Visit windows in BRIGHTEN-2 are ±2 days for all post-baseline assessments except Screening (0 to +7 days) and End of Study (±7 days). Visits conducted outside these windows are protocol deviations and require PI sign-off plus a logged justification.',
      citations: [
        { document_title: 'BRIGHTEN-2 — Protocol v4.0', page: 14, snippet: 'Section 6.2 Visit windows' },
      ],
    },
  ],

  [DEMO_PROTOCOL_IDS['CARDIAC-7']]: [
    {
      key: 'schedule of assessments',
      answer:
        'CARDIAC-7 has five scheduled visits: Screening (Day -7), Day 4 baseline, Day 7, Day 14, and Day 30 follow-up. Visit windows are ±1-2 days for early visits and ±5 days for the Day 30 follow-up. ECG and vitals are collected at every visit.',
      citations: [
        { document_title: 'CARDIAC-7 — Protocol v2.1', page: 9, snippet: 'Table 5.1 Schedule of activities' },
      ],
    },
    {
      key: 'inclusion',
      answer:
        'CARDIAC-7 enrolls adults ≥ 18 with chronic heart failure (NYHA Class II-III) and LVEF ≤ 40% on stable optimal medical therapy for ≥ 4 weeks. Exclusion criteria include recent (< 90 days) acute coronary syndrome, severe renal impairment (eGFR < 30), and active malignancy.',
    },
    {
      key: 'safety reporting',
      answer:
        'Standard ICH E2A reporting: SAEs to sponsor within 24 hours, SUSARs within 7-15 days depending on severity. Cardiovascular events of interest (CVEs) have additional adjudication requirements per the independent Endpoint Adjudication Committee.',
    },
  ],

  [DEMO_PROTOCOL_IDS['IMMUNE-14']]: [
    {
      key: 'schedule of assessments',
      answer:
        'IMMUNE-14 has five visits per participant in this first-in-human dose-escalation: Screening (Day -14), Dose 1 (Day 1), Dose 2 (Day 15), Post-dose follow-up (Day 17), and End of Treatment (Day 28). Each dose administration includes a 2-hour observation period.',
    },
    {
      key: 'inclusion',
      answer:
        'IMMUNE-14 enrolls adults 18-55 with confirmed autoimmune disease per the relevant diagnostic criteria, stable disease for ≥ 3 months, and adequate organ function. Exclusion includes active infection, prior biologic therapy within 6 months, and pregnancy or breastfeeding.',
    },
    {
      key: 'safety reporting',
      answer:
        'Given the first-in-human design, IMMUNE-14 has enhanced safety monitoring. Any DLT (dose-limiting toxicity) in the first 28 days triggers the SRC (Safety Review Committee) to convene within 72 hours. SAEs reported within 24 hours per ICH E2A; CRS events require immediate sponsor notification.',
    },
  ],
};

export const DEMO_FALLBACK_ASK_RESPONSE: DemoAskResponse = {
  key: '__fallback__',
  answer:
    "I don't have a specific demo answer for that. In production, the assistant would search the protocol's tagged documents and return a cited response. Try one of the suggested prompts above for a worked example.",
};
