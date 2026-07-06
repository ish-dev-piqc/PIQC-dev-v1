# Fable Build Brief — PIQClinical Website (Vision + Product)

> **How to use this file:** This is a two-stage effort (see below). Paste this entire document to Fable as the build prompt, and attach your `sales-marketing-strategy.md`. Fable produces a static, multi-page site under `website/`. After the build, iterate with Claude Design (see §9).

## Stages — keep these separate

- **Stage A — Brief authoring (this work).** Create/update `website/FABLE-BRIEF.md` and the starter files explicitly requested here: `website/tokens.css`, `website/site.css`, `website/DESIGN.md`, `website/content.js`. **No product application source is modified in Stage A.**
- **Stage B — Fable execution.** Fable reads this brief, performs the bounded read-only codebase review (Step 0), and builds the static marketing site inside `website/`.

**This work is documentation-first. Do NOT build the site until the user explicitly asks Fable to execute Stage B.**

---

## Truth hierarchy — read before anything else

Sources rank in this order. When they conflict, the higher rank wins; when release status is unclear, prefer restrained language.

1. **Legal / privacy / security / compliance statements** require explicit documentary support. **Never infer these from code.**
2. **The written product-facts section (§4)** is the baseline for customer-facing *availability* and *capability* claims.
3. **`sales-marketing-strategy.md`** governs positioning, audience framing, messaging, tone, and prioritization.
4. **The codebase** may validate terminology, workflows, labels, and implementation detail. **Code alone does not establish that a feature is generally available, approved for marketing, compliant, or production-ready.**
5. **`landing.html`** is the canonical visual reference (brand, layout, type, color, cards, badges, mockup language).
6. **When sources conflict or release status is unclear**, use restrained **"Platform direction"** language or flag the item for review — do not make a "Live today" claim.

**Definitions (use exactly these):**
```
Live today:         Available to the intended customer audience now.
Platform direction: Planned, expanding, gated, pilot, internal, or otherwise
                    not confirmed as broadly available.
```
Do **not** infer broad Sponsor Mode availability merely because `canUseSponsorMode` exists in an entitlement gate.

---

## Step 0 — Bounded, read-only codebase review (before writing markup)

Before writing any markup, perform a **bounded, read-only review** of the PIQClinical codebase to **validate product terminology and workflow concepts**. Skim labels, enums, types, API surfaces, and user-facing component names for product-story accuracy. This is calibration, not an implementation audit.

**Review only these areas:**
- **Site Mode:** `src/lib/site/`, `src/lib/visit-execution/`, `src/components/dashboard/visit-execution/`, `src/types/visit-execution/`
- **Audit Mode:** `src/lib/audit/`, `src/components/dashboard/audit/`, `src/types/audit/`
- **Sponsor / SOTR / Deliverables:** `src/lib/sotr/`, `src/lib/deliverables/`, `src/lib/sponsor/`, `src/components/sotr/`, `src/components/deliverables/`, `src/types/sotr/`, `src/types/deliverables/`, `src/types/sponsor/`
- **Cross-cutting context:** `CLAUDE.md`, `src/lib/entitlements.ts`

**Rules:**
- Use code to **confirm vocabulary, workflow sequence, and product concepts.**
- **Do not infer** broad availability, regulatory posture, security posture, customer outcomes, or feature maturity solely from implementation code.
- When code indicates a feature may be **gated, new, incomplete, internal, or different** from the written baseline, **do not silently convert it into a customer-facing claim** — use "Platform direction" language or flag the discrepancy for approval.
- The review is **read-only, efficient, and limited to the listed areas.**
- If **repository access is unavailable**, use §4 as the baseline.

---

## 0. TL;DR for Fable

Build a **best-in-class website for PIQClinical** that does two jobs at once:
1. **A founder-vision, category-defining narrative** — argues that PIQC is *a new layer clinical trials have been missing*, in calm, clinically-credible, investor-grade prose.
2. **A buyer-facing product site** — shows the three surfaces (**Site Mode, Audit Mode, Sponsor Mode**) in enough concrete detail to book a demo.

**The one sentence a visitor must leave with:**
> **PIQC is the missing intelligence layer between protocol complexity and clinical execution.**

**Architecture of the site (clean routes — see §10):**
- **Home (`/` → `index.html`)** = vision framing + the **three-act product story** (§1 spine): **Act 1 the core engine** (protocol → visual, review-ready visit drafts → speed) is the star; **Act 2 Ask, answered by the protocol** (intelligence beside the cited source) is the co-star; **Act 3 downstream** shows the same intelligence powering Audit & Sponsor. Lead with the engine.
- **`/site` `/audit` `/sponsor`** = the mode deep-dives; **`/security`** = the regulated-environment trust page.

**Stack:** zero-build static — one page per route (directory-index structure, §10), a canonical **`tokens.css`** (design values) + **`site.css`** (components/layout) + **`animations.js`** (behavior), vanilla JS. No bundler. Deploys to **Cloudflare Pages** with no build step. **Tailwind via CDN is optional** — if used, pin the version and map its config to the same tokens; it must not become a second, conflicting token system.

**Primary CTA everywhere:** **"Request a Demo."** Softer secondaries: "See the protocol journey," "Talk through your protocol workflow."

**Interactivity — build a LIVE, ready-to-go site (not static screenshots):** real working navigation across all routes; functional buttons/links; hover/focus/active states; scroll-reveal; working mobile menu; scroll-triggered hero animations; and the two hands-on demos (§7). The **product mockups are DOM/CSS (real elements)**. The **Request-a-Demo CTA must reach a real destination (§8) — never simulate a successful submission.**

**Truth constraint:** present **only** §4 **Live today** items as current; everything else is **Platform direction** and visibly labeled. Never invent metrics, certifications, customers, or partner logos. Obey the **Truth hierarchy** above.

**Inputs Fable consumes (build in ONE efficient pass — don't re-derive):**
- **The PIQC codebase** — bounded read-only review (Step 0) to calibrate terminology only; per the Truth hierarchy, code validates vocabulary/workflow but does **not** establish availability or compliance.
- `tokens.css` — canonical design values. `site.css` — reusable component/layout styles. Import as-is; never hardcode values.
- `content.js` — all copy + mock data, already written in-voice. Pull strings from here; don't rewrite copy.
- `../landing.html` — canonical visual reference to mine styles/logo/mockup patterns from.
- This brief: §3.5 = build spec, §4 = product facts, §4.5 = claim verification, §5 = home sections, §7 = animations.
- `WEB-DESIGN-SYSTEM.md` = optional deep rationale — not required to build; §3.5 is sufficient.

**Efficient build order:** (1) `tokens.css` + `site.css` → (2) shared partials **once** (identical nav, footer, MockupFrame, CitationChip, demo form) → (3) compose each route from those + `content.js`. Reuse components; never regenerate one.

---

## 1. Positioning, voice & guardrails

### North star
> **PIQC transforms protocol complexity into context-aware understanding, then hands the user to the right tool at the right moment.**

### The core argument (the spine of the whole site)
- Manual protocol interpretation is a **cognitive tax** on clinical trial execution — teams translate dense protocols into worksheets, monitoring priorities, audit scope, training, and site guidance by hand, from working memory.
- **This is a systems problem, not a people problem.** Never imply sites, CRAs, auditors, or sponsors are careless or noncompliant.
- **The first failure happens upstream** — not at the first patient visit, but when a protocol requirement is manually translated into a workflow. PIQC reduces that interpretation burden *before* execution.
- **Understanding first. Action second.** PIQC prepares the human, then **hands off to the systems the organization already trusts** (EDC, CTMS, eTMF, training, travel). It does not replace them.
- **Parse once, generate many.** One source-traceable protocol intelligence backbone → many role-specific expressions. Humans remain responsible.

### Product demonstration spine — lead with the engine (do NOT bury it)
The *vision* is the WHY; this is the WHAT, in **three acts, in this order**. The core engine is the star — most space, strongest visual, earliest product moment. Audit and Sponsor are **downstream**, not co-equal.

1. **Act 1 — The core engine (the star).** Protocol PDF → **visual, review-ready study-visit drafts, in minutes.** Site Mode's heart. The money shot: a dense protocol becomes a phased, source-cited visit checklist. Speed is the payoff.
2. **Act 2 — Ask, answered by the protocol (the co-star).** The **Ask** copilot works **side by side with the source of truth**: a plain question returns a protocol-grounded answer with the **cited passage shown right next to it** (section + page).
3. **Act 3 — Downstream: the same intelligence, extended (the payoff).** Because the protocol is parsed once into traceable logic, it flows downstream into **Audit Mode** and **Sponsor Mode**. Present these as *what the engine unlocks*, not separate products.

### Voice
Confident, clear, calm, spacious, editorial. Lead with the *systemic pain*, then the *proof*. No hype, no fear tactics, no exclamation marks, no "revolutionary/magic/instant."

**Founder register (whole site, and Founder Intent especially):** read like an **experienced founder who has lived this problem and is certain of the build** — earned conviction, not a résumé. Authority is shown by **naming the problem more precisely than anyone else**, not by tenure, titles, employers, or "X years of experience." **Never a LinkedIn/CV tone.**

**Use these themes:** manual interpretation load · cognitive burden · structured protocol intelligence · **anytime mastery** · context-aware understanding · source-traceable materials · role-specific views · human review and responsibility · **understand first, act second** · **warm handoff** · *"protocols will remain complex; the human burden does not have to"* · *"PIQC prepares; people and systems govern."*

**Avoid:** "generic AI copilot" language · "magic / instant compliance" · claims PIQC **prevents deviations, improves safety, or guarantees inspection readiness** · "protocol clarity" phrasing (implies protocols are badly written) · talking down to clinical staff · implementation detail in customer copy · huge text blocks · invented logos/testimonials/metrics/integrations/certifications · **résumé / LinkedIn / credential-bragging tone**. Prefer *reduce, support, prepare, surface, help teams understand, enable review* over outcome promises.

### Hard guardrails
1. **Truth hierarchy governs everything** (see top). Only present §4 **Live today** items as current; **Platform direction** carries a visible label.
2. **Draft-aid positioning.** PIQC *drafts, flags, surfaces, prepares*; humans review and approve. Never "approves / certifies / signs / attests / mandates," never "system of record." Mockups must never imply AI independently approves, certifies, signs, or replaces human review. Recurring rule: **"PIQC advises and drafts; humans review, decide, and approve."**
3. **Boundary honesty.** PIQC is **not** an EDC, eSource, CTMS, eTMF, LMS, travel system, compliance tracker, generic AI assistant, or replacement for clinical judgment.
4. **Messaging precedence.** `sales-marketing-strategy.md` wins on positioning/tone; §4 + Truth hierarchy win on product facts.
5. **No sponsor branding / third-party logos.** Mockups generic ("Acme BioPharma"); external systems neutral labels ("EDC," "CTMS," "Travel System").
6. **No PHI / study data anywhere** — mockups use fake IDs like `P-0023`; forms never request PHI, study data, or sensitive operational information.

---

## 2. Audience

**Primary (buyers):** site-network leadership, site managers, lead coordinators, clinical-operations leaders, sponsor study teams, CRAs/monitors, QA/audit leaders.
**Secondary:** clinical-research investors, strategic advisors, future partners.

| Audience | Question the site must answer |
|---|---|
| Site teams | How does PIQC cut the burden of turning a protocol into usable study workflows? |
| CRAs / monitors | How can PIQC focus oversight *before* a visit without replacing my CTMS/plan/travel tools? |
| Sponsors / ClinOps | How does PIQC surface protocol-derived operational complexity before it becomes execution burden? |
| QA / Audit | How does PIQC give protocol-aware prep and evidence-backed review focus? |
| Investors | Why is PIQC a reusable protocol-intelligence *platform*, not a one-off AI feature? |

---

## 3. Brand system — reuse from `landing.html` verbatim

`landing.html` is the canonical visual reference — mine its styles. Exact values + logo SVG are in **Appendix A** and in `website/tokens.css`.

- **Palette (medical scrub):** `scrub-blue #1e7fd4 / bluelight #4a9fe0 / bluedark #1568b8`, `scrub-teal #14b8a6 / teallight #2dd4bf / tealdark #0e9488 / sage #a7c9bf`, `ink #0f2942`; dark-mockup navy scale `#070d1a…#1e3060`.
- **Gradient:** `linear-gradient(135deg,#1e7fd4→#14b8a6)` → `.grad-brand`, `.grad-text`, `.grad-soft`, faint `.grid-pattern`.
- **Type:** Inter 300–800. **Logo:** inline `#piqc-mark` SVG. Wordmark `PIQC`(grad)+`linical`(ink, light).
- **Surfaces:** light `.card`; dark `.screenshot`; `.btn-primary`/`.btn-ghost`; `.badge-*`, `.stage-pill`.

**Canonical-values rule (load-bearing):** `tokens.css` is the single source of visual values — **no arbitrary hardcoded brand colors, spacing, radii, shadows, z-index, or animation timings in page markup.** Component/layout styles live in `site.css`. If Tailwind CDN is retained, pin the version and map its config to these same tokens; it must not introduce a second value system.

### 3.5 Design system — build to this (rationale in `WEB-DESIGN-SYSTEM.md`)

**Thesis — "clinical instrument, not SaaS brochure." Three moves carry the look:**
1. **Dual-surface rhythm** — light editorial bands alternate with dark-navy `.screenshot` bands. Alternate `surface → surface-2 → surface`; **never two dark sections adjacent.**
2. **Traceability as a primitive** — the `§ section · page` **CitationChip** and a **ProvenanceLine** ("PIQC draft · requirements surfaced for review") recur on every draft/requirement. The ownable motif.
3. **Document → structure motif** — a protocol page resolving into clean, classified rows.

**Build model:** values (`tokens.css`) → components/layout (`site.css`, built **once**) → section patterns → routes. Reuse; never regenerate a component. Copy from `content.js`.

**Layout:** container `max-w-7xl`; **prose max ~65ch — never wider**; section rhythm `64px`→`96px` (hero larger); splits 2-col at `lg`; card/stat grids 3-col at `md`; left-align prose, center only heroes/intros.

**Spacing:** 8-pt scale `4/8/12/16/24/32/48/64/96`. No one-off values.

**Type (Inter):** H1 large/800/tight/`leading-[1.08]` · H2 700 · H3 700 · lead · body `leading-relaxed` · eyebrow small/600/`uppercase tracking-widest`. **One display per page.** Gradient text only on large accent words (fails AA at body size) — readable text stays solid `--fg-heading`/`--fg-body`.

**Color:** consume semantic tokens (`--fg-heading/-body/-sub/-muted`, `--surface/-2/-dark`, `--border-hairline`, `--accent`). Confidence dots green/amber/slate; risk red/orange/amber/slate.

**Elevation / radius:** 3 shadows only; radii `6` chips · `10–12` buttons/inputs · `16` cards · `20–24` mockup frames.

**Components (build once):** Button · Card · **MockupFrame** (`.screenshot` + fake browser chrome) · **CitationChip ★** · **ProvenanceLine ★** · ConfidenceDot · Badge · StagePill · Nav (mobile disclosure) · Footer · Field · **DirectionTag** (on every non-live claim).
**Section patterns:** Hero · SplitFeature · MockupShowcase (Act-1) · SplitAsk (Act-2) · Stepper (audit) · RoleLensGrid · BoundaryTable · Lifecycle · StatBand · CTABand · DemoForm.

**Motion:** values in `tokens.css`; behavior in `animations.js`; animate **only `transform`/`opacity`**; one-time `fade-up` on scroll-in; **build the final state first, then animate to it**; reduced-motion → final state. Full rules in §7.

**Responsive (mobile-first `sm640/md768/lg1024/xl1280`):** splits stack; **SplitAsk stacks question over source**; grids → 1–2 col; wide mockups get `overflow-x:auto` **inside the frame**; touch ≥44px.

---

## 4. Product facts — ground truth (Live today vs Platform direction)

Write from this; don't exceed it (Truth hierarchy applies). Bold terms are the product's real vocabulary. Availability of any item is set by this section, **not** by the presence of code.

### The shared foundation — Protocol Intelligence (SOTR) · **Live today**
Upload a protocol PDF → **structured, confidence-scored, source-cited, review-ready** data.
- Extracts **endpoints, eligibility (inclusion/exclusion), visit schedules (Schedule of Assessments), dosing, prohibited medications, cohorts, amendments**.
- Every item carries a **confidence state** (high/medium/low/needs-review) + reason.
- Every item links to **source evidence**: quoted text, page number, source location, typed **primary/secondary/context/conflict**.
- **SOTR (Source-of-Truth Reviewer):** human **Accept for draft / Edit / Reject / Flag**, each logged with reviewer + timestamp + version. **AI extracts; humans own interpretation.**
- **Amendment-aware:** version changes flag affected extractions for an adopt-or-dismiss decision.

### Site Mode — research sites (coordinators, nurses, investigators) · **Live today**
- **Calendar / Visits / Participants** with realtime materialization of a participant's visit schedule on enrollment.
- **Visit Execution Workspace (VEW):** per-visit snapshot + a checklist grouped into **7 phases**; each requirement has a **classification** (required / conditional / if-applicable / primary-endpoint / secondary-endpoint / safety-critical), a **confidence signal**, and a **§ traceability** link to the exact protocol source.
- **Completeness signals:** a second pass flags **"possibly-missing requirements"**; coordinator **adds** or **dismisses** — never auto-added.
- **Role-filtered worksheets:** filter to **Coordinator / Nurse / Investigator / Lab / Pharmacy**; export a **draft PDF worksheet**.
- **Ask:** **protocol-grounded copilot**, phase/role-aware prompts, every answer cites section + page.

### Audit Mode — auditors, QA, sponsors · **Live today (vendor audit)**
Gated **8-stage vendor audit**: **Intake → Vendor Enrichment → Questionnaire → Scope & Risk → Pre-Audit Drafting → Conduct → Report → Export** (advancement gated by approvals).
- **Risk-scored findings** across **DATA_INTEGRITY / PATIENT_SAFETY** impact surfaces; each traces protocol requirement → vendor responsibility → evidence.
- **Issue → CAPA** lifecycle, auto-prefilled from finding context.
- **AI-assisted report drafting** (exec summary + conclusions) with **earned write-back** — two explicit human confirmations before any AI text enters the report.
- **Amendment alerts, traceability/lineage, per-object history, evidence attachments.**
- **Platform direction:** the same workspace **extending to investigator / site audits** — label as expanding, not shipped.

### Sponsor Mode — pharma sponsors (enterprise tier) · **Live today (Deliverable Engine)**
> Enterprise-gated. Do **not** imply broad availability from `canUseSponsorMode`. Frame as enterprise-tier.

**Parse once, generate many** via the **Protocol Deliverable Engine**.
- **Deliverables (live):** **Monitoring Preparation Checklist** and **Risk Overview** (plain-language operational-complexity sections; no opaque scores). Set is extensible.
- **Content-origin honesty badges:** every block typed **Protocol Fact** / **PIQC Framing** / **Human Note**. Prevents "borrowed authority."
- **Source provenance:** click a fact → source drawer (quote, page, section, confidence); **"View cited page."**
- **Regeneration preserves human work;** rejected items can't resurrect; full edit log. **Coverage-gap honesty.**
- **DRAFT-watermarked PDF exports** with a "requires human review" disclaimer + traceability appendix; sponsor-name-free.
- **Portfolio intelligence:** read-only enrollment / visits / deviations across the sponsor's sites.
- **Platform direction:** sponsor "**operational fragility view**," CRA-facing monitoring outputs as a distinct role surface.

### Living Protocol Knowledge Transfer · **Platform direction (label clearly)**
One backbone re-expressed across the study lifecycle (startup → SIV → enrollment → conduct → amendment → monitoring/audit → closeout) — e.g., **SIV knowledge-transfer packages**, amendment-impact views. Present as *where the platform is going.* **Never imply LMS / training-record capability** — organizations own training approval, delivery, records, competency, signatures, storage.

---

## 4.5 Product-claim verification (verify or soften before publishing)

**Copy rule:** product metrics, workflow labels, and capability statements must be traceable to the approved product baseline (§4) or confirmed release materials. **Do not use a number merely because it looks persuasive.**

**Verify against the baseline (or soften) each of:** "8 stages" · "5 role views" · "4 evidence types" · "0 PHI" · "realtime sync" · "byte-level provenance" · "earned write-back" · "confidence-scored" · "gated advancement" · "regeneration that preserves human work" · "EU data residency" · "MFA" · "encryption" · "Protocol Deliverable Engine" · "Monitoring Prep Checklist" · "Risk Overview." Anything not confirmed → soften or move to Platform direction.

**No completeness / zero-defect claims.** Replace **"PIQC drafted · 0 gaps detected"** with a non-guaranteed statement such as **"PIQC draft ready for review"** or **"Requirements surfaced for review."** Never imply guaranteed protocol coverage or zero errors.

Security-adjacent terms ("0 PHI," "EU data residency," "MFA," "encryption") are governed by the **Security & compliance claim register (§6.5)** and must not appear until approved there.

---

## 5. Home page (`/` → `index.html`) — vision framing + the three-act product story

Editorial single-scroll with anchored nav — **not** a repetitive SaaS feature scroll. Vision beats (B, C) frame the problem fast; the product story runs as the three acts (D/E/F) with the most space and strongest visuals.

**Running order:** A Hero · B Burden · C First failure upstream · **D Core engine** · **E Ask, answered by the protocol** · **F Downstream (Audit & Sponsor + stats)** · G Who it serves · H Understanding first · I Living knowledge transfer *(Direction)* · J What PIQC is/is not · K Founder intent · L Security teaser · M Final CTA + demo.

**Anchored nav:** Why PIQC · The Engine · Ask · Downstream · Product Boundary · Founder Intent · Security · **Request a Demo**.

**Section A — Hero: the missing layer, shown as the engine.** Eyebrow "A better question for clinical trial execution." H1 **"From protocol complexity to context-aware understanding."** Sub: clinical systems manage data, documents, workflow, and oversight — *but they assume someone has already translated the protocol into usable understanding.* PIQC is that layer. CTAs: **Request a Demo** (§8) · **See the protocol journey** (→ D). **Hero visual = the core-engine money shot** (§7 `home-flow`).

**Section B — The manual interpretation burden.** "The burden isn't reading the protocol. It's translating it into execution." Before/after contrast. Key line: **"Protocols will remain complex. The human burden does not have to."** No outcome claims.

**Section C — The first failure happens upstream.** "Before a protocol can be executed, it must be operationalized." Timeline highlighting the interpretation phase. Language: *"where complexity deserves attention,"* never *"what humans get wrong."*

**Section D — Act 1: The core engine (the star).** Headline: **"From protocol PDF to visual, review-ready visit drafts — in minutes."** PIQC drafts every study visit as a phased, visual checklist — each requirement **classified**, **confidence-scored**, **linked to the exact protocol source**. A completeness pass flags what might be missing; the coordinator adds or dismisses. **Give this the largest, most detailed product mockup on the site.** Close: **"Parse once. Draft the whole study. You review."** *(Live today — Site Mode / VEW.)*

**Section E — Act 2: Ask, answered by the protocol (the co-star).** Headline: **"Ask in plain language. Answered by the protocol itself."** Answers show the **cited passage side by side** (section + page); if something isn't in the protocol, Ask says so. Split view (§7 `ask-source`). Line: **"Answers you can trace — because the source is right there."** *(Live today.)*

**Section F — Act 3: Downstream — the same intelligence, extended.** Headline: **"Parse once. The whole trial benefits."** Flows into a gated **8-stage vendor audit** and **parse-once-generate-many sponsor deliverables** (every block labeled *fact vs framing*). Three cards → deep-dives: **Site Mode** ("the core engine, in depth") · **Audit Mode** · **Sponsor Mode**. Stats band (numbers **must clear §4.5**): gated audit stages · role-filtered views · evidence support types · protocol-only architecture (**PIQC works from protocol documents, not patient data** — final wording via §6.5). Close: **"Parse once. Generate many. Humans remain responsible."**

**Section G — Who it serves.** Role cards (keyboard-accessible). Each: the role's *question* + an *illustrative output*, with **every Platform-direction item labelled** (CRA monitoring outputs, sponsor fragility view, SIV package = Direction; Site worksheets, 8-stage audit, Risk Overview = Live).

**Section H — Understanding first. Action second.** "PIQC prepares the next action. Your existing systems execute it." Key line: **"PIQC informs. PIQC prepares. PIQC guides. Your systems execute."** (Do not build travel/CTMS flows or imply PIQC directs monitoring cadence.)

**Section I — Living protocol knowledge transfer · Platform direction.** Lifecycle strip with a concise example per stage. Boundary copy about training ownership. Visibly framed as Platform direction; **no LMS implication.**

**Section J — What PIQC is / is not.** Calm two-column boundary table (does / does not). Framing line: **"PIQC prepares. Your people and systems govern."**

**Section K — Founder intent.** Founder register (§1) — conviction, not a bio. Headline: "Built from the belief that clinical teams deserve better support before execution begins." State the problem with earned precision; **systems failure, not people failure**; land on conviction that this layer must exist. Statement: **"PIQC exists to replace manual interpretation overload with anytime mastery."** **Do NOT** count years, list titles/employers, use LinkedIn/CV phrasing, or call PIQC a side project. Optional single quiet credibility line only if it reads as conviction.

**Section L — Security teaser** → link to `/security` (restrained language only, §6.5). **Section M — Final CTA + demo form** ("The protocol should be a source of mastery, not a recurring cognitive burden.") → **Footer.**
*(The "explore the modes" cards + stats band live in Section F, not a separate section.)*

---

## 6. Mode & security pages — one clear job each

Each mode page opens with a one-line **boundary reassurance** ("Works alongside your EDC/CTMS — PIQC prepares, your systems execute") and separates **Live today** from **Platform direction**. Reuse the identical nav/footer and demo form.

- **`/site` — Site Mode (the core engine, in depth).** *Job: show how site coordinators, nurses, investigators, labs, and pharmacy teams reduce manual protocol interpretation and repetitive workflow setup.* Hero (`site-checklist`) → the core engine (VEW: 7 phases, classification, confidence, **§ traceability**) → completeness signals → **Ask, answered by the protocol** (elevated split view) → role-filtered worksheets → realtime sync → CTA. Act 1 + Act 2 proven in full.
- **`/audit` — Audit Mode.** *Job: show how audit and QA teams organize audit preparation, risk review, findings, CAPA workflow, reporting, and traceability.* Hero (`audit-pipeline`) → the 8-stage gated pipeline → risk-scored findings → Issue→CAPA → AI report drafting with earned write-back → amendment alerts/traceability → **investigator-site-audit workflow, labelled Platform direction** → CTA.
- **`/sponsor` — Sponsor Mode.** *Job: show enterprise sponsors how one protocol supports multiple structured deliverables, reviewed content, provenance, and portfolio-level visibility.* Hero (`sponsor-fanout`) → parse-once-generate-many → Deliverable Engine (Monitoring Checklist + Risk Overview) → content-origin honesty badges → source provenance → regeneration preserves human work → portfolio intelligence → "operational fragility view" (Direction) → enterprise-tier note → CTA.
- **`/security` — Security.** *Job: an accurate, restrained explanation of privacy, access-control, auditability, and data-handling posture.* **Publish nothing here until the claim register (§6.5) is filled.** No unsupported badges or guarantees.

**Home job:** establish PIQClinical's central promise, introduce the three modes, explain the SOTR / Protocol Intelligence foundation, build trust, convert to demo requests.

### 6.5 Security & compliance claim register (fill before publishing `/security`)

Before publishing the Security page, complete this register. **No security/compliance claim ships without a filled row.**

| Claim | Exact approved wording | Evidence source | Owner | Publication status |
|---|---|---|---|---|

**Rules:**
- Do **not** use HIPAA, GDPR, SOC 2, 21 CFR Part 11, encryption, MFA, data residency, auditability, certification, or compliance badges **without documented approval.**
- Do **not** imply formal certification, legal compliance, validation status, or regulatory approval unless explicitly supported.
- Do **not** treat HIPAA, GDPR, SOC 2, and 21 CFR Part 11 as interchangeable badges.
- Do **not** use "zero PHI" unless it has a documented definition and is approved for public marketing.
- **Codebase implementation details are not proof of a public security or compliance claim.**

**Until claims are approved, use restrained language:**
> "Designed with privacy, controlled access, and auditability in mind."

**Avoid categorical claims:** "fully compliant," "certified," "immutable," "zero PHI," "secure by design," "audit-ready by default."

---

## 7. Animation & visual direction — calm, not flashy

Mockups feel **clinically credible and editorial**, not like a generic AI startup. **Avoid** glowing orbs, robot imagery, vague futuristic gradients, glass-card pileups, noisy backgrounds.

**Guardrails (all animations):**
- Communicate **one workflow story**; remain understandable in a **static final state**.
- Respect `prefers-reduced-motion: reduce` (fallback = final state).
- **Start only when the mockup is visible;** avoid aggressive or continuous motion; provide a **settled end state** and an **optional pause control** where motion is persistent.
- **Generic fictional content only** — no real sponsor branding, patient information, proprietary protocols, or recognizable study data.
- **Mockups must not imply AI independently approves, certifies, signs, or replaces human review.** Recurring rule: *"PIQC advises and drafts; humans review, decide, and approve."*
- Use `data-anim` hooks so Claude Design can retune timing centrally. No autoplay video.

**Named animations:**
- **Home hero (`home-flow`) — THE core-engine money shot:** a protocol PDF page resolves into a **visual, phased visit draft** — rows populate under phase headers, each gaining a **classification tag**, **confidence signal**, and **§ source chip**; footer types **"PIQC draft · 14 requirements surfaced for review."** Convey *speed* (days → minutes). One pass, then a settled state.
- **Ask (`ask-source`) — the co-star:** split view; the **cited protocol passage** slides in *as* the answer resolves — they arrive together, stamped "§6.2.1 · p.34."
- **Site (`site-checklist`):** rows populate a phased checklist; confidence signals settle; footer reads **"PIQC draft · 14 requirements surfaced for review"**; role chips animate a filter.
- **Audit (`audit-pipeline`):** the 8 stage pills light left→right; a gate unlocks with a soft pulse; a finding card slides in; the risk tally counts up.
- **Sponsor (`sponsor-fanout`):** one protocol node fans into two deliverable cards; blocks fill, each stamped Protocol Fact / PIQC Framing; a source-trace drawer slides in.
- **Security (`security-shield`, subtle):** a restrained shield motif. **No compliance-badge or "0 PHI" claims** unless approved via §6.5.

Prefer bespoke, deterministic illustrative product UI over stock imagery. All mock content clearly illustrative, PHI-free.

### Interactive demos (hands-on — the two signature moments) `§ interactive demo`
Make the **two star moments genuinely clickable** — lightweight vanilla JS (`animations.js`), state in `data-*`, data from `content.js`. Both **degrade gracefully**: JS off / reduced-motion → fully-populated default state.

1. **Role-filter on the core-engine visit draft** (Home Act 1 + `/site`). Role chips (`content.js coreEngine.mock.roleChips`) are **real buttons**; clicking filters visible rows to that role, updates the count, swaps the export label. Default `All`; keyboard-accessible.
2. **Clickable Ask** (Home Act 2 + `/site`). 2–3 **preset question chips** (`content.js askSourceOfTruth.examples`); each swaps the answer and **slides in the matching cited-source card**. Include a **disabled** free-text input labelled "Ask anything — live in the product." Keyboard-accessible.

Keep both calm and instant — the visitor *feels* the traceability.

---

## 8. Conversion — the "Request a Demo" path (must be real)

The primary CTA **must lead to a real, configured destination** — one approved path:
- an existing **scheduling link** (e.g., Calendly), or
- an existing **lead-capture provider**, or
- an **approved form endpoint**, or
- an **approved contact email** as a temporary fallback.

**Default for v1 (until the user supplies a scheduling/form endpoint):** the CTA opens `mailto:hello@piqclinical.com?subject=PIQClinical%20demo%20request`. **Do not simulate a successful submission** without a functioning integration.

**If a form is used:** include loading, success, error, validation, spam-protection, privacy-notice, and consent behavior appropriate to the configured service. **The form must not request PHI, study data, or sensitive operational information.** If no endpoint is available, build the form UI with a **clearly-commented integration point** (`// wire to <provider> endpoint here`) and **do not claim submissions are live** (e.g., button links to the mailto fallback).

---

## 9. Claude Design compatibility & shared conventions

1. **Single value source** — all design values in `tokens.css`; component/layout in `site.css`. No inline hex/magic numbers. Tailwind (if used) pinned and mapped to the same tokens.
2. **Semantic, composable sections** — each `<section id data-section>` with a naming comment; consistent component classes.
3. **Centralize copy** — long-form copy + role/lifecycle data in `content.js`.
4. **Identical nav & footer across every route.** Store the canonical markup in a documented partial source or a clear maintenance convention in `DESIGN.md`. **Before handoff, verify nav links, CTA labels, footer links, logo treatment, and legal links are consistent across every route.** No dead footer links, placeholder legal pages, or fake social links in production — **missing legal/policy destinations are release blockers.**
5. **One-command preview** — `cd website && python3 -m http.server 8000`; links work when served static.
6. **`website/DESIGN.md`** — value list, component classes, spacing scale, `data-anim` hooks, per-route section anatomy, nav/footer convention.

**Accessibility (AA — required):** semantic headings in logical hierarchy · landmarks (`header`/`nav`/`main`/`footer`) · visible keyboard focus · keyboard-operable navigation and forms · accessible labels and error messages · descriptive alt text for meaningful imagery · decorative visuals marked appropriately · adequate color contrast · **no information conveyed by color alone** · reduced-motion support · mobile-appropriate touch targets · **no auto-playing motion that prevents comprehension.** Run a **final accessibility review across mobile, tablet, and desktop.**

**No new dependencies:** do not introduce a framework migration, CMS, database, analytics platform, authentication system, external service, or paid dependency unless explicitly approved. Preserve the static architecture; keep the marketing site isolated from the app SPA.

---

## 10. Routes, deployment & SEO (Cloudflare Pages)

**File structure → clean routes:**
```
website/
  index.html            → /
  site/index.html       → /site
  audit/index.html      → /audit
  sponsor/index.html    → /sponsor
  security/index.html   → /security
  404.html
  tokens.css  site.css  animations.js
  content.js  DESIGN.md  FABLE-BRIEF.md
  sitemap.xml  robots.txt
  favicon.svg  (branded, from #piqc-mark)  og-card.png (branded fallback)
```

- **Static output only** — deploy by pointing Cloudflare Pages at `website/`; no build command.
- **Per-route** unique `<title>`, meta description, canonical, Open Graph + Twitter card, social preview asset.
- **Canonical URLs** use the approved production domain only once confirmed:
  `https://piqclinical.com/` · `/site` · `/audit` · `/sponsor` · `/security`.
- **JSON-LD:** reuse `landing.html`'s `Organization` / `WebSite` / `SoftwareApplication` schema **only after verifying each field is still accurate**; do not publish stale or misleading `featureList` entries.
- **Real branded favicon** (generate `favicon.svg` from `#piqc-mark`) and a **branded OG fallback** — no obvious TODO placeholders in production.
- Include `sitemap.xml`, `robots.txt`, `404.html`.
- **Staging deployments must be `noindex`.** Production is indexable only after approval.

---

## 11. Quality gates & final handoff report

Complete before handoff.

**Functional:** all five routes load · all nav links work · the primary CTA reaches the approved demo path (§8) · no console errors · no broken images / dead links / placeholder text · **no app source files modified** · works under a simple static server.
**Responsive:** reviewed at mobile, tablet, desktop widths.
**Motion:** animations have readable static fallbacks · `prefers-reduced-motion` respected · no animation implies autonomous approval or compliance.
**Content:** product claims match §4 and pass §4.5 · security claims appear only if supported by the §6.5 register · Platform-direction items clearly distinguished from Live today · no sponsor/patient/real-study branding in mockups.

**Final handoff report (Fable returns):**
1. Files added/changed. 2. Routes created. 3. Shared styles/reusable patterns created. 4. Commands run + results. 5. Product/security/compliance claims requiring approval. 6. Any discrepancy found between code and written product facts. 7. Exact Cloudflare Pages deployment configuration. 8. Staging and production release steps. 9. Recommended next Claude Design iterations.

---

## 12. Preserve these strengths (do not remove)

Buyer-first positioning (sponsors, CROs, sites) · primary CTA "Request a Demo" · Home + `/site` `/audit` `/sponsor` `/security` · the `landing.html` design system · scrub-blue→teal palette, Inter, PIQC logo language, airy marketing chrome, dark-navy product mockups · stylized in-code mockups (no real screenshots for v1) · the Site / Audit / Sponsor model · **SOTR as shared foundation, not a fourth mode** · strict avoidance of sponsor branding in mockups · Claude Design compatibility (stable section hooks, documented tokens, simple local preview) · the **three-act product spine** and the **two interactive demos.**

---

## Appendix A — paste-ready brand tokens & logo

> Extracted from `landing.html`. Also in `website/tokens.css` (values) + `website/site.css` (components). Use these exact values.

**Tailwind config (OPTIONAL — only if Tailwind CDN is used; pin the version, and mirror these tokens so there is no second value system):**

```js
tailwind.config = {
  theme: { extend: {
    colors: {
      scrub: { blue:'#1e7fd4', bluelight:'#4a9fe0', bluedark:'#1568b8',
               teal:'#14b8a6', teallight:'#2dd4bf', tealdark:'#0e9488', sage:'#a7c9bf' },
      ink: '#0f2942',
      navy: { 900:'#070d1a', 850:'#0a1020', 800:'#0d1528', 750:'#111c33', 700:'#162240', 600:'#1e3060' },
    },
    fontFamily: { sans: ['Inter','system-ui','sans-serif'] },
  } },
};
```

**Signature CSS:** `.grad-brand / .grad-text / .grad-soft / .grid-pattern / .card / .screenshot / .btn-primary / .btn-ghost / .badge-* / .stage-pill` — rule bodies live in `tokens.css` (values) + `site.css` (components), extracted from `landing.html`.

**Logo SVG symbol (drop once per page, hidden; then `<use href="#piqc-mark"/>`):**

```html
<svg width="0" height="0" style="position:absolute" aria-hidden="true"><defs>
  <linearGradient id="ribbonGrad" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0%" stop-color="#2b8fd9"/><stop offset="55%" stop-color="#1e9fc0"/><stop offset="100%" stop-color="#14b8a6"/>
  </linearGradient>
  <linearGradient id="wingGrad" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0%" stop-color="#c6e0d8"/><stop offset="100%" stop-color="#a0c8bc"/>
  </linearGradient>
  <symbol id="piqc-mark" viewBox="0 0 64 64">
    <path d="M6 24 C 14 14, 30 14, 33 38 C 20 40, 8 34, 6 24 Z" fill="url(#wingGrad)" opacity="0.6"/>
    <path d="M12 30 C 18 24, 28 24, 31 39 C 22 40, 14 37, 12 30 Z" fill="url(#wingGrad)" opacity="0.5"/>
    <path d="M28 58 C 20 46, 46 39, 39 24 C 35 15, 43 11, 47 8" fill="none" stroke="url(#ribbonGrad)" stroke-width="4" stroke-linecap="round"/>
    <path d="M33 58 C 45 47, 23 40, 31 25 C 36 16, 33 12, 41 7" fill="none" stroke="url(#ribbonGrad)" stroke-width="2.2" stroke-linecap="round" opacity="0.85"/>
    <path d="M47 3 L48.7 8.3 L54 10 L48.7 11.7 L47 17 L45.3 11.7 L40 10 L45.3 8.3 Z" fill="#2b8fd9"/>
    <circle cx="40" cy="15" r="1.3" fill="#2b8fd9"/><circle cx="37" cy="19" r="1.05" fill="#2b8fd9"/><circle cx="35" cy="23" r="0.85" fill="#2b8fd9"/>
    <circle cx="45" cy="31" r="1.3" fill="#1e9fc0"/><circle cx="47" cy="36" r="1.05" fill="#14b8a6"/><circle cx="46" cy="41" r="0.85" fill="#14b8a6"/>
  </symbol>
</defs></svg>
```

**Wordmark:** `<span class="grad-text">PIQC</span><span class="text-ink font-light">linical</span>`

---

## Appendix B — copy seeds (refine against the strategy doc)

- **Home eyebrow / H1:** "A better question for clinical trial execution." / **"From protocol complexity to context-aware understanding."**
- **Category line:** **"PIQC is the missing intelligence layer between protocol complexity and clinical execution."**
- **Recurring proof line:** **"AI drafts. Humans decide. Everything is traceable."**
- **Burden line:** "Protocols will remain complex. The human burden does not have to."
- **Boundary line:** "PIQC prepares. Your people and systems govern."
- **Founder statement:** "PIQC exists to replace manual interpretation overload with anytime mastery."
- **Site H1:** "Every role. Every requirement. Day-of-visit ready."
- **Audit H1:** "An 8-stage vendor audit that enforces itself."
- **Sponsor H1:** "Parse the protocol once. Generate every deliverable."
- **Security H1 (restrained):** "Designed with privacy, controlled access, and auditability in mind."
