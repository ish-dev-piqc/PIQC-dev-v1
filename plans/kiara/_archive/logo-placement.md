---
owner: kiara
feature: logo-placement
status: merged
merged: 2026-05-29
started: 2026-05-28
target_pr: #171
---

# Logo placement + audit-mode teal recolor + CSS-variable mode theming

## Context

Two related visual-identity fixes bundled into one PR on top of the
brand palette overhaul that landed in the previous PR:

### Part 1 — Logo placement

The PIQClinical logo files (`PIQC_Logo.png` and `PIQClinical_Logo.png`)
exist in the repo but are **not used anywhere** in the rendered UI. The
Navbar currently shows a generic Lucide `Activity` icon inside a blue
square next to the text "PIQClinical", and the favicon is still
Vite's default `/vite.svg`.

Additionally, the Navbar's text-color split contradicts the actual
logo design:

- **Navbar today:** `PIQ` (dark) + `Clinical` (`#74B4DC` light blue).
- **Logo actually shows:** `PIQC` (saturated blue) + `linical` (dark
  near-black).

### Part 2 — Audit-mode teal recolor

The brand palette overhaul defined two anchor hues: blue for Site Mode,
teal for Audit Mode. The mechanical hex-literal sweep migrated every
component to the new palette but kept each component's existing hue
(everything that was blue stayed blue). Audit Mode components are
therefore still rendering with the brand blue (`#017BC8`, `#1595D1`,
etc.) when they should be rendering with the brand teal (`#02BBB8`,
`#06BFAD`, etc.).

This PR completes the mode-anchor work by remapping audit-mode color
literals from the new blue scale to the new teal scale, scoped to
`src/components/dashboard/audit/**` only. Site Mode and SOTR components
are not touched.

This PR fixes both issues:

1. **Favicon** (`index.html`) — replace the default Vite SVG with
   `PIQC_Logo.png` (mark only). Single most-visible logo spot since
   every browser tab shows it.
2. **Navbar top-left** (`src/components/Navbar.tsx`) — replace the
   Lucide `Activity` icon with `PIQC_Logo.png` (the mark), and fix the
   "PIQC + linical" split + color assignment.
3. **Login** (`src/components/auth/Login.tsx`) — add
   `PIQClinical_Logo.png` (wordmark version) centered above the form.
4. **ForgotPassword** (`src/components/auth/ForgotPassword.tsx`) — same.
5. **ProfileCompletion** (`src/components/auth/ProfileCompletion.tsx`)
   — same.
6. **Footer** (`src/components/Footer.tsx`) — add `PIQClinical_Logo.png`
   near the copyright.

The logo PNG files are moved from `src/public/assets/` to `public/`
at the project root, because:

- Vite serves files in `/public/` as static assets at the root URL path.
- The favicon link in `index.html` has to be a static URL path (not
  a module import), so the file has to live in `/public/`.
- Same-folder consistency for both logo files makes the React code
  simpler (`<img src="/PIQC_Logo.png" />` everywhere).

## Scope (files allowed)

### Logo placement

- `index.html` — favicon link update
- `src/components/Navbar.tsx` — icon swap + text color fix
- `src/components/auth/Login.tsx` — add logo
- `src/components/auth/ForgotPassword.tsx` — add logo
- `src/components/auth/ProfileCompletion.tsx` — add logo
- `src/components/Footer.tsx` — add logo
- `public/PIQC_Logo.png` (new — moved from src/public/assets/)
- `public/PIQClinical_Logo.png` (new — moved from src/public/assets/)
- `src/public/assets/PIQC_Logo.png` (deleted — moved out)
- `src/public/assets/PIQClinical_Logo.png` (deleted — moved out)

### Audit-mode teal recolor (interim)

- `src/components/dashboard/audit/**/*.{ts,tsx}` — all audit-mode
  components and sub-stages. Mechanical recolor from new-blue to
  new-teal scale via `scripts/recolor-audit-to-teal.sh`.
- `scripts/recolor-audit-to-teal.sh` — the recolor script itself.

### CSS-variable mode theming (the architectural piece)

Treats Site Mode and Audit Mode as separately-sellable products with
distinct visual identities. The mode anchor color (blue for site,
teal for audit) is held in CSS variables that switch based on a
`mode-{mode}` class on App's root div. Components reference `brand-N`
Tailwind tokens that resolve to the active mode's color, so flipping
modes flips every brand-colored surface automatically.

- `src/index.css` — define `--brand-50` through `--brand-950` RGB
  variables. Default to blue scale. Override per mode class:
  `.mode-audit { --brand-N: <teal-N rgb> }`. SOTR keeps the default
  blue until SOTR's anchor decision lands.
- `tailwind.config.js` — add a `brand` color scale that consumes the
  CSS variables via `rgb(var(--brand-N) / <alpha-value>)` so Tailwind
  opacity modifiers (`bg-brand-600/50`) work.
- `src/App.tsx` — read `useMode()` and put `mode-{mode}` class on
  the outermost div so the variable scope covers Navbar, Dashboard,
  and everything inside.
- `src/**/*.{ts,tsx}` — mechanical sweep replacing both blue and
  teal hex literals (the bracketed `[#...]` Tailwind syntax and the
  decomposed rgb() / rgba() forms) with `brand-N` Tailwind classes or
  `rgb(var(--brand-N) / X)` rgba equivalents. Touches shared and
  mode-specific components alike — both end up reading their color
  from the mode-aware variables, which makes the audit-only recolor
  redundant (audit components rendered in audit mode resolve to teal
  via the variables, not by having teal hex baked in). The interim
  audit recolor commit is left in history for forensic clarity.
- `scripts/sweep-to-brand-tokens.sh` — the migration script.
- Excluded from sweep: `src/lib/site/protocolColors.ts` (protocol
  palette stays separate), slate / neutral / semantic colors (they
  aren't brand-mode-sensitive).

### Plan

- `plans/kiara/logo-placement.md`

## Out of scope (files forbidden)

- `tailwind.config.js`, `src/index.css` — palette definitions are
  already set; this PR consumes them, doesn't change them.
- `src/stripe-config.ts`, `supabase/**` — unrelated.
- `src/components/dashboard/site/**` — Site Mode keeps the brand blue.
- `src/components/sotr/**` — SOTR mode color anchor decision is still
  TBD; this PR doesn't touch SOTR.
- Any other component outside Navbar / the three auth screens / Footer
  for the logo portion, and outside `audit/` for the teal portion.
- OG / Twitter share image (`<meta property="og:image">`) — currently
  uses a microlink screenshot service; replacing with a branded share
  image is a separate follow-up.
- `src/lib/site/protocolColors.ts` — intentionally still untouched.

## Architecture layers touched

- [ ] migration (`supabase/migrations/`)
- [ ] RPC (`supabase/functions/` or `.sql`)
- [ ] adapter (`src/lib/*/*Adapter.ts`)
- [ ] context (`src/context/`)
- [x] component (`src/components/`) — Navbar, Login, ForgotPassword,
  ProfileCompletion, Footer
- [ ] test (`src/**/__tests__/`)
- [x] static assets — logo PNGs relocated; favicon updated

No logic, hook, or state changes. Pure visual + asset placement.

## Mock data plan

None.

## Approved-by

Public-facing branding surface (auth screens, Navbar) plus index.html.
Per CLAUDE.md, requesting 2 reviewers.

- ishika@piqclinical.com — reviewer (design continuity, branding)
- karl@piqclinical.com — reviewer (shared-infra second pair of eyes)

## Verification

- [ ] `npm run build` passes.
- [ ] Browser tab shows the PIQC mark as favicon (not the Vite SVG).
- [ ] Navbar top-left shows the PIQC mark + "PIQC" in blue + "linical"
  in dark text — matches the actual logo design.
- [ ] Hover state on the Navbar logo button still has a subtle
  feedback (opacity, scale, or similar).
- [ ] Login, ForgotPassword, ProfileCompletion all show the
  PIQClinical wordmark logo centered above their forms.
- [ ] Footer shows the PIQClinical wordmark logo near the copyright.
- [ ] Dark mode and light mode both render correctly (logo PNG should
  have transparent background so it works on both).
- [ ] `git status` shows the file move: `public/PIQC_Logo.png` and
  `public/PIQClinical_Logo.png` exist; `src/public/assets/` is gone.
