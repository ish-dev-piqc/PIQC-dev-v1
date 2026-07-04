---
owner: sixonelabs-piqc
feature: coordination-hygiene
status: active
started: 2026-07-03
target_pr:
---

# Coordination hygiene: archive 128 stale plans, fix scope-check + feature-intake noise

## Context

An evidence audit (2026-07-03) found the coordination system running on ~99% noise: 128 of 129 live plan MDs on main describe features already merged (oldest: PR #89, 46 days stale) because archive-plan-on-merge.yml's followup PRs never merge (repo auto-merge is disabled — 45 pending, 47 leftover archive/pr-* branches). Consequences measured: feature-intake's overlap scan reads ~6,500 plan-file instances to find ~6 live plans; scope-check enforces each dev's alphabetically-first stale plan instead of their real one; 63% of Scope bullets are dead globs because trailing annotations break the whole-line match. This PR batch-archives the backlog and hardens the three tools.

## Scope (files allowed)

- plans/
- scripts/scope-check.sh
- .claude/skills/feature-intake/SKILL.md
- .github/workflows/archive-plan-on-merge.yml

## Out of scope (files forbidden)

- src/ (no code changes)
- supabase/ (no schema changes)
- .github/workflows/piqc-discipline.yml (changed on the build-health-gates branch; keep the PRs independent)

## Architecture layers touched

- none (docs + tooling only)

## Mock data plan

none

## Approved-by

- @ish-dev-piqc — .claude/skills/ + workflow edits (discipline package owner); plans mass-move touches every dev's folder — flagging all of @ish-dev-piqc @ki-dev-piqc @karl-dev-piqc @rv61 on the PR. Every archived plan was verified merged (slug→PR cross-check); anyone can `git mv` theirs back if a plan is genuinely still live.

## Verification

- [x] Own-folder archive done (5 plans); Kiara covered by chore/archive-kiara-merged-plans; Ishika via founder one-paste. Live-active check (this file); `grep -rl '^status: active' plans/ --include='*.md' | grep -v _archive` confirms
- [x] scope-check: manual JSON probes (8 cases, all correct) — in-scope file allowed, out-of-scope blocked, annotated bullet (`path (NEW — x)`) now matches, second active plan's scope honored, in-review plan's scope honored
- [x] archive-plan-on-merge.yml edit confined to a literal run block (YAML-safe) (actionlint or yq parse)
