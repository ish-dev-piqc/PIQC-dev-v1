/* ============================================================================
   content.js — centralized copy for the PIQClinical website.
   Real draft sentences (not directions), written in the founder register:
   earned conviction, problem named with precision, never a résumé/CV tone.

   • Edit wording here without touching layout.
   • Everything is DRAFT — refine against sales-marketing-strategy.md (which wins
     on messaging). This file wins on nothing; the product facts live in FABLE-BRIEF.md §4.
   • `direction: true` marks Platform-direction items that must be visibly labeled
     and never presented as live.
   ============================================================================ */

export const content = {

  /* ── Global ─────────────────────────────────────────────────────────── */
  brand: {
    wordmark: ['PIQC', 'linical'],            // first span = gradient, second = ink/light
    categoryLine: 'The intelligence layer between protocol complexity and clinical execution.',
    proofLine: 'AI drafts. Humans decide. Everything is traceable.',
    boundaryLine: 'PIQC prepares. Your people and systems govern.',
  },

  nav: {
    links: [
      { label: 'Why PIQC',      href: '/#why' },
      { label: 'The engine',    href: '/#engine' },
      { label: 'Ask',           href: '/#ask' },
      { label: 'Downstream',    href: '/#downstream' },
      { label: 'Product boundary', href: '/#boundary' },
      { label: 'Founder intent', href: '/#founder' },
      { label: 'Security',      href: '/security' },
    ],
    modes: [
      { label: 'Site Mode',    href: '/site' },
      { label: 'Audit Mode',   href: '/audit' },
      { label: 'Sponsor Mode', href: '/sponsor' },
    ],
    cta: 'Request a demo',
  },

  /* ── Conversion (FABLE-BRIEF §8) — CTA must reach a REAL destination. ──
     Default v1 = mailto fallback. Swap `ctaHref` for a Calendly/HubSpot/Formspree
     link (or wire the form to an approved endpoint) when available.
     Never simulate a successful submission without a functioning integration. */
  demo: {
    ctaHref: 'mailto:hello@piqclinical.com?subject=PIQClinical%20demo%20request',
    mode: 'mailto',               // 'mailto' | 'schedule' | 'form-endpoint'
    endpoint: null,               // set to an approved form endpoint to enable a real form
    privacyNote: 'We use your details only to respond to your request.',
    // The form must NOT request PHI, study data, or sensitive operational information.
  },

  /* ── HOME · Section A — Hero: the missing layer ─────────────────────── */
  hero: {
    eyebrow: 'A better question for clinical trial execution',
    h1: 'From protocol complexity to context-aware understanding.',
    sub: 'Every clinical system manages data, documents, workflow, and oversight — and every one of them assumes the protocol has already been turned into understanding. None of them does that part. PIQC is the layer that does: it turns a dense protocol into structured, source-traceable understanding, and hands each person what they need before execution begins.',
    ctaPrimary: 'Request a demo',
    ctaSecondary: 'See the protocol journey',
    // Visual flow labels (calm, deterministic — see FABLE-BRIEF §6/§7)
    flow: ['Protocol PDF', 'Structured protocol intelligence', 'Context-aware understanding', 'Role-specific output', 'Warm handoff to your systems'],
  },

  /* ── HOME · Section B — The manual interpretation burden ────────────── */
  burden: {
    h2: 'The burden was never reading the protocol. It’s translating it into execution.',
    body: 'A new protocol arrives, and the real work starts: turning hundreds of pages of requirements into worksheets, visit guidance, eligibility logic, monitoring focus, vendor coordination, and training. Today that translation is manual, fragmented, and carried in people’s heads. Miss one conditional rule, one visit window, one prohibited medication, and the error is already inside the workflow before anyone thinks to look for it.',
    before: ['Protocol', 'manual review', 'cross-referencing', 'local notes & spreadsheets', 'repeated questions', 're-created deliverables', 'execution'],
    after:  ['Protocol', 'structured intelligence', 'traceable, role-specific understanding', 'editable deliverables', 'a prepared human', 'your existing system'],
    key: 'Protocols will remain complex. The human burden does not have to.',
  },

  /* ── HOME · Section C — The first failure happens upstream ──────────── */
  firstFailure: {
    h2: 'The first failure doesn’t happen at the first patient visit. It happens upstream.',
    body: 'Before a protocol can be executed, it has to be operationalized — read, cross-referenced, and rewritten into something a site, monitor, or auditor can act on. That translation step is the earliest and least-supported point of risk. PIQC moves the question forward: where will this protocol be hardest to operationalize, and who needs to understand it first?',
    timeline: ['Protocol received', 'interpretation', 'worksheets & workflows', 'site prep & SIV', 'activation', 'first patient visit'],
    highlight: 'interpretation',   // the phase PIQC addresses — emphasize, don't accuse
  },

  /* ── HOME · Section D · ACT 1 — The core engine (the star) ──────────── */
  coreEngine: {
    anchor: 'engine',
    h2: 'From protocol PDF to visual, review-ready visit drafts — in minutes.',
    body: 'This is the engine everything else runs on. PIQC reads the Schedule of Assessments and the procedure text and drafts every study visit as a phased, visual checklist — each requirement classified, confidence-scored, and linked to the exact protocol source. A completeness pass flags what might be missing. Days of manual transcription become a review-ready draft in minutes — and a human still reviews and owns every line.',
    proofPoints: [
      'Every requirement classified — required, conditional, endpoint-critical, safety-critical',
      'A confidence signal on every line',
      'A § source link to the exact section, page, and quote',
      'A completeness pass that flags possibly-missing requirements — you add or dismiss',
    ],
    // mock visit-draft: drives the money-shot animation (`home-flow`) AND the role-filter demo.
    // `roles` = which role chips show the row (empty/absent = shown for all).
    mock: {
      visit: 'Day 1 — Screening',
      roleChips: ['All', 'Coordinator', 'Nurse', 'Investigator', 'Lab', 'Pharmacy'],
      rows: [
        { label: 'Informed Consent',                   tags: ['REQUIRED', 'SAFETY-CRITICAL'], source: '§4.8 ICH E6(R2)', confidence: 'high',   roles: ['Coordinator', 'Investigator'] },
        { label: 'Vital signs (BP, HR, temp)',         tags: ['REQUIRED'],                    source: '§7.2.1 · p.31',   confidence: 'high',   roles: ['Nurse'] },
        { label: '12-Lead ECG (triplicate, pre-dose)', tags: ['PRIMARY ENDPOINT'],            source: '§6.2.1 · p.34',   confidence: 'high',   roles: ['Nurse'] },
        { label: 'PK blood draw (pre-dose)',           tags: ['PRIMARY ENDPOINT'],            source: '§6.3 · p.36',     confidence: 'high',   roles: ['Lab'] },
        { label: 'ECOG Performance Status',            tags: ['ELIGIBILITY'],                 source: '§5.1 · p.22',     confidence: 'medium', roles: ['Investigator'] },
        { label: 'IP accountability check',            tags: ['CONDITIONAL'],                 source: '§8.4 · p.44',     confidence: 'medium', roles: ['Pharmacy'] },
      ],
      footer: 'PIQC draft · 14 requirements surfaced for review',   // no "0 gaps"/completeness claim (FABLE-BRIEF §4.5)
    },
    key: 'Parse once. Draft the whole study. You review.',
  },

  /* ── HOME · Section E · ACT 2 — Ask, answered by the protocol ───────── */
  askSourceOfTruth: {
    anchor: 'ask',
    h2: 'Ask in plain language. Answered by the protocol itself.',
    body: 'Ask works shoulder to shoulder with the source of truth. Ask a plain question and PIQC answers from this protocol — with the exact cited passage shown right beside the answer. It won’t invent clinical guidance; if something isn’t in the protocol, Ask says so. Prompts adapt to the study’s phase and the site’s team.',
    inputPlaceholder: 'Ask anything — live in the product',   // disabled free-text input in the demo
    // clickable preset chips (`ask-source` demo): each swaps answer + slides in its citation.
    // First item is also the default shown state (JS-off fallback).
    examples: [
      { question: 'Which visits require a 12-lead ECG, and in what window?',
        answer: 'A 12-lead ECG is required at Screening and at Day 29 — in triplicate, pre-dose, within ±15 minutes of the scheduled time.',
        citation: { quote: 'A 12-lead ECG will be performed in triplicate, pre-dose…', ref: '§6.2.1 · p.34' } },
      { question: 'What are the key exclusion criteria?',
        answer: 'Prior systemic therapy within 14 days or 5 half-lives (whichever is longer), and any unresolved Grade ≥2 toxicity from prior treatment.',
        citation: { quote: '≥14 days or 5 half-lives (whichever is longer) from prior systemic therapy…', ref: '§5.2 · p.28' } },
      { question: 'Is there a washout period before dosing?',
        answer: 'Yes — a minimum 14-day washout (or 5 half-lives) is required from prior systemic therapy before the first dose.',
        citation: { quote: 'Washout: ≥14 days or 5 half-lives prior to Day 1 dosing.', ref: '§5.2 · p.28' } },
    ],
    key: 'Answers you can trace — because the source is right there.',
  },

  /* ── HOME · Section E — Who it serves (role lenses) ─────────────────── */
  roles: {
    h2: 'Every role asks a different question of the same protocol.',
    items: [
      { role: 'Site teams',
        question: 'What do I need to do next?',
        output: 'Study worksheets, visit-by-visit guidance, protocol-grounded answers, amendment updates.',
        direction: false },
      { role: 'CRAs / monitors',
        question: 'What deserves focused oversight before and during this visit?',
        output: 'Protocol-derived monitoring focus, endpoint and eligibility review areas, visit-window reminders.',
        direction: true },
      { role: 'Sponsors / ClinOps',
        question: 'Where is this protocol operationally complex or time-sensitive?',
        output: 'A Risk Overview of operational complexity today; an operational-fragility view as the platform extends.',
        direction: false,  // Risk Overview is live; fragility view is direction — note inline
        note: 'Risk Overview is live; the operational-fragility view is platform direction.' },
      { role: 'QA / Audit',
        question: 'What protocol requirements should be validated?',
        output: 'Protocol-aware audit scope, evidence-linked review focus, risk-scored findings through the 8-stage workflow.',
        direction: false },
      { role: 'Study team',
        question: 'What must each role understand before execution?',
        output: 'An SIV knowledge-transfer package and role-specific quick references.',
        direction: true },
    ],
  },

  /* ── HOME · Section F — Understanding first, action second ──────────── */
  handoff: {
    h2: 'PIQC prepares the next action. Your systems execute it.',
    body: 'Your teams already trust their systems for data capture, tracking, documents, and records. PIQC doesn’t compete with them. It gives people the protocol context to walk into those systems prepared instead of overloaded — then gets out of the way.',
    example: {
      trigger: 'A monitoring visit needs preparation',
      piqcExplains: ['endpoint-critical procedures', 'time-sensitive visit windows', 'amendment-affected requirements', 'eligibility & prohibited-medication review areas'],
      nextAction: 'Prepare the visit — then open your CTMS, EDC, or travel system, informed.',
    },
    key: 'PIQC informs. PIQC prepares. PIQC guides. Your systems execute.',
  },

  /* ── HOME · Section G — Living protocol knowledge transfer (DIRECTION) ─ */
  knowledgeTransfer: {
    direction: true,
    label: 'Platform direction',
    h2: 'Protocol understanding shouldn’t expire after the SIV.',
    body: 'Protocol uncertainty keeps coming back — at startup, during enrollment, when new staff join, when an amendment lands, before a monitoring visit or an audit, at closeout. PIQC is designed to re-express the same protocol intelligence in the right form, for the right role, at the moment it’s needed.',
    lifecycle: [
      { stage: 'Startup',           example: 'site-ready study worksheets' },
      { stage: 'SIV',               example: 'a sponsor-reviewable knowledge-transfer package' },
      { stage: 'Enrollment',        example: 'eligibility & prohibited-medication focus' },
      { stage: 'Conduct',           example: 'visit-specific guidance' },
      { stage: 'Amendment',         example: 'affected-role & change-impact view' },
      { stage: 'Monitoring / Audit', example: 'protocol-derived review focus' },
      { stage: 'Closeout',          example: 'remaining protocol-derived obligations' },
    ],
    boundary: 'PIQC prepares knowledge-transfer materials. Your organization owns training approval, delivery, records, competency, signatures, and controlled storage. PIQC is not an LMS.',
  },

  /* ── HOME · Section H — What PIQC is / is not ───────────────────────── */
  boundary: {
    h2: 'Built to strengthen clinical judgment, not replace it.',
    does: [
      'Converts protocol content into structured, traceable understanding',
      'Prepares editable, role-specific draft materials',
      'Helps teams locate protocol evidence in context',
      'Supports preparation, review, and human decision-making',
      'Provides context-rich handoffs to your existing systems',
    ],
    doesNot: [
      'Replace clinical judgment',
      'Become the system of record',
      'Execute regulated workflows',
      'Replace your CTMS, EDC, eTMF, LMS, or travel tools',
      'Approve or mandate decisions on your behalf',
    ],
    line: 'PIQC prepares. Your people and systems govern.',
  },

  /* ── HOME · Section I — Founder intent (THE founder-register section) ── */
  founder: {
    h2: 'Built from the belief that clinical teams deserve better support before execution begins.',
    body: [
      'The same thing shows up on study after study. Not careless teams. Not badly written protocols. Skilled people re-deriving a protocol’s meaning by hand — from memory, under time pressure — before anyone has seen a patient. The same interpretation work, redone at every site, in every role, with nothing there to catch what slips.',
      'That isn’t a people problem. It’s a systems problem. Every tool in a trial assumes the protocol has already been understood — none of them does the understanding. So the burden lands on whoever is closest to the work, and the first failure happens long before the first visit.',
      'PIQC exists to carry that burden: to turn protocol complexity into structured, traceable understanding, and to hand it to each person prepared — while judgment, review, and accountability stay firmly with them. I’m certain this layer has to exist. We’re building it.',
    ],
    statement: 'PIQC exists to replace manual interpretation overload with anytime mastery.',
    // Optional single quiet credibility line — use ONLY if it reads as conviction, not a credential.
    // Delete entirely for a pure problem-and-product voice.
    credibilityLine: 'Built by people who have audited these trials from the inside.',
  },

  /* ── HOME · Section F · ACT 3 — Downstream: the same intelligence ────── */
  downstream: {
    anchor: 'downstream',
    h2: 'Parse once. The whole trial benefits.',
    body: 'Because the protocol is already parsed once into traceable logic, that same intelligence flows downstream — no one rebuilds the protocol’s meaning from scratch. For auditors it becomes a gated 8-stage vendor audit with risk-scored, traceable findings. For sponsors it becomes parse-once-generate-many deliverables, every block labeled fact vs framing, every fact traceable to its page.',
    cards: [
      { mode: 'Site Mode',    href: '/site',
        who: 'The core engine, in depth',
        bullets: ['Protocol → visit-by-visit execution drafts', 'Ask, answered by the protocol', 'Role-filtered worksheets from one dataset'] },
      { mode: 'Audit Mode',   href: '/audit',
        who: 'Downstream · for auditors, QA & sponsors',
        bullets: ['A gated 8-stage vendor audit', 'Risk-scored findings → Issue → CAPA', 'AI-drafted report, human-approved'] },
      { mode: 'Sponsor Mode', href: '/sponsor',
        who: 'Downstream · for sponsors (enterprise)',
        bullets: ['Parse once, generate many deliverables', 'Every block labeled: fact vs framing', 'Source-traceable provenance'] },
    ],
    // Numbers must clear FABLE-BRIEF §4.5 (verify against the product baseline) before publishing.
    stats: [
      { value: '8', label: 'gated audit stages' },
      { value: '5', label: 'role-filtered views' },
      { value: '4', label: 'evidence support types' },
      { value: 'Protocol-first', label: 'PIQC’s intelligence is built from the protocol document itself' },
    ],
    key: 'Parse once. Generate many. Humans remain responsible.',
  },

  /* ── HOME · Section L — Security teaser ─────────────────────────────────
     RESTRAINED wording only until the §6.5 claim register is filled + approved.
     Do NOT reinstate "zero PHI", "immutable", "21 CFR Part 11", badges, etc. here. */
  securityTeaser: {
    h2: 'Designed with privacy, controlled access, and auditability in mind.',
    body: 'PIQC’s intelligence is built from the protocol document itself, with controlled access and traceable actions throughout. See how we approach privacy and data handling.',
    cta: 'See our security approach',
    href: '/security',
  },

  /* ── HOME · Section L — Final CTA ───────────────────────────────────── */
  finalCta: {
    h2: 'The protocol should be a source of mastery, not a recurring cognitive burden.',
    body: 'See what PIQC surfaces from your own protocol workflow.',
    ctaPrimary: 'Request a demo',
    ctaSecondary: 'Talk through your protocol workflow',
  },

  /* ── Mode-page hero seeds (deep-dive pages) ─────────────────────────── */
  modes: {
    site: {
      reassurance: 'Works alongside your EDC and CTMS — PIQC prepares the visit; your systems capture the data.',
      h1: 'Every role. Every requirement. Day-of-visit ready.',
      sub: 'PIQC turns the protocol into a visit-by-visit execution workspace — phased checklists, confidence signals, and a source link on every requirement — then exports the worksheet each role needs.',
    },
    audit: {
      reassurance: 'A structured workflow, not a system of record — the auditor approves every gate; PIQC drafts and traces.',
      h1: 'An 8-stage vendor audit that enforces itself.',
      sub: 'From intake to export, nothing advances until the right approvals are in place. Findings are risk-scored and traceable, and PIQC drafts the report for the auditor to review.',
    },
    sponsor: {
      reassurance: 'Read-only intelligence over your protocols — PIQC drafts deliverables; your teams review and release them.',
      h1: 'Parse the protocol once. Generate every deliverable.',
      sub: 'One extraction feeds many role-tailored deliverables — each block labeled protocol fact vs PIQC framing, each fact traceable to the page it came from.',
    },
  },

  /* ── Footer ─────────────────────────────────────────────────────────── */
  footer: {
    tagline: 'The intelligence layer between protocol complexity and clinical execution.',
    columns: [
      { heading: 'Product', links: [
        { label: 'Site Mode', href: '/site' },
        { label: 'Audit Mode', href: '/audit' },
        { label: 'Sponsor Mode', href: '/sponsor' },
        { label: 'Security', href: '/security' },
      ]},
      { heading: 'Company', links: [
        { label: 'Why PIQC', href: '/#why' },
        { label: 'Founder intent', href: '/#founder' },
        { label: 'Request a demo', href: '/#request-demo' },
      ]},
    ],
    // Do NOT ship dead footer links or placeholder legal pages. Missing legal/policy
    // destinations are RELEASE BLOCKERS (FABLE-BRIEF §9). Add real Privacy/Terms when ready.
    legal: '© 2026 PIQClinical. All rights reserved.',
  },
};

if (typeof window !== 'undefined') window.PIQC_CONTENT = content;
