# PIQClinical — Web Design System & Information Architecture

> Applied via the system-design framework (requirements → architecture → deep-dive → scale/reliability → trade-offs). This is the **how** that sits under `FABLE-BRIEF.md` (the what/copy). `tokens.css` is the machine-readable source of truth; this doc is the rationale. Built to be iterated in Claude Design.
>
> **Not reinventing the wheel:** every pattern here is a proven web convention (editorial-technical marketing, à la Stripe / Linear / Vercel). What's *original* is only the tuning — clinical restraint, and making **source-traceability a visible design motif**, because that's the product's soul. See §11 for reference archetypes (patterns to borrow, never clone).

---

## 0. Design thesis — "Clinical instrument, not SaaS brochure"

You're defining a category, so the site can't look like a template. The organizing idea:

> **PIQC turns an unstructured protocol into structured, traceable understanding. The design should perform that same transformation in front of the visitor's eyes — and never let them forget every claim is sourced.**

Three signature moves make it ownable without inventing anything exotic:

1. **Dual-surface rhythm.** The page alternates **light "editorial" surfaces** (where you *read* the argument — calm, spacious, ink-on-white) and **dark "instrument" surfaces** (where you *see* the product — the navy mockups). The reader's eye learns: light = we're talking; dark = here's the machine. This contrast is the page's heartbeat and it costs nothing.
2. **Traceability as a primitive.** The `§ section · page` **citation chip** and the **"PIQC drafted · 0 gaps"** provenance line are promoted to first-class design-system components and recur everywhere — hero, mockups, mode pages. The product's whole thesis (nothing is a black box) becomes a *visual habit*. No competitor owns this.
3. **Document → structure as the hero motif.** The recurring image is a dense protocol page resolving into clean, classified rows. It's literal, deterministic, calm, and it *is* the product. One motif, reused at three scales (hero, section, inline).

Everything below is in service of those three moves.

---

## 1. Requirements

**Functional**
- Tell the 3-act product story (core engine → Ask+source → downstream) and convert to "Request a Demo."
- 5 pages: `index` (vision + 3 acts), `site`, `audit`, `sponsor`, `security`.
- Reusable across pages: nav, footer, demo form, mockup frame, CTA band.

**Non-functional (the budget)**
- **Performance:** LCP < 2.5s on 4G; CLS < 0.1; no layout shift from fonts/mockups. Animate only `transform`/`opacity`.
- **Accessibility:** WCAG 2.1 **AA** (contrast, keyboard, reduced-motion, SR labels on diagrams).
- **Responsive:** flawless 360 → 1440+. Touch targets ≥ 44px.
- **Iterability:** token-first so Claude Design retunes globally from `tokens.css`.
- **Deploy:** static, zero build, Cloudflare Pages.

**Constraints**
- Tailwind via CDN + inline config (matches `landing.html`; no bundler for v1).
- Fable one-shot build; no real screenshots/customer assets yet.
- Must not touch the app (`src/**`).

---

## 2. System architecture — five layers

The website is a system. Design it as layers, not pages; pages are just compositions of the layers below them. This is what makes it iterable.

```
┌─ L5  PAGES ───────────────────────────────────────────────┐
│   index · site · audit · sponsor · security               │
│   = ordered compositions of L4 sections                   │
├─ L4  SECTIONS / PATTERNS ─────────────────────────────────┤
│   Hero · SplitFeature · MockupShowcase · Stepper ·        │
│   RoleLensGrid · BoundaryTable · Lifecycle · StatBand ·   │
│   CTABand · DemoForm   (each: <section data-section>)     │
├─ L3  COMPONENTS ──────────────────────────────────────────┤
│   Button · Card · MockupFrame · CitationChip · Badge ·    │
│   StagePill · ConfidenceDot · Nav · Footer · Field        │
├─ L2  PRIMITIVES ──────────────────────────────────────────┤
│   Container · Grid · Stack · Eyebrow · Heading · Prose     │
├─ L1  TOKENS  (tokens.css — single source of truth) ───────┤
│   color · type scale · space · radius · shadow · motion   │
└───────────────────────────────────────────────────────────┘
        Content (content.js) flows in from the side ─────────▶
```

**Data flow = the scroll.** The visitor's journey is the "request path": Hook (hero) → Problem (burden/upstream) → **Proof act 1/2/3** → Trust (boundary/founder/security) → Convert (CTA/form). Each section has exactly one job; if a section doesn't advance that path, cut it.

---

## 3. Foundations (deep-dive)

### 3.1 Layout & grid
- **Container:** `max-w-7xl` (1280px) for full-bleed sections; **`max-w-2xl` (~42rem/672px) for prose** — never run body text wider (measure ≈ 65–75ch).
- **Gutters:** `px-6` (24px) mobile → `px-8` (32px) ≥lg. Symmetric.
- **Section rhythm:** vertical padding is the primary spacing tool. `py-16` (64px) mobile → `py-24` (96px) desktop; hero `pt-32`. Consistent rhythm > per-section fiddling.
- **Grid:** 12-col mental model, expressed with Tailwind `grid`/`flex`. Common splits: 2-col `lg:grid-cols-2 gap-12` (SplitFeature), 3-col `md:grid-cols-3 gap-6` (cards/stats).
- **Alignment:** left-align narrative prose (editorial, scannable); center only heroes and section intros.

### 3.2 Spacing scale (8-pt)
Restrained set — `4 · 8 · 12 · 16 · 24 · 32 · 48 · 64 · 96` (Tailwind `1/2/3/4/6/8/12/16/24`). Two rules: (1) space between related items uses the *small* end (8–16); space between sections uses the *large* end (64–96). (2) Don't invent one-off values — reach for the nearest scale step.

### 3.3 Type scale (Inter, modular ~1.25)
| Role | Size (mobile → desktop) | Weight | Tracking / leading | Color token |
|---|---|---|---|---|
| Display / H1 | `text-4xl → text-6xl` (36→60) | 800 | `tracking-tight` `leading-[1.08]` | `--fg-heading` (ink) |
| H2 (section) | `text-3xl → text-4xl` (30→36) | 700 | `tracking-tight` | `--fg-heading` |
| H3 (sub) | `text-xl → text-2xl` (20→24) | 700 | normal | `--fg-heading` |
| Lead / sub | `text-lg → text-xl` (18→20) | 400 | `leading-relaxed` | `--fg-sub` |
| Body | `text-base` (16) | 400 | `leading-relaxed` | `--fg-body` |
| Small | `text-sm` (14) | 400–500 | — | `--fg-sub` |
| Eyebrow / label | `text-xs` (12) | 600 | `uppercase tracking-widest` | `--fg-muted` / gradient |

**Rules:** one display per page. Gradient text (`.grad-text`) only on **large** display/accent words (contrast is unreliable at body size — see §7). Body stays solid ink/slate.

### 3.4 Color system (semantic layer over the brand palette)
Brand ramps live in `tokens.css`; **components consume *semantic* tokens**, not raw ramps — this is what lets you re-skin without hunting hex.

| Semantic token | Value | Use |
|---|---|---|
| `--fg-heading` | `ink #0f2942` | headings |
| `--fg-body` | `slate-600 #334155` | body |
| `--fg-sub` | `slate-500` | secondary |
| `--fg-muted` | `slate-400` | eyebrows, captions |
| `--surface` | `#ffffff` | base editorial |
| `--surface-2` | `#f7fafc` | alternating light band |
| `--surface-dark` | `navy-800 #0d1528` | product mockups |
| `--border-hairline` | `#e8eef3` | card/edge |
| `--accent` | brand gradient | CTAs, accent words, focus |
| **State** | | |
| confidence high / med / low | green / amber / slate | `ConfidenceDot`, badges |
| risk critical / high / moderate / low | red / orange / amber / slate | audit findings |

**Alternation discipline:** `surface` → `surface-2` → `surface` down the page, with `surface-dark` reserved for mockups. Never two dark sections adjacent (kills the dual-surface rhythm).

### 3.5 Elevation (3 steps only)
`--shadow-card` (resting hairline lift) → `--shadow-card-hover` (interactive lift + brand-tinted) → `--shadow-screenshot` (deep, for dark mockups). More than three levels reads as noise. Borders do most of the separation work in the light editorial zone; shadow is for *interactive* or *floating* things.

### 3.6 Radius
`6px` chips/pills · `10–12px` buttons/inputs · `16px` (`--radius-card`) cards · `20–24px` mockup frames. One family, scaling with element size.

### 3.7 Iconography
Single stroke-based set (1.8px stroke, 24px, `currentColor`) — inline SVG, no icon font/CDN. Feather/Lucide geometry. Icons *support* labels; never icon-only for meaning (a11y). Keep the set small (~16 glyphs).

---

## 4. Component library

The inventory Fable builds once and reuses. Each is a documented class/partial in `DESIGN.md`.

| Component | Spec / notes |
|---|---|
| **Button** | `.btn-primary` (gradient, shadow, 1px lift on hover) · `.btn-ghost` (bordered). One primary per view. ≥44px tap height. |
| **Card** | `.card` — white, hairline, `--shadow-card`, hover lift + brand-tint border. The workhorse of light surfaces. |
| **MockupFrame** | `.screenshot` — dark navy shell + fake browser chrome (3 dots + mono label + status pills). Wraps *every* product visual so mockups feel like one product. |
| **CitationChip** ★ | `§ section · page` in mono, muted, file-icon. **Signature primitive** — recurs on every requirement/fact. |
| **ProvenanceLine** ★ | "PIQC drafted · N requirements · 0 gaps detected" — teal accent word + neutral rest. Signs every draft artifact. |
| **ConfidenceDot** | small dot: green/amber/slate = high/med/low. Honest, quiet, consistent everywhere. |
| **Badge** | classification/status pills (`REQUIRED`, `PRIMARY ENDPOINT`, `SAFETY-CRITICAL`, risk levels). Semantic color only. |
| **StagePill** | uppercase micro-cap for the 8-stage audit stepper. |
| **Nav** | fixed, `bg-white/85 backdrop-blur`, logo + anchors + primary CTA; mobile → disclosure menu (not hover). |
| **Footer** | logo + tagline + link columns + compliance line. |
| **Field** | form input/select with teal focus ring; error + success states. |
| **DirectionTag** | small "Platform direction" label — required on every non-live claim. |

★ = the ownable, category-defining primitives. Invest here.

**Section patterns (L4):** `Hero`, `SplitFeature` (prose ↔ mockup, alternating side), `MockupShowcase` (big centered mockup — used for the Act-1 money shot), `Stepper` (audit), `SplitAsk` (question ↔ source card — Act 2), `RoleLensGrid`, `BoundaryTable`, `Lifecycle`, `StatBand`, `CTABand`, `DemoForm`.

---

## 5. Motion system

Motion is **evidence, not decoration** — it shows the protocol→structure transformation, then stops.

- **Tokens:** `--anim-fast 180ms` (hovers) · `--anim-base 220ms` (transitions) · `--anim-slow 400ms` (reveals) · `--anim-hero 5000ms` (hero cycle) · easing `--ease-out cubic-bezier(0.16,1,0.3,1)`.
- **Scroll reveal:** one-time `fade-up` (16px, 500ms) on section entry via IntersectionObserver. Subtle, never on every child, never re-fires.
- **Named hero animations** (`data-anim`, see FABLE-BRIEF §7): `home-flow` (the money shot), `ask-source` (split, answer+citation arrive together), `audit-pipeline`, `sponsor-fanout`, `security-shield`.
- **Two hard rules:** (1) every animation must **read correctly as a still frame** (reduced-motion, OG capture, print) — so build the final state first, animate *to* it. (2) `prefers-reduced-motion: reduce` → jump to final state (handled in `tokens.css`). No parallax, no autoplay video, no infinite background motion.

---

## 6. Responsive strategy

Mobile-first; breakpoints `sm 640 · md 768 · lg 1024 · xl 1280`.

| Pattern | Mobile | ≥ lg |
|---|---|---|
| Nav | logo + menu button (disclosure) | full anchor bar + CTA |
| SplitFeature | stacked, mockup below prose | 2-col, mockup alternates L/R |
| SplitAsk (Ask) | question card **over** source card, stacked | side-by-side |
| Card/stat grids | 1-col (stats 2-col) | 3–4 col |
| Mockups | scale down; wide tables get `overflow-x:auto` inside the frame (page never scrolls horizontally) | full |
| Type | display `text-4xl` | `text-6xl` |
| Section padding | `py-16` | `py-24` |

Test the **money-shot mockup** hardest — it's the most complex object and the most important. Consider a simplified mobile variant rather than shrinking the full thing.

---

## 7. Accessibility (AA, non-negotiable)

- **Contrast:** ink/slate-600 on white passes AA. **Gradient text fails at small sizes** — restrict `.grad-text` to ≥24px display/accent words; everything readable is solid. Dark mockups: keep text ≥ `white/70`.
- **Keyboard:** all interactive elements focusable, logical order, **visible focus ring** (teal, 3px, already in `tokens.css`). Tabs/role-cards operable by keyboard (`role="tab"`/arrow keys or plain buttons) — **no hover-only** reveals.
- **Structure:** one `<h1>`/page, ordered headings, landmarks (`header`/`nav`/`main`/`footer`), **skip-to-content** link.
- **Diagrams/mockups:** decorative → `aria-hidden`; meaningful → concise `aria-label`/`<figcaption>` (e.g., "Illustrative: a screening visit drafted from the protocol with 3 requirements and source citations").
- **Motion & forms:** honor reduced-motion; label every field, associate errors with `aria-describedby`, announce the success state.

---

## 8. Performance & reliability (the "scale" axis for a marketing site)

- **Fonts:** Inter via Google Fonts with `display=swap`; preconnect. (Self-host later to kill the third-party dependency.)
- **Tailwind CDN caveat (explicit trade-off):** great for a zero-build first pass, but it ships the full engine and runs at runtime → a FOUC/JS-cost hit. Acceptable for v1; **§10 upgrade compiles Tailwind to a static CSS file** for production. Keep critical brand CSS in `tokens.css` (real stylesheet) so first paint is correct even before Tailwind hydrates.
- **Images:** none required (mockups are DOM/SVG — a real advantage: crisp, themeable, no image weight). When real screenshots land, `loading="lazy"`, width/height set, `max-w-full`.
- **Budget:** JS minimal (nav toggle, form validate, IntersectionObserver, hero sequencing). No frameworks. Target Lighthouse ≥ 95 across the board.
- **Resilience:** the site must be fully legible with **JS disabled** (animations degrade to final state, content is server-static HTML). Cloudflare Pages handles CDN/caching/TLS.

---

## 9. Trade-offs (made explicit)

| Decision | Chosen | Gave up | Why it's right for v1 |
|---|---|---|---|
| Zero-build static + Tailwind CDN | ✅ | optimized CSS, tree-shake | Fable one-shots it; deploys to Cloudflare instantly; Claude Design previews with `python3 -m http.server`. Upgrade path documented. |
| Multi-page (5 files) | ✅ | shared-partial DRY (nav/footer copy-pasted) | Simple hosting/SEO; partials documented in `DESIGN.md`; port to components later. |
| DOM/SVG mockups | ✅ | photo-real fidelity | Themeable, crisp, zero image weight, editable by Claude Design; swap real screenshots when available. |
| Dark mockups on light site | ✅ | uniform theme | The dual-surface rhythm *is* the design idea; contrast makes the product pop. |
| Animated heroes | ✅ (restrained) | absolute simplicity | Motion demonstrates the transformation — but every anim reads as a still and respects reduced-motion. |
| `content.js` copy object | ✅ | copy-in-markup convenience | Lets copy iterate without touching layout; mirrors a CMS without being one. |

---

## 10. What I'd revisit as it grows

1. **Compile Tailwind → static CSS** (or port to **Vite + React + Tailwind**, matching the app stack): sections→components, `tokens.css`→Tailwind theme, animations→a hooks layer, `content.js`→typed content or a lightweight CMS. Mechanical if section boundaries stay clean now.
2. **Real product screenshots** in device/browser chrome, replacing DOM mockups on the mode pages (keep DOM mockups for the animated heroes).
3. **Token pipeline** — promote `tokens.css` to design tokens consumable by both site and app (one brand source).
4. **Evidence when you have it** — swap placeholder trust bar for real logos/quotes/metrics; add case studies. Until then, *omit*, don't fake.
5. **Conversion instrumentation** — analytics + a real form backend (Formspree/HubSpot/CF Worker); consider A/B on the hero headline once there's traffic.
6. **OG/social + favicon** — produce the real 1200×630 card and brand favicon (currently TODO slots).

---

## 11. Reference archetypes (borrow patterns, don't clone)

You have no clinical competitor to copy — good. Borrow *structure* from the best **editorial-technical** marketing (they sell complex, trust-heavy products to skeptical experts, exactly your situation):

- **Stripe / Vercel** — calm density, generous whitespace, product shown as crisp UI not stock art, restrained motion.
- **Linear** — opinionated dark product surfaces against light narrative; confident single-idea sections.
- **Ramp / Retool** — "here's the actual interface" honesty; proof over adjectives.
- **Instrument/lab & scientific-publishing** aesthetics — mono accents, citation styling, precision — for the traceability motif that's uniquely yours.

Take their *grid discipline, whitespace, and proof-first structure*. Leave their specific brand. The clinical restraint + traceability motif is what makes PIQC's version its own.
