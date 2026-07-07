# PIQClinical Marketing Site — Design Map

The map Claude Design (and any human) reads before iterating. Keep it in sync when structure changes.

## Files
- `FABLE-BRIEF.md` — the full build brief (truth hierarchy, product facts, page specs, animation direction, claim register, quality gates). **The authority.**
- `WEB-DESIGN-SYSTEM.md` — the design-system rationale (layer architecture, scales, components, motion, a11y, trade-offs). Read for the *how*.
- `tokens.css` — **canonical VALUES only** (color / type / spacing / radius / shadow / z-index / motion).
- `site.css` — **reusable component + layout styles** (reads values from `tokens.css`).
- `animations.js` — hero-animation + interactive-demo behavior.
- `content.js` — centralized copy + mock data (wording changes here don't touch layout).
- Routes (directory-index → clean URLs): `index.html` → `/` · `site/index.html` → `/site` · `audit/index.html` → `/audit` · `sponsor/index.html` → `/sponsor` · `security/index.html` → `/security`. Plus `404.html`, `sitemap.xml`, `robots.txt`, `favicon.svg`, `og-card.png`.
- Reference: `../landing.html` — canonical brand source.

## What this site is
Two layers in one: **Home = the founder-vision, category narrative** ("PIQC is the missing intelligence layer between protocol complexity and clinical execution") **told as a three-act product story** — **Act 1** core engine (protocol → visual, review-ready visit drafts → speed; the star), **Act 2** Ask answered by the protocol (intelligence beside the cited source; co-star), **Act 3** downstream to Audit & Sponsor (the payoff). The **mode pages = product proof**. Lead with the engine. Calm, editorial, clinically credible. Every claim is **Live today** or visibly labeled **Platform direction** (Truth hierarchy, FABLE-BRIEF top).

## Golden rules
1. **No hardcoded design values in markup.** Values live in `tokens.css`; components in `site.css`. Tailwind (if used) is pinned and mapped to the same tokens — never a second value system.
2. **Sections are composable.** Every section is `<section id="…" data-section="…">` with a naming comment.
3. **Animations degrade.** Hero animations use a `data-anim` hook, start when visible, offer a pause control if persistent, and honor `prefers-reduced-motion` (final static frame). Mockups must never imply AI approves/certifies/signs/replaces review.
4. **Zero build.** Static; `python3 -m http.server`. Deploys to Cloudflare Pages with no build command.
5. **Claims discipline.** Product metrics trace to FABLE-BRIEF §4/§4.5; security/compliance claims appear only via the §6.5 register. No "0 gaps"/"zero PHI"/"certified"/"immutable" without approval.

## Tokens (see tokens.css)
Brand `--scrub-*`, `--ink`, navy scale · semantic `--fg-*`, `--surface/-2/-dark`, `--border-hairline`, `--accent`, state colors · `--grad-brand` · type scale `--text-*` + `--measure` · spacing `--space-*` (8-pt) · radius `--radius-chip/-control/-card/-frame` · 3 shadows · `--z-*` · motion `--anim-*` + `--ease-out`.

## Component classes (site.css)
`.card` · `.screenshot` (MockupFrame) · `.btn-primary`/`.btn-ghost` (≥44px) · `.badge-high/-medium/-blue` · `.stage-pill` · `.citation-chip` ★ · `.provenance-line` ★ · `.direction-tag` (on every Platform-direction claim) · `.field` (forms) · `.grad-text` · `.prose` (`--measure` cap) · `[data-reveal]` scroll-in.

## Logo
Inline SVG symbol `#piqc-mark`. Render with `<use href="#piqc-mark"/>`. Wordmark: `PIQC`(`.grad-text`) + `linical`(ink, light). Generate the production `favicon.svg` from this mark.

## Shared partials — IDENTICAL across every route
Store canonical markup once; keep byte-identical on every page (FABLE-BRIEF §9). Before handoff verify nav links, CTA labels, footer links, logo, and legal links match on all routes. No dead links / placeholder legal / fake social — **missing legal/policy destinations are release blockers.**
- **Nav:** fixed, translucent, logo left, anchor links + Modes + Security, `.btn-primary` "Request a Demo" (→ `content.js demo.ctaHref`, a real destination — §8).
- **Footer:** logo + tagline, link columns, copyright. Real Privacy/Terms when ready (not placeholders).
- **Demo form:** never requests PHI/study data; wired to a real endpoint or the mailto fallback — **no simulated success** (§8).

## Page anatomy
| Route | Hero animation (`data-anim`) | Key sections |
|---|---|---|
| `/` (vision + 3-act story) | `home-flow` + `ask-source` | **A** Hero (core-engine money shot) · **B** Burden · **C** First failure upstream · **D·ACT1** Core engine — protocol → visual visit drafts *(biggest visual)* · **E·ACT2** Ask, answered by the protocol *(split source view)* · **F·ACT3** Downstream — Audit & Sponsor (3 cards + stats) · **G** Who it serves · **H** Understanding first · **I** Living knowledge transfer *(Direction)* · **J** What PIQC is/is not · **K** Founder intent · **L** Security teaser *(restrained)* · **M** Final CTA + demo · Footer |
| `/site` (core engine, in depth) | `site-checklist` | Boundary reassurance · Hero · Core engine (VEW) · Completeness signals · **Ask, answered by the protocol** (elevated) · Role-filtered worksheets · Realtime · CTA |
| `/audit` | `audit-pipeline` | Boundary reassurance · Hero · 8-stage gated stepper · Risk-scored findings · Issue→CAPA · AI report drafting (earned write-back) · Amendment/traceability · Investigator audits *(Direction)* · CTA |
| `/sponsor` | `sponsor-fanout` | Boundary reassurance · Hero · Parse-once-generate-many · Deliverable Engine · Content-origin badges · Source provenance · Regeneration · Portfolio · Fragility view *(Direction)* · CTA |
| `/security` | `security-shield` (subtle) | **Restrained only** — privacy, controlled access, auditability, protocol-only data handling. **No badges/guarantees until the §6.5 claim register is filled.** |

**Voice guardrails (FABLE-BRIEF §1):** systems problem not people problem · draft-aid ("PIQC advises and drafts; humans review, decide, and approve") · Live-today vs Platform-direction always distinct · no invented metrics/logos/certs · founder voice = conviction, never résumé/LinkedIn.

## Accessibility (AA — run a final pass across mobile/tablet/desktop)
Semantic headings in order · landmarks (`header`/`nav`/`main`/`footer`) + skip link · visible keyboard focus (`site.css :focus-visible`) · keyboard-operable nav/forms (no hover-only) · labels + associated errors · alt text on meaningful imagery, `aria-hidden` on decorative · AA contrast · **no color-only meaning** · reduced-motion · ≥44px touch targets · no comprehension-blocking autoplay.

## Preview & review loop
```
cd website && python3 -m http.server 8000    # → http://localhost:8000  (/, /site, /audit, /sponsor, /security)
```
Then: Claude Preview MCP per route → `/design-critique` + `/accessibility-review` → adjust `tokens.css`/`site.css`/section markup → re-preview. Check mobile 375 / tablet 768 / desktop 1280 and reduced-motion. Finish with the FABLE-BRIEF §11 quality gates + handoff report.
