# Fable Build Brief — PIQClinical Website (Vision + Product)

> **How to use this file:** Paste this entire document to Fable as the build prompt. Also attach your `sales-marketing-strategy.md`. Fable produces a static, multi-page site under `website/`. After the build, iterate with Claude Design (see §7).

---

## 0. TL;DR for Fable

Build a **best-in-class website for PIQClinical** that does two jobs at once:
1. **A founder-vision, category-defining narrative** — argues that PIQC is *a new layer clinical trials have been missing*, in calm, clinically-credible, investor-grade prose.
2. **A buyer-facing product site** — shows the three surfaces (**Site Mode, Audit Mode, Sponsor Mode**) in enough concrete detail to book a demo.

**The one sentence a visitor must leave with:**
> **PIQC is the missing intelligence layer between protocol complexity and clinical execution.**

**Architecture of the site:**
- **Home (`index.html`)** = the vision narrative (the editorial, single-scroll founder story with anchored nav). This is the emotional and category argument.
- **`site.html` / `audit.html` / `sponsor.html`** = the "product proof" deep-dives for buyers who want to see it work.
- **`security.html`** = the regulated-environment trust page.

**Stack:** zero-build static — one `.html` per page, **Tailwind via CDN + inline `tailwind.config`** (same as the existing `landing.html`), shared `tokens.css`, vanilla JS. No bundler. Deploys to **Cloudflare Pages** with no build step, intended for **piqclinical.com**.

**Primary CTA everywhere:** **"Request a Demo."** Softer secondaries: "See the protocol journey," "Talk through your protocol workflow."

**Truth constraint:** describe **only** what §4 marks **Live today**. Everything else is **Platform direction** and must be visibly labeled. Never invent metrics, certifications, customers, or partner logos.

---

## 1. Positioning, voice & guardrails

### North star
> **PIQC transforms protocol complexity into context-aware understanding, then hands the user to the right tool at the right moment.**

### The core argument (the spine of the whole site)
- Manual protocol interpretation is a **cognitive tax** on clinical trial execution. Teams read, cross-reference, and translate dense protocols into worksheets, monitoring priorities, audit scope, training, and site guidance — by hand, from working memory.
- **This is a systems problem, not a people problem.** The system asks skilled professionals to absorb too much protocol logic manually. Never imply sites, CRAs, auditors, or sponsors are careless or noncompliant.
- **The first failure happens upstream** — not at the first patient visit, but earlier, when a protocol requirement is manually translated into a workflow. PIQC reduces that interpretation burden *before* execution.
- **Understanding first. Action second.** PIQC prepares the human, then **hands off to the systems the organization already trusts** (EDC, CTMS, eTMF, training, travel). It does not replace them. *"PIQC helps people arrive in those systems informed rather than overloaded."*
- **Parse once, generate many.** One source-traceable protocol intelligence backbone → many role-specific expressions. Humans remain responsible.

### Voice
Confident, clear, calm, spacious, editorial. Respect the reader's expertise. Lead with the *systemic pain*, then the *proof*. Compliance-forward (HIPAA / 21 CFR Part 11). No hype, no fear tactics, no exclamation marks, no "revolutionary/magic/instant."

**Founder register (the whole site, and Section I especially):** it should read like an **experienced founder who has lived this problem and is certain of the build** — earned conviction, not a résumé. Authority is shown by **naming the problem more precisely than anyone else in the room**, not by listing tenure, titles, employers, or "X years of experience." **Never a LinkedIn/CV tone.** No credential-bragging, no "seasoned professional," no year-counts. The confidence is quiet and total: *this layer must exist, and here's exactly why.*

**Use these themes (don't repeat mechanically):** manual interpretation load · cognitive burden · structured protocol intelligence · **anytime mastery** · context-aware understanding · source-traceable materials · role-specific views · human review and responsibility · **understand first, act second** · **warm handoff** · *"protocols will remain complex; the human burden does not have to"* · *"PIQC prepares; people and systems govern."*

**Avoid:** "generic AI copilot" language · "magic / instant compliance" · claims PIQC **prevents deviations, improves safety, or guarantees inspection readiness** (only ever as explicitly-labeled future validation goals) · "protocol clarity" phrasing that implies protocols are badly written · talking down to clinical staff · implementation detail in customer-facing copy · huge text blocks · invented logos/testimonials/metrics/integrations/certifications · **résumé / LinkedIn / credential-bragging tone** (tenure counts, job titles, "seasoned expert") — especially in Founder Intent. Prefer *reduce, support, prepare, surface, help teams understand, enable review* over outcome promises.

### Hard guardrails
1. **Accuracy + Live-vs-Direction.** Only present §4 **Live today** capabilities as current. Anything in **Platform direction** must carry a visible label ("Platform direction" / "Designed to extend"). Never blur the two.
2. **Draft-aid positioning.** PIQC *drafts, flags, surfaces, prepares*; humans review and approve. Never "approves / certifies / signs / attests / mandates," never "system of record."
3. **Boundary honesty.** PIQC is **not** an EDC, eSource, CTMS, eTMF, LMS, travel system, compliance tracker, generic AI assistant, or replacement for clinical judgment. Say so plainly (§5, Section H).
4. **Messaging precedence.** The attached **`sales-marketing-strategy.md` wins on positioning/tone/claims**; **this brief wins on product facts.** Never let copy overstate the product.
5. **No sponsor branding / third-party logos.** Mockups stay generic ("Acme BioPharma"); external systems shown as neutral labels ("EDC," "CTMS," "Travel System") — no real logos.
6. **Zero PHI.** No real patient data; fake IDs like `P-0023`. All mock UI clearly illustrative.

---

## 2. Audience

**Primary (buyers):** site-network leadership, site managers, lead coordinators, clinical-operations leaders, sponsor study teams, CRAs/monitors, QA/audit leaders.
**Secondary:** clinical-research investors, strategic advisors, future partners.

Speak to all without clutter — the vision narrative lands for investors; the mode pages and demo CTA convert buyers. Each role should find its own question answered (see §5 Section E):

| Audience | Question the site must answer |
|---|---|
| Site teams | How does PIQC cut the burden of turning a protocol into usable study workflows? |
| CRAs / monitors | How can PIQC focus oversight *before* a visit without replacing my CTMS/plan/travel tools? |
| Sponsors / ClinOps | How does PIQC surface protocol-derived operational complexity before it becomes execution burden? |
| QA / Audit | How does PIQC give protocol-aware prep and evidence-backed review focus? |
| Investors | Why is PIQC a reusable protocol-intelligence *platform*, not a one-off AI feature? |

---

## 3. Brand system — reuse from `landing.html` verbatim

The repo root contains `landing.html`. **It is the canonical brand reference — mine its styles.** Exact tokens + logo SVG are in **Appendix A** and in the starter files `website/tokens.css` and `website/DESIGN.md`.

- **Palette (medical scrub):** `scrub-blue #1e7fd4 / bluelight #4a9fe0 / bluedark #1568b8`, `scrub-teal #14b8a6 / teallight #2dd4bf / tealdark #0e9488 / sage #a7c9bf`, `ink #0f2942`; dark-mockup navy scale `#070d1a…#1e3060`.
- **Gradient:** `linear-gradient(135deg,#1e7fd4→#14b8a6)` → `.grad-brand`, `.grad-text`, `.grad-soft`, faint `.grid-pattern`.
- **Type:** Inter 300–800. Big, tight headings; relaxed slate body; accent phrases in `.grad-text`.
- **Logo:** inline `#piqc-mark` SVG (wing + crossing ribbon + 4-point sparkle + dot trail). Wordmark `PIQC`(grad)+`linical`(ink, light).
- **Surfaces:** light `.card`; dark `.screenshot`; `.btn-primary`/`.btn-ghost`; `.badge-*`, `.stage-pill`.
- **Tokenization rule (load-bearing for Claude Design):** every color/radius/shadow/spacing/animation value lives in `tokens.css` + the Tailwind config. **No raw hex or magic numbers in markup.**

---

## 4. Product facts — ground truth (Live today vs Platform direction)

Write from this; don't exceed it. Bold terms are the product's real vocabulary.

### The shared foundation — Protocol Intelligence (SOTR) · **Live today**
Upload a protocol PDF → **structured, confidence-scored, source-cited, review-ready** data.
- Extracts **endpoints, eligibility (inclusion/exclusion), visit schedules (Schedule of Assessments), dosing, prohibited medications, cohorts, amendments**.
- Every item carries a **confidence state** (high/medium/low/needs-review) + score + reason.
- Every item links to **source evidence**: quoted text, page number, **bounding box** (byte-level location), typed **primary/secondary/context/conflict**.
- **SOTR (Source-of-Truth Reviewer):** human **Accept for draft / Edit / Reject / Flag**, each logged with reviewer + timestamp + version. **AI extracts; humans own interpretation.**
- **Amendment-aware:** version changes flag affected extractions for an adopt-or-dismiss decision.
- Line: *"AI outputs are evidence-backed drafts, not black-box truth."*

### Site Mode — research sites (coordinators, nurses, investigators) · **Live today**
- **Calendar / Visits / Participants** with realtime materialization of a participant's visit schedule on enrollment.
- **Visit Execution Workspace (VEW):** per-visit snapshot + a checklist grouped into **7 phases** (Pre-Visit Prep, Check-In, Core Procedures, Dosing, Post-Dose, Safety/AE/Conmed, Closeout); each requirement has a **classification** (required / conditional / if-applicable / primary-endpoint / secondary-endpoint / safety-critical), a **confidence dot**, and a **§ traceability** link to the exact protocol source (SoA cell, section, page, amendment, verbatim quote).
- **Completeness signals:** a second pass flags **"possibly-missing requirements"**; coordinator **adds** or **dismisses** — never auto-added.
- **Role-filtered worksheets:** filter to **Coordinator / Nurse / Investigator / Lab / Pharmacy**; export a **draft PDF worksheet**. One dataset → five role-ready handoffs.
- **Ask:** **protocol-grounded copilot** (RAG), phase/role-aware prompts, every answer cites section + page.

### Audit Mode — auditors, QA, sponsors · **Live today (vendor audit)**
Gated **8-stage vendor audit**: **Intake → Vendor Enrichment → Questionnaire → Scope & Risk → Pre-Audit Drafting → Conduct → Report → Export** (advancement gated by approvals).
- **Risk-scored findings:** CRITICAL/HIGH/MODERATE/LOW × **DATA_INTEGRITY / PATIENT_SAFETY**; each traces protocol requirement → vendor responsibility → evidence.
- **Issue → CAPA** lifecycle (DRAFT → NEEDS_REVISION → ACCEPTED → EXPORTED), auto-prefilled from finding context.
- **AI-assisted report drafting** (exec summary + conclusions) with **earned write-back** — two explicit human confirmations before any AI text enters the report.
- **Amendment alerts, traceability/lineage, immutable per-object history, evidence attachments.**
- **Platform direction:** the same workspace **extending to investigator / site audits** — label as expanding, not shipped.

### Sponsor Mode — pharma sponsors (enterprise tier) · **Live today (Deliverable Engine)**
**Parse once, generate many** via the **Protocol Deliverable Engine**.
- **Deliverables (live):** **Monitoring Preparation Checklist** (nine monitoring-priority sections) and **Risk Overview** (six plain-language operational-complexity sections; no opaque scores). Set is extensible.
- **Content-origin honesty badges:** every block typed **Protocol Fact** (solid; evidence+confidence+quote) / **PIQC Framing** (outlined, Sparkles; no confidence, no protocol provenance) / **Human Note** (quiet; never overwritten). Prevents "borrowed authority."
- **Byte-level provenance:** click a fact → source drawer (quote, page, section, confidence); **"View cited page"** opens the PDF to that spot.
- **Regeneration preserves human work;** rejected items can't resurrect; full edit log. **Coverage-gap honesty** (e.g., emits a gap block when no prohibited-med list was extracted).
- **DRAFT-watermarked PDF exports** with a "requires human review" disclaimer + traceability appendix; sponsor-name-free.
- **Portfolio intelligence:** read-only enrollment / visits / deviations across the sponsor's sites.
- **Platform direction:** sponsor "**operational fragility view**," CRA-facing monitoring outputs as a distinct role surface.

### Living Protocol Knowledge Transfer · **Platform direction (label clearly)**
The vision that one protocol-intelligence backbone re-expresses itself across the study lifecycle (startup → SIV → enrollment → conduct → amendment → monitoring/audit → closeout) — e.g., **SIV knowledge-transfer packages**, role quick-references, amendment-impact views. Present as *where the platform is going*, not current functionality. **Never imply LMS / training-record capability** — organizations own training approval, delivery, records, competency, signatures, storage.

---

## 5. Home page (`index.html`) — the vision narrative

A focused, **editorial single-scroll** experience with anchored nav — **not** a repetitive SaaS feature scroll. Progressive disclosure, strong hierarchy, generous whitespace.

**Anchored nav:** Why PIQC · How It Works · Who It Serves · Product Boundary · Founder Intent · **Modes** (→ Site / Audit / Sponsor) · Security · **Request a Demo**.

**Section A — Hero: The Missing Layer.**
Eyebrow "A better question for clinical trial execution." H1 **"From protocol complexity to context-aware understanding."** Sub: clinical systems manage data, documents, workflow, and oversight — *but they assume someone has already translated the protocol into usable understanding.* PIQC is that layer. CTAs: **Request a Demo** (primary) · **See the protocol journey** (secondary, scrolls to Section C/D).
Hero visual (calm, deterministic — see §6): `Protocol PDF → structured protocol intelligence → context-aware understanding → role-specific output → warm handoff to existing system`, with role outputs (Site: Study Worksheet · CRA: Monitoring Checklist¹ · Sponsor: Fragility View¹ · QA: Audit Focus¹ · Study team: SIV Package¹) and neutral handoff destinations (EDC · CTMS · eTMF · Training). (¹ mark Platform-direction outputs.)

**Section B — The manual interpretation burden.** "The burden isn't reading the protocol. It's translating it into execution." Contrast **Before PIQC** (manual review → cross-referencing → local notes/spreadsheets → repeated questions → re-created deliverables → execution) vs **With PIQC** (structured intelligence → traceable role-specific understanding → editable deliverables → prepared action → existing system). Key line: **"Protocols will remain complex. The human burden does not have to."** No outcome claims.

**Section C — The first failure happens upstream.** "Before a protocol can be executed, it must be operationalized." Timeline `Protocol received → interpretation → worksheets/workflows → site prep & SIV → activation → first patient visit`, highlighting the interpretation/operationalization phase as PIQC's focus. Language: *"where complexity deserves attention,"* never *"what humans get wrong."*

**Section D — How it works: Parse once, generate many.** "One protocol intelligence backbone. Many moments of understanding." The **protocol-intelligence map**: Protocol → structured intelligence (visits & windows · procedures · eligibility/exclusion · prohibited meds · endpoints · safety/lab · cohort logic · vendor dependencies · amendments · source citations) → role-specific views. On select, reveal an illustrative artifact (not a dense table). Close: **"Parse once. Generate many. Humans remain responsible."**

**Section E — Who it serves: different questions, shared intelligence.** Role cards (keyboard-accessible, not hover-only). Each: the role's *question* + an *illustrative output*. Site (What do I do next? → study worksheets/visit guidance — **Live**) · CRA (What deserves focused oversight? → monitoring-visit checklist/window reminders — **Direction**) · Sponsor/ClinOps (Where is the protocol operationally complex? → fragility map/amendment impact — Risk Overview is **Live**, fragility view is **Direction**) · QA/Audit (What should be validated? → protocol-aware audit scope/evidence-linked checklists — 8-stage audit is **Live**) · Study team (What must each role understand before execution? → SIV knowledge-transfer package — **Direction**). Label every Direction item.

**Section F — Understanding first. Action second.** "PIQC prepares the next action. Your existing systems execute it." Action-layer visual: *monitoring visit needs prep → PIQC explains why it matters (endpoint-critical procedures, time-sensitive windows, amendment-affected requirements, eligibility/prohibited-med areas) → next action → open the org's preferred system (neutral labels).* Key line: **"PIQC informs. PIQC prepares. PIQC guides. Your systems execute."** (Do not build travel/CTMS flows or imply PIQC directs monitoring cadence.)

**Section G — Living protocol knowledge transfer · Platform direction.** "Protocol understanding shouldn't expire after the SIV." Lifecycle strip (Startup → SIV → Enrollment → Conduct → Amendment → Monitoring/Audit → Closeout) with a concise example per stage. Boundary copy: *PIQC prepares knowledge-transfer materials; organizations remain responsible for training approval, delivery, records, competency, signatures, and controlled storage.* Section visibly framed as platform direction; **no LMS implication.**

**Section H — What PIQC is / is not.** Calm two-column boundary table:

| PIQC does | PIQC does not |
|---|---|
| Converts protocol content into structured, traceable understanding | Replace clinical judgment |
| Prepares editable, role-specific draft materials | Become the system of record |
| Helps teams locate protocol evidence in context | Execute regulated workflows |
| Supports preparation, review, and human decision-making | Replace CTMS, EDC, eTMF, LMS, or travel tools |
| Provides context-rich handoffs | Approve, attest, certify, or mandate decisions |

Framing line: **"PIQC prepares. Your people and systems govern."**

**Section I — Founder intent.** Write it in the **founder register** (see §1) — an experienced founder sounding out this problem with total conviction, **not** a bio. Headline: "Built from the belief that clinical teams deserve better support before execution begins." Copy: state the problem with earned precision — *the same pattern shows up on every study: skilled teams re-deriving a protocol's meaning by hand, from memory, under time pressure, before anyone has seen a patient.* Make clear it's a **systems failure, not a people failure**, and that this is why PIQC was built — to move that burden upstream while keeping human judgment, review, quality, and accountability at the center. Land on conviction about the build: *this intelligence layer must exist.* Statement: **"PIQC exists to replace manual interpretation overload with anytime mastery."**
**Do NOT:** count years of experience, list job titles/employers, use LinkedIn/CV phrasing ("seasoned," "over a decade of…"), name unrelated employment, or call PIQC a side project. Authority comes from how well the problem is named — a first-person, plainspoken founder voice is welcome; a résumé is not. Optionally a single quiet credibility line (e.g., "built by people who have audited these trials from the inside") — but only if it reads as conviction, never as a credential.

**Section J — Explore the product (bridge to proof).** Three cards (Site / Audit / Sponsor): icon, who-it's-for, 3 bullets, "Explore [Mode] →" to the deep-dive page. Stats band on the gradient: **8** gated audit stages · **5** role-filtered views · **4** evidence support types · **0** PHI stored.

**Section K — Security teaser** → link to `security.html`. **Section L — Final CTA + demo form** ("The protocol should be a source of mastery, not a recurring cognitive burden.") → **Footer.**

---

## 6. Mode & security pages (product proof)

Each mode page opens with a one-line **boundary reassurance** ("Works alongside your EDC/CTMS — PIQC prepares, your systems execute") and clearly separates **Live today** from **Platform direction**. Reuse the shared nav/footer and the demo form.

- **`site.html` — Site Mode.** Hero (Site animation) → the interpretation burden for sites → Visit Execution Workspace (phases, classification, confidence, § traceability) → completeness signals → role-filtered worksheets → Ask copilot → realtime sync → CTA.
- **`audit.html` — Audit Mode.** Hero (Audit animation) → the 8-stage gated pipeline (visual stepper) → risk-scored findings → Issue→CAPA → AI report drafting with earned write-back → amendment alerts/traceability → "expanding to investigator audits" (Direction) → CTA.
- **`sponsor.html` — Sponsor Mode.** Hero (Sponsor animation) → parse-once-generate-many → Deliverable Engine (Monitoring Checklist + Risk Overview) → content-origin honesty badges → byte-level provenance → regeneration preserves human work → portfolio intelligence → "operational fragility view" (Direction) → enterprise-tier note → CTA.
- **`security.html`.** Zero-PHI architecture ("PHI cannot be entered — by design, not policy") · row-level security at the DB layer · 21 CFR Part 11-aligned immutable audit trail · amendment version tracking · encryption in transit & at rest · MFA · EU data residency · compliance badges (HIPAA / GDPR / SOC 2 / 21 CFR 11 — label as target/alignment where not yet certified) → CTA.

**Demo form (shared).** Name*, Organization*, Work Email*, Clinical Role* (grouped select: Site Operations / Sponsor·CRO / Other), optional message; client-side validation + success state (reuse `landing.html`'s JS). Backend left as `// wire to Formspree/HubSpot/Cloudflare endpoint here`.

---

## 7. Animation & visual direction — calm, not flashy

The mockups must feel **clinically credible and editorial**, not like a generic AI startup. **Avoid** glowing orbs, robot imagery, vague futuristic gradients, glass-card pileups, and noisy animated backgrounds. Motion is **restrained and purposeful**, dramatizing *protocol → intelligence → action*, and **every animation must read correctly as a still frame** (for reduced-motion, OG capture, and print). Respect `prefers-reduced-motion: reduce` (fallback = final static state; see `tokens.css`). No autoplay video. Use `data-anim` hooks so Claude Design can retune timing centrally.

- **Home hero (`home-flow`):** a protocol page resolves, left-to-right, into structured intelligence, then into role outputs, then a soft "handoff" to neutral system labels. Gentle, one pass, then a slow idle. Tagline: *"One protocol. Every role, prepared."*
- **Site (`site-checklist`):** requirement rows populate a phased checklist; confidence dots settle; footer types "PIQC drafted · 14 requirements · 0 gaps detected"; role chips animate a filter.
- **Audit (`audit-pipeline`):** the 8 stage pills light left→right; a gate unlocks with a soft pulse; a CRITICAL · Data Integrity finding slides in; the risk tally counts up.
- **Sponsor (`sponsor-fanout`):** one protocol node fans into two deliverable cards; blocks fill, each stamped Protocol Fact / PIQC Framing; a source-trace drawer slides in showing "…RECIST 1.1… §7.1.1 · p.42."
- **Security (`security-shield`, subtle):** a shield with a "0 PHI" counter; compliance badges settle in.

Prefer bespoke, deterministic illustrative product UI (visit card with source citations · monitoring-focus card with rationale · fragility card with explainable factors · SIV outline · warm-handoff action card) over stock imagery. All mock content clearly illustrative, PHI-free.

---

## 8. Claude Design compatibility (required)

1. **Single token source** — all design values in `tokens.css` + the Tailwind config; no inline hex/magic numbers.
2. **Semantic, composable sections** — each `<section id data-section>` with a naming comment; consistent component classes.
3. **Centralize copy** — put long-form copy and the role/lifecycle/module data in one **`content.js`** object (or clearly-marked per-section blocks) so wording can change without touching layout. (This mirrors a typed content config without forcing a framework.)
4. **Shared nav/footer** documented in `DESIGN.md` as the canonical partial.
5. **One-command preview** — `cd website && python3 -m http.server 8000`; all links relative and working when served static.
6. **`website/DESIGN.md`** — token list, component classes, spacing scale, `data-anim` hooks + timings, per-page section anatomy.
7. **Accessibility baseline** — semantic headings/landmarks, keyboard-accessible controls (no hover-only interactions), AA contrast, screen-reader labels on diagrams/interactive visuals, visible focus, responsive desktop/tablet/mobile, `prefers-reduced-motion`.

---

## 9. Deployment & SEO (Cloudflare Pages)

- **Static output only** — deploy by pointing Cloudflare Pages at `website/`; no build command.
- Per-page `<title>` / meta description / canonical / OG + Twitter card (reuse `landing.html` patterns).
- **JSON-LD:** reuse the `Organization` + `WebSite` + `SoftwareApplication` schema; keep `featureList` accurate to §4 Live-today items only.
- `favicon.svg`, `apple-touch-icon.png`, `og-card.png` — TODO slots (don't fabricate).
- `sitemap.xml` + `robots.txt` (allow marketing pages; note the app SPA stays `noindex` on its own subdomain).
- Intended domain **piqclinical.com**; keep links relative so a staging subdomain works first.

---

## 10. Build sequence & acceptance

**Phase 1 — Narrative MVP:** Home hero + Sections B, C, D, E, H, I, L, plus the three mode heroes. Must stand alone as a complete, credible site.
**Phase 2 — Interactive layer:** the protocol-intelligence map (D), role selector (E), lifecycle strip (G), action-layer visual (F) — add interaction only where it reduces cognitive load.
**Phase 3 — Product proof:** flesh out mode pages + security; wire the demo form endpoint.

**Acceptance test — a first-time visitor can explain, in their own words:**
1. PIQC is **not** an EDC, CTMS, LMS, travel system, or generic AI assistant.
2. PIQC addresses **manual protocol interpretation before execution begins**.
3. PIQC turns protocol complexity into **structured, context-aware understanding**.
4. PIQC serves **different roles through different views of the same protocol intelligence**.
5. PIQC **prepares the next action and hands off to existing systems** rather than replacing them.
6. PIQC is a **living knowledge-transfer layer** across the study lifecycle (framed as direction).
7. **Human judgment, review, approval, and regulated execution remain outside PIQC.**

Durable impression to leave: *"Every clinical system assumes the human already understands the protocol. PIQC makes that understanding available when and where it's needed."*

**Final instruction:** do not reduce this to a feature list. Build a clear, visual, clinically-grounded argument for a new category — **the intelligence layer between protocol complexity and clinical execution** — that strengthens, never replaces, the systems and professionals already responsible for execution.

---

## Appendix A — paste-ready brand tokens & logo

> Extracted from `landing.html`. Also in `website/tokens.css`. Use these exact values.

**Tailwind inline config (in each page `<head>`):**

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
    keyframes: { 'fade-up': { '0%':{opacity:'0',transform:'translateY(16px)'}, '100%':{opacity:'1',transform:'translateY(0)'} } },
    animation: { 'fade-up': 'fade-up 0.5s ease-out both' },
  } },
};
```

**Signature CSS:** reuse `.grad-brand / .grad-text / .grad-soft / .grid-pattern / .card / .screenshot / .btn-primary / .btn-ghost / .badge-* / .stage-pill` — copy the rule bodies from `landing.html` (≈ lines 132–214) into `tokens.css`.

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
- **Category line (use prominently):** **"PIQC is the missing intelligence layer between protocol complexity and clinical execution."**
- **Recurring proof line:** **"AI drafts. Humans decide. Everything is traceable."**
- **Burden line:** "Protocols will remain complex. The human burden does not have to."
- **Boundary line:** "PIQC prepares. Your people and systems govern."
- **Founder statement:** "PIQC exists to replace manual interpretation overload with anytime mastery."
- **Site H1:** "Every role. Every requirement. Day-of-visit ready."
- **Audit H1:** "An 8-stage vendor audit that enforces itself."
- **Sponsor H1:** "Parse the protocol once. Generate every deliverable."
- **Security H1:** "Built for regulated environments from the ground up."
