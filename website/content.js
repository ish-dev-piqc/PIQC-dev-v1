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
      { label: 'Why PIQC',      href: '#why' },
      { label: 'How it works',  href: '#how' },
      { label: 'Who it serves', href: '#roles' },
      { label: 'Product boundary', href: '#boundary' },
      { label: 'Founder intent', href: '#founder' },
      { label: 'Security',      href: 'security.html' },
    ],
    modes: [
      { label: 'Site Mode',    href: 'site.html' },
      { label: 'Audit Mode',   href: 'audit.html' },
      { label: 'Sponsor Mode', href: 'sponsor.html' },
    ],
    cta: 'Request a demo',
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

  /* ── HOME · Section D — Parse once, generate many ───────────────────── */
  parseOnce: {
    h2: 'One protocol intelligence backbone. Many moments of understanding.',
    body: 'PIQC reads the protocol once and converts it into structured, source-traceable logic — each fact linked back to the exact page it came from. From that single backbone, it generates the view each role actually needs, so no one rebuilds the protocol’s meaning from scratch.',
    map: ['visits & visit windows', 'procedures', 'eligibility / exclusion', 'prohibited medications', 'endpoints', 'safety & lab requirements', 'cohort logic', 'vendor dependencies', 'amendments', 'source citations'],
    key: 'Parse once. Generate many. Humans remain responsible.',
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
      'Approve, attest, certify, or mandate decisions',
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

  /* ── HOME · Section J — Explore the product (bridge to proof) ────────── */
  explore: {
    h2: 'Three ways to act on the same protocol intelligence.',
    cards: [
      { mode: 'Site Mode',    href: 'site.html',
        who: 'For research sites',
        bullets: ['Protocol → visit-by-visit execution checklists', 'Role-filtered worksheets, one dataset', 'Every requirement traceable to its source'] },
      { mode: 'Audit Mode',   href: 'audit.html',
        who: 'For auditors, QA & sponsors',
        bullets: ['A gated 8-stage vendor audit', 'Risk-scored findings → Issue → CAPA', 'AI-drafted report, human-approved'] },
      { mode: 'Sponsor Mode', href: 'sponsor.html',
        who: 'For sponsors (enterprise)',
        bullets: ['Parse once, generate many deliverables', 'Every block labeled: fact vs framing', 'Byte-level source provenance'] },
    ],
    stats: [
      { value: '8', label: 'gated audit stages' },
      { value: '5', label: 'role-filtered views' },
      { value: '4', label: 'evidence support types' },
      { value: '0', label: 'PHI stored — ever' },
    ],
  },

  /* ── HOME · Section K — Security teaser ─────────────────────────────── */
  securityTeaser: {
    h2: 'Built for regulated environments from the ground up.',
    body: 'Zero-PHI by architecture — PHI can’t be entered, by design, not policy. Row-level security at the database layer. An immutable, 21 CFR Part 11-aligned audit trail on every action.',
    cta: 'See our security posture',
    href: 'security.html',
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
        { label: 'Site Mode', href: 'site.html' },
        { label: 'Audit Mode', href: 'audit.html' },
        { label: 'Sponsor Mode', href: 'sponsor.html' },
        { label: 'Security', href: 'security.html' },
      ]},
      { heading: 'Company', links: [
        { label: 'Why PIQC', href: 'index.html#why' },
        { label: 'Founder intent', href: 'index.html#founder' },
        { label: 'Request a demo', href: 'index.html#contact' },
      ]},
    ],
    legal: '© 2026 PIQClinical. All rights reserved.',
  },
};

if (typeof window !== 'undefined') window.PIQC_CONTENT = content;
