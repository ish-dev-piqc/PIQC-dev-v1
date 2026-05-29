---
owner: kiara
feature: brand-palette-overhaul
status: active
started: 2026-05-28
target_pr:
---

# Brand palette overhaul — blue + teal anchors, slate neutrals

## Context

PIQClinical's existing color system grew organically: `tailwind.config.js`
defines an 8-shade `navy` palette that's completely unused, a 4-shade
`blue` palette anchored at `#2563eb` (Tailwind's default blue-600), and
the codebase actually colors itself almost entirely through 1227 inline
hex literals (`bg-[#4a6fa5]`, `text-[#374152]`, etc.) across 79 files.
The "real" PIQC palette today is implicit — the most-used literal is
`#4a6fa5` (a dusty desaturated blue used as the primary button bg,
appearing 433 times).

This overhaul replaces the implicit, dusty-blue-based palette with an
explicit two-anchor system that matches the PIQClinical logo:

- **Primary brand: Blue.** Anchor at `blue-500 = #1595d1` (matches the
  logo ribbon), with `blue-600 = #017BC8` as the default CTA color.
  This is also the **Site Mode** anchor — Site Mode components should
  default to `blue-*` tokens for accents.
- **Secondary brand: Teal.** Anchor at `teal-500 = #06BFAD` (matches
  the logo ribbon's gradient endpoint and the pale wing tint). This
  is the **Audit Mode** anchor — Audit Mode components default to
  `teal-*` tokens.
- **SOTR mode color:** TBD — open question, may default to neutral
  slate or get its own third hue assignment in a follow-up.
- **Neutrals:** explicit `slate` scale replaces the implicit blue-gray
  shades scattered through the codebase. Cool-leaning to complement
  the blue brand.
- **Semantic palette unchanged.** Tailwind's `emerald` (success),
  `amber` (warning), `rose` (error) scales continue to be used directly.
  Existing custom muted-red literals snap to `rose` for consistency.
- **Protocol color palette stays separate.** `src/lib/site/protocolColors.ts`
  remains its own standalone palette for tagging individual protocols.
  Recommendation in a follow-up to retune values so they read as
  visually adjacent to the new brand palette without directly clashing
  (i.e., a "blue" protocol should look like it's part of the same
  design system as the brand blue).

The full audit and mapping table for the 1227 hex literals lives in
this branch's chat history; the mechanical sweep is implemented in
`scripts/migrate-palette.sh`.

## Scope (files allowed)

This is a large surface-area change. The scope is broad on purpose:

- `tailwind.config.js`
- `src/index.css`
- `src/components/**/*.{ts,tsx}` (mechanical hex-literal sweep)
- `src/lib/**/*.{ts,tsx}` (mechanical hex-literal sweep, EXCEPT
  `src/lib/site/protocolColors.ts` which is intentionally preserved)
- `src/App.tsx` (mechanical hex-literal sweep)
- `scripts/migrate-palette.sh` (new — the sweep script itself)
- `plans/kiara/brand-palette-overhaul.md`

## Out of scope (files forbidden)

- `src/lib/site/protocolColors.ts` — intentionally untouched in this PR.
  Protocol color tuning is a follow-up so we don't conflate two
  decisions (brand overhaul vs. protocol palette harmonization).
- `supabase/**` — no backend or schema changes.
- `src/stripe-config.ts` — billing catalog is unaffected.
- `src/types/**` — no type changes.
- `src/hooks/**` — no hook signature or behavior changes.
- `src/context/**` — no context provider changes.

## Architecture layers touched

- [ ] migration (`supabase/migrations/`)
- [ ] RPC (`supabase/functions/` or `.sql`)
- [ ] adapter (`src/lib/*/*Adapter.ts`) — only hex literals get touched,
  no logic changes
- [ ] context (`src/context/`)
- [x] component (`src/components/`) — every visual component is touched
  for hex literal replacement, but no JSX structure or logic changes
- [ ] test (`src/**/__tests__/`)

Visual surface changes only. No logic, no API, no state, no types.

## Mock data plan

None.

## Approved-by

This touches every visual component in the codebase. Per CLAUDE.md
shared-infra rules, requesting 2 reviewers, with Ishika and Karl as
the most context-heavy options (billing UI / shared infra). Roger
not required because no Supabase code is touched.

- ishika@piqclinical.com — reviewer (billing UI, design system continuity)
- karl@piqclinical.com — reviewer (audit-mode color surface review, shared infra)

## Verification

- [ ] `npm run build` passes (TS strict) after all changes.
- [ ] `grep -rE '\[#[0-9a-fA-F]{6}\]' src/ | grep -vE
  '(017BC8|1595D1|026BBE|0477BF|74B4DC|3CACF4|021F40|033E80|06BFAD|02BBB8|2CCCC8|9FD7D6|028E8B|016663|014442|002221|6FC9C7|ECF7F6|DCEDEB|F2F2F2|F8FAFC|E2E8F0|CBD5E1|94A3B8|64748B|475569|334155|1E293B|0F172A|020617|881337|4C0519|FECDD3|FFF1F2|protocolColors)'`
  returns only intentional outliers (decorative gradients, animation
  keyframes, etc.) — no stray old palette values remain in components.
- [ ] Spot-check rendered surfaces in both light and dark mode:
  - Landing page (Hero, ValueProps, FAQ, Pricing, Contact, Footer)
  - Login + ForgotPassword + ProfileCompletion
  - Dashboard overview (each mode)
  - Site Mode tabs: Today, Visits, Participants, Team, Protocol,
    Reports, Ask
  - Audit Mode workspace and each stage
  - SOTR drawer + WorksheetItemsList + ReviewActionBar
  - Settings → Account
  - Settings → Billing (pilot, workspace, no-plan states)
  - PilotCountdownBanner
  - RedirectingToCheckout
  - Chatbot
- [ ] Spot-check status chips (active / expiring / expired) still
  render in emerald / amber / rose families.
- [ ] Confirm `src/lib/site/protocolColors.ts` is unchanged.
- [ ] Confirm the migration script in `scripts/` is documented and
  idempotent (running it twice produces zero diff).
- [ ] Hero glow + card glow tints feel right with the new brand blue
  (the rgba values shift from `(37,99,235)` to `(21,149,209)` —
  same opacity, visibly bluer).

## Out-of-scope follow-ups tracked separately

- Protocol color palette retuning (`src/lib/site/protocolColors.ts`)
- Mode-specific re-skinning (Site Mode → blue accents, Audit Mode →
  teal accents) — this PR retains today's color choices for each mode,
  just expressed in the new palette. Real mode-anchor work comes after.
- Migration from inline hex-literal styling to `text-fg-*` semantic
  tokens — separate, much larger refactor.
- `src/index.css` body styles continue to use direct hex literals for
  the topmost background/text values; that's OK because Tailwind base
  layer styles can't reference Tailwind tokens.
- `tailwind.config.js` `navy` palette is left in place during this PR
  even though it's unused — removal happens in a tiny follow-up PR
  once we've confirmed no build artifacts (Vite cache, etc.) depend
  on it.
