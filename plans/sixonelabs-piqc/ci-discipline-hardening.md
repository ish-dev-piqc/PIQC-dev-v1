---
owner: sixonelabs-piqc
feature: ci-discipline-hardening
status: in-review
started: 2026-09-01
target_pr:
---

# CI discipline hardening — safe half

## Context

Four verified gaps in `.github/workflows/piqc-discipline.yml`, all fixable with zero new failures on today's clean tree: (1) the DB-schema→type-mirror check emits `::warning::` and never exits non-zero, so CLAUDE.md's rule is unenforced; (2) the raw-color rule governs `text-*` only — `bg-gray-800` etc. pass silently; (3) three grep steps scan whole directories with no `--include`, so docs/fixtures quoting a forbidden pattern can produce false reds; (4) the console.log git pathspec `src/**/*.ts{,x}` misses the five top-level `src/*.ts{,x}` files including `App.tsx` and `main.tsx`. The hex-literal detector, migration counter, and lint gate are deliberately deferred until after the theme sweep (they would land red on ~2,600 pre-existing hex literals).

Deliberate rule design: the extended class-family ban covers `gray|zinc|neutral` (foreign palettes) across all utilities but scopes the `slate` ban to `text-*` only — slate is this repo's declared, auditable palette in `tailwind.config.js`, and the upcoming hex→token sweep converts literals *into* `bg-slate-*`.

## Scope (files allowed)

- .github/workflows/piqc-discipline.yml
- plans/sixonelabs-piqc/ci-discipline-hardening.md

## Out of scope (files forbidden)

- .github/workflows/deploy.yml
- .github/workflows/archive-plan-on-merge.yml
- .github/pull_request_template.md
- All of src/**, supabase/**, scripts/**

## Architecture layers touched

- [ ] migration (`supabase/migrations/`)
- [ ] RPC (`supabase/functions/` or `.sql`)
- [ ] adapter (`src/lib/*/*Adapter.ts`)
- [ ] context (`src/context/`)
- [ ] component (`src/components/`)
- [ ] test (`src/**/__tests__/`)

(None — CI workflow only.)

## Mock data plan

none

## Approved-by

- @ish-dev-piqc — `docs/CODEOWNERS.md` has no `/.github/workflows/` row; the nearest owner is the Discipline-package block (CLAUDE.md, CODEOWNERS, PR template, .claude/), so the workflow is treated as Ishika's.

## Verification

All greps were run locally against the clean tree before editing — every change is a no-op today. CI on this PR is the first real execution.

- [ ] This PR's own run of `mechanical-checks` passes (proves no new failures on a clean tree)
- [ ] Type-mirror gate: throwaway PR touching only a migration file → fails; add "no type impact" to body → passes; close throwaway
- [ ] Color rule: scratch `bg-gray-800` on a branch fires the new check; `hover:bg-slate-50` (OrgSwitcher.tsx:31) does not
- [ ] console.log pathspec: scratch `console.log` in src/App.tsx is now caught (was exempt before)
