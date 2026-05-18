# PIQC-dev-v1 — Working Agreement

PIQC is an AI-powered protocol-intelligence platform for clinical trials, with three product surfaces: **Site Mode** (calendar / visits / participants), **Audit Mode** (8-stage vendor audit workflow), and **SOTR** (Source-of-Truth Reviewer for parsed protocols). Stack: React 18 + Vite + TypeScript (strict) + Supabase + Tailwind. Four active contributors working in parallel — this file is the contract that keeps us on the same page.

## 5 non-negotiables

1. **No new mocks.** The only allowed mock shape is a localStorage toggle that defaults to off — see the `piq-site-mock-calendar-v1` pattern in [src/context/SiteDataContext.tsx](src/context/SiteDataContext.tsx). New features get real Supabase data or nothing.
2. **Stay in scope.** Before editing a file, confirm it's in your active `plans/<you>/<feature>.md` Scope. If it isn't, stop and either expand the plan (notify the codeowner) or hand off.
3. **Follow the data flow.** Migration → RPC → adapter (pure mapper) → context (cache + realtime) → component (consumes hook). Never fetch in components. Never put SQL in adapters. API layers return `Result<T> = { ok: true, data } | { ok: false, error }` — [src/lib/site/siteApi.ts](src/lib/site/siteApi.ts) is the canonical shape.
4. **Delete what you don't use.** Unused imports, unreferenced files, commented-out blocks, leftover `console.log`. If you removed the caller, remove the function too.
5. **Don't overengineer.** No abstractions for a single caller. No validation at internal boundaries. No backwards-compat shims when you can change the code.

## How to work with Claude

You don't memorize slash commands. Talk normally.

- When you say "let's build X" / "add a Y" / "wire up Z" — Claude auto-runs `feature-intake`: figures out which files it'll touch, looks up codeowners, scans every unmerged branch's `plans/` for overlapping active work, and posts a summary. Confirm and Claude writes `plans/<you>/<feature>.md`, creates a feature branch, and pushes the plan so other devs can see it. You never fill in a template.
- During edits, the `scope-check` PreToolUse hook (wired in [.claude/settings.json](.claude/settings.json), runs [scripts/scope-check.sh](scripts/scope-check.sh)) blocks any Edit/Write to a file outside the active plan's Scope. If your git name doesn't substring-match a `plans/<folder>/` name, set `PIQC_DEV_FOLDER=<folder>` in your shell.
- Before opening a PR, run `/piqc-review` for fast local feedback. The same checks run on the server via [.github/workflows/piqc-discipline.yml](.github/workflows/piqc-discipline.yml) on every PR — that's the real gate.
- After your PR merges, [.github/workflows/archive-plan-on-merge.yml](.github/workflows/archive-plan-on-merge.yml) automatically opens a small followup PR moving your plan MD to `_archive/`. Squash-merge it (or enable repo auto-merge so it merges itself). No manual `/archive-plan` needed.

## Ownership

Source of truth: [.github/CODEOWNERS](.github/CODEOWNERS). Summary:

| Area | Owner |
|---|---|
| `src/lib/sotr/`, `src/components/dashboard/sotr/`, `src/types/sotr/` | Ishika |
| `src/lib/site/`, `src/components/dashboard/site/` | Kiara |
| `src/lib/audit/`, `src/components/dashboard/audit/`, `src/types/audit/` | Karl |
| `supabase/`, `src/lib/supabase.ts` | Roger |
| Shared infra (`src/context/`, `src/components/auth/`, `src/components/billing/`, `src/lib/entitlements.ts`, root `plan.md`) | 2 reviewers required |

Touching a file you don't own is allowed but requires an explicit `Approved-by:` line in your plan MD and a review-tag on the PR.

## Per-dev plan MDs — scope isolation

Every feature gets a plan MD at `plans/<your-name>/<feature-slug>.md`, authored by Claude during `feature-intake`. The plan declares:

- **Scope** — explicit list of files/globs this feature may touch
- **Out of scope** — files this feature must not touch
- **Architecture layers touched** — which of `{migration, RPC, adapter, context, component, test}` are in play
- **Mock data plan** — almost always "none"
- **Approved-by** — codeowners whose files appear in Scope but who aren't you
- **Verification** — end-to-end test steps (filled in before review)

### How cross-dev scope visibility works

`feature-intake` doesn't just read plan MDs from your local working tree — it `git fetch --all`'s and scans every unmerged branch's `plans/` folder for active/in-review plans. **That means: as soon as you confirm the intake, Claude commits and pushes your plan MD to a fresh feature branch.** That push is what lets other devs' Claude detect overlap with your Scope. If you never push, no one sees your plan.

### Plan-MD lifecycle

1. `status: active` — fresh from `feature-intake`. Counts toward overlap detection.
2. `status: in-review` — flipped by `piqc-review` when you're opening a PR. Still counts toward overlap detection; signals "scope is locked, waiting on review."
3. After merge — run `/archive-plan` to move the file to `plans/<your-name>/_archive/<feature>.md` and set `status: merged`. No longer counted by overlap detection. Kept as a forensic log of who touched what.

## Architecture rules (mechanically checked by `piqc-review`)

- **Mode isolation.** Site Mode, Audit Mode, and SOTR never import from each other. Shared logic lives in `src/lib/` (non-mode), `src/context/`, or non-dashboard `src/components/`.
- **Context isolation.** Each mode owns its context (`SiteDataContext`, `AuditDataContext`, etc.). Other modes don't import it.
- **No fetches in components.** Components consume hooks; they don't import `@supabase/supabase-js` or `src/lib/supabase` directly.
- **Adapters are pure.** Files matching `src/lib/*/*Adapter.ts` don't import `supabase`.
- **Realtime in context only.** `.channel(` and `.on('postgres_changes'` belong in `src/context/`, never in `src/components/`.
- **`Result<T>` in API layers.** `src/lib/*/*Api.ts` returns `Result<T>` — no `throw` outside programmer-error guards.
- **Migrations are append-only.** Never edit a merged migration; create a new one.
- **DB schema change → TS type mirror.** If `supabase/migrations/*.sql` is in your diff, `src/types/<domain>/` should be too (or note "no type impact" in the plan).
- **No `any` in `src/lib/**`.** `: any` and `as any` are not allowed in API / adapter layers.
- **Semantic Tailwind tokens.** Use `text-fg-heading`, `text-fg-body`, `text-fg-sub`, `text-fg-muted`, `text-fg-label`. Never raw `text-gray-*` / `text-slate-*` / `text-zinc-*` / `text-neutral-*`.
- **PHI / participant data.** Never commit real participant data, real protocol PDFs, MRNs, DOBs, or anything resembling PHI. Test fixtures use the seeded demo set only.

## Canonical reference implementations

When in doubt, copy the pattern from:

- Pure adapter with edge-case handling — [src/lib/sotr/sourceEvidenceAdapter.ts](src/lib/sotr/sourceEvidenceAdapter.ts)
- Context cache + realtime + mock toggle — [src/context/SiteDataContext.tsx](src/context/SiteDataContext.tsx)
- `Result<T>` + RPC error extraction — [src/lib/audit/auditApi.ts](src/lib/audit/auditApi.ts)
- Drawer pattern (`useOverlay` + `useSwipeDismiss`) — [src/components/dashboard/sotr/SourceTruthDrawer.tsx](src/components/dashboard/sotr/SourceTruthDrawer.tsx)
