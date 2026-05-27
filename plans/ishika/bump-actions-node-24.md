---
owner: ish-dev-piqc
feature: bump-actions-node-24
status: in-review
started: 2026-05-26
target_pr:
---

# Bump GitHub Actions to Node 24-compatible major versions

## Context

GitHub Actions surfaced a Node 20 deprecation warning on Sprint 3.5a's CI run (PR #127). Per https://github.blog/changelog/2025-09-19-deprecation-of-node-20-on-github-actions-runners/, Node 20 will be force-bumped to Node 24 on June 2nd, 2026, and removed from runners on September 16th, 2026. All `actions/*` actions still on Node 16/20 need to be bumped to majors that ship with Node 24.

Verified latest stable + Node-24-compatible major for each action via GitHub releases pages.

## Scope (files allowed)

- `.github/workflows/deploy.yml`
- `.github/workflows/piqc-discipline.yml`
- `.github/workflows/archive-plan-on-merge.yml`
- `plans/ishika/bump-actions-node-24.md`

## Out of scope (files forbidden)

- Any `.yml` workflow not listed in Scope
- `.github/pull_request_template.md` — Ishika-owned but not part of this change
- `docs/CODEOWNERS.md` — Ishika-owned but not part of this change
- Anywhere outside `.github/workflows/`

## Architecture layers touched

- [ ] migration
- [ ] RPC
- [ ] adapter
- [ ] context
- [ ] component
- [ ] test

CI workflows only — no app code.

## Bump table

| File | Action | From | To | Reason |
|---|---|---|---|---|
| `deploy.yml` | `actions/checkout` | `@v4` | `@v6` | Node 20 → Node 24 (v5+ runs on Node 24; v6 is current latest) |
| `deploy.yml` | `actions/setup-node` | `@v4` | `@v6` | Node 20 → Node 24 (v5+ runs on Node 24) |
| `deploy.yml` | `actions/upload-pages-artifact` | `@v3` | `@v5` | Latest major, Node 24 cohort |
| `deploy.yml` | `actions/deploy-pages` | `@v4` | `@v5` | Latest major, Node 24 cohort |
| `piqc-discipline.yml` | `actions/checkout` | `@v4` | `@v6` | Same as deploy.yml |
| `archive-plan-on-merge.yml` | `actions/checkout` | `@v4` | `@v6` | Same as deploy.yml |

## Mock data plan

None.

## Approved-by

`.github/workflows/` isn't explicitly listed in `docs/CODEOWNERS.md`, but `.github/pull_request_template.md` is `@ish-dev-piqc` and the rest of `.github/` falls to Ishika by implication. No external Approved-by needed.

## Verification

- [ ] After merge, `piqc-discipline.yml` runs on a follow-up PR with no Node 20 deprecation warning
- [ ] `deploy.yml` builds + deploys main to GitHub Pages successfully (next merge after this lands)
- [ ] `archive-plan-on-merge.yml` opens an archive PR successfully on the next plan-MD merge
- [ ] No new warnings/errors introduced by the version bumps (e.g. removed inputs, breaking changes between majors)
