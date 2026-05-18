---
owner: ish-dev-piqc
feature: disable-codeowners-auto-assign
status: active
started: 2026-05-18
target_pr:
---

# Disable CODEOWNERS auto-assignment

## Context

Team feedback: per-PR review-request emails are too noisy. GitHub only auto-assigns reviewers when it finds the magic path `.github/CODEOWNERS` (or `/CODEOWNERS` / `docs/CODEOWNERS`); relocating the file to `docs/CODEOWNERS.md` deactivates auto-assignment while preserving the ownership documentation that `feature-intake`, `piqc-review`, and humans rely on. Branch-protection's "1 review required" rule stays in place — PRs still need approval, just no longer from a specific person.

## Scope (files allowed)

- `.github/CODEOWNERS` — removed via `git mv`
- `docs/CODEOWNERS.md` — destination of the move (new path)
- `CLAUDE.md` — line 24 link updated to the new path
- `.claude/skills/feature-intake/SKILL.md` — step 3 path reference updated
- `.claude/skills/piqc-review/SKILL.md` — line 18 path reference updated
- `plans/ishika/disable-codeowners-auto-assign.md` — this plan

## Out of scope (files forbidden)

- Any `src/` file. Process change only; no application code.
- `.github/workflows/*` — no CI change. The mechanical-checks job continues to run unchanged.
- Branch-protection settings on `main` — left intact (1 review still required, just not from a specific person).
- Other `.claude/skills/*/SKILL.md` files that mention CODEOWNERS only conceptually (`scope-check`, `archive-plan`) — those still resolve correctly because they read whichever path is canonical at the time.
- The `Approved-by` rule itself in CLAUDE.md — ownership semantics are unchanged; only the file path moves.

## Architecture layers touched

- [ ] migration (`supabase/migrations/`)
- [ ] RPC (`supabase/functions/` or `.sql`)
- [ ] adapter (`src/lib/*/*Adapter.ts`)
- [ ] context (`src/context/`)
- [ ] component (`src/components/`)
- [ ] test (`src/**/__tests__/`)

Process / docs only — none of the standard layers.

## Mock data plan

none

## Approved-by

None required. Every file in Scope is owned by `@ish-dev-piqc` per the current `.github/CODEOWNERS`.

## Verification

- [ ] After merge, open a test PR that touches a file previously auto-assigned (e.g., `supabase/migrations/`). Confirm GitHub no longer auto-requests a reviewer.
- [ ] `feature-intake` still resolves ownership for that file (reads `docs/CODEOWNERS.md`).
- [ ] `piqc-review` ownership check still works.
- [ ] Branch-protection on `main` still requires 1 approval before merge.
