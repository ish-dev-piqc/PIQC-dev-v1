# PIQClinical Marketing Site — Design Map

The map Claude Design (and any human) reads before iterating. Keep it in sync when structure changes.

## Files
- `FABLE-BRIEF.md` — the full build brief handed to Fable (vision narrative, product facts, page specs, animation direction).
- `tokens.css` — **single source of truth** for color / gradient / surface / control / motion values.
- `content.js` — centralized copy + role/lifecycle/module data, so wording changes don't touch layout.
- `index.html` (vision narrative), `site.html`, `audit.html`, `sponsor.html`, `security.html` — the five pages (Fable produces these).
- Reference: `../landing.html` — the original single-page site; canonical brand source.

## What this site is
Two layers in one: **Home = the founder-vision, category-defining narrative** ("PIQC is the missing intelligence layer between protocol complexity and clinical execution"); the **mode pages = product proof** for buyers. Calm, editorial, clinically credible — never a generic AI-startup scroll. Every claim is either **Live today** or visibly labeled **Platform direction**.

## Golden rules
1. **No hardcoded design values in markup.** Colors, radii, shadows, and animation timings live in `tokens.css` (CSS custom properties) + the Tailwind inline config. Change the look globally from one place.
2. **Sections are composable.** Every section is `<section id="…" data-section="…">` with a naming comment. Safe to reorder, restyle, or lift into a component later.
3. **Animations degrade.** Every hero animation uses a `data-anim` hook and honors `prefers-reduced-motion` (see `tokens.css`) — reduced-motion shows the final static frame.
4. **Zero build.** Pure static; runs with `python3 -m http.server`. Deploys to Cloudflare Pages with no build command.

## Tokens (see tokens.css for values)
- **Brand:** `--scrub-blue/-teal` (+ light/dark variants), `--scrub-sage`, `--ink`.
- **Navy scale** `--navy-900…-600` — dark product mockups only.
- **Gradient** `--grad-brand` (135° blue→teal) → utilities `.grad-brand`, `.grad-text`, `.grad-soft`, `.grid-pattern`.
- **Motion** `--anim-fast/-base/-hero`, `--ease-out`.

## Component classes
`.card` (light, lifts on hover) · `.screenshot` (dark mockup shell) · `.btn-primary` / `.btn-ghost` · `.badge-high/-medium/-blue` · `.stage-pill` (uppercase micro-caps) · `.grad-text` (wordmark + accent headings).

## Typography
Inter 300–800. Headings: `text-ink`, `font-extrabold`, `tracking-tight`. Body: slate-500/600, relaxed leading. Accent phrases in `.grad-text`.

## Logo
Inline SVG symbol `#piqc-mark` (wing + crossing ribbon + sparkle + dot trail). Render with `<use href="#piqc-mark"/>`. Wordmark: `PIQC`(`.grad-text`) + `linical`(`text-ink font-light`).

## Shared partials (copy-pasted into each page — keep identical)
- **Nav:** fixed, `bg-white/85 backdrop-blur`, logo left, links (Features · Modes · Security · Contact), `.btn-primary` "Request a Demo" right.
- **Footer:** logo + tagline, link columns, compliance line, copyright.
- **Demo form:** Name / Organization / Work Email / Clinical Role (grouped select) / optional message; client-side validation + success state; backend hook left as a TODO comment.

## Page anatomy
| Page | Hero animation (`data-anim`) | Key sections |
|---|---|---|
| `index.html` (vision) | `home-flow` | **A** Hero: The Missing Layer · **B** Manual interpretation burden (before/after) · **C** First failure upstream (timeline) · **D** Parse once, generate many (intelligence map) · **E** Who it serves (role lenses) · **F** Understanding first, action second (warm handoff) · **G** Living knowledge transfer — *Direction* (lifecycle) · **H** What PIQC is / is not (boundary table) · **I** Founder intent · **J** Explore the product (3 mode cards + stats) · **K** Security teaser · **L** Final CTA + demo · Footer |
| `site.html` | `site-checklist` | Boundary reassurance · Hero · Site interpretation burden · Visit Execution Workspace · Completeness signals · Role-filtered worksheets · Ask copilot · Realtime · CTA |
| `audit.html` | `audit-pipeline` | Boundary reassurance · Hero · 8-stage gated stepper · Risk-scored findings · Issue→CAPA · AI report drafting (earned write-back) · Amendment/traceability · Investigator audits (*Direction*) · CTA |
| `sponsor.html` | `sponsor-fanout` | Boundary reassurance · Hero · Parse-once-generate-many · Deliverable Engine (Monitoring Checklist + Risk Overview) · Content-origin badges · Byte-level provenance · Regeneration · Portfolio · Fragility view (*Direction*) · CTA |
| `security.html` | `security-shield` (subtle) | Zero-PHI · RLS · 21 CFR 11 audit trail · Encryption/MFA · EU residency · Compliance badges · CTA |

**Nav (anchored on home):** Why PIQC · How It Works · Who It Serves · Product Boundary · Founder Intent · Modes ▸ (Site/Audit/Sponsor) · Security · Request a Demo.

**Voice guardrails (see FABLE-BRIEF §1):** systems problem not people problem · draft-aid (prepares, never approves/certifies) · Live-today vs Platform-direction always distinct · no invented metrics/logos/certs · no "prevents deviations / guarantees inspection readiness" · **founder voice = earned conviction & problem-mastery, never résumé/LinkedIn/tenure-counting.**

## Hero animation hooks
Each hero mockup: initial elements carry `.is-static` (final state) + a `data-anim="<name>"` container. JS sequences the intro then loops gently. Central timing in `--anim-hero`. All must look correct as a still frame (reduced-motion + Cloudflare/OG capture).

## Preview & review loop
```
cd website && python3 -m http.server 8000    # → http://localhost:8000
```
Then: Claude Preview MCP on each page → `/design-critique` and `/accessibility-review` → adjust `tokens.css` / section markup → re-preview. Check mobile (375) / tablet (768) / desktop (1280) and reduced-motion.
