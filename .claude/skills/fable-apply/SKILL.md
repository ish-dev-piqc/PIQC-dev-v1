---
name: fable-apply
description: Apply approved findings from a /fable-audit run. Validates the approval record and run identity, edits only the approved allowed_paths on a dedicated branch/worktree, runs each finding's validation plus scope-check and /piqc-review, and returns a reviewable diff. Never commits or pushes without separate explicit instruction.
argument-hint: "<run-id> <finding-id> [finding-id ...]"
disable-model-invocation: true
---

# /fable-apply — gated remediation of confirmed audit findings

The human decision boundary. `/fable-audit` never edits; this skill edits **only** what a validated
approval record authorizes. Record format and validity rules: `apply-contract.md`.

## Preconditions — refuse loudly if any fails

1. `plans/fable/approval-<run-id>.md` exists and parses per `apply-contract.md`.
2. Record's `run_id`, `base_sha`, `head_sha`, `manifest_digest` match the audit report exactly.
3. `git rev-parse HEAD` still equals the record's `head_sha` — **stale head → reject**; re-run
   `/fable-audit` instead of guessing what changed.
4. Every requested finding ID is in `approved_finding_ids` AND was `confirmed` (never `candidate`,
   `refuted`, or `needs-human`).
5. Each finding carries `allowed_paths`, `owner`, and a `reproduction_or_validation` command.
6. No requested path intersects another active worktree's uncommitted files.
7. `git status --porcelain` shows no uncommitted changes intersecting the union of requested
   `allowed_paths` — dirty target files → reject, same as a stale head (a fresh worktree at
   `head_sha` is clean by construction).

## Execution

1. **Worktree discipline (mandatory):** dedicated branch `fable-apply/<run-id>` in a **dedicated
   `git worktree`**. If a worktree cannot be created, stop and report — never share a checkout
   with another mutating agent (the marketing-site run may be live in this repo).
2. **Plan MD:** create `plans/fable/<run-id>-apply.md` (template in `apply-contract.md`) declaring
   Scope = union of approved `allowed_paths`, with `Approved-by:` per owner. **To make the
   `scope-check` hook actually enforce it:** `export PIQC_DEV_FOLDER=fable` in the shell before any
   edit (the hook resolves the plan folder from git user.name, which will NOT match `plans/fable/`),
   and verify the apply plan is the **only** `status: active` file in `plans/fable/` (the hook
   enforces the first active plan it finds) — flip any other to `in-review` or stop.
3. **Batching by owner:** one batch per owner — audit → @karl-dev-piqc, deliverables →
   @fable-dev-piqc, supabase → @rv61. Anything touching `src/lib/entitlements.ts` or
   `src/context/**` (2-reviewer: @ish-dev-piqc @ki-dev-piqc) goes in **its own minimal batch** so
   double-review doesn't drag unrelated fixes.
4. **Edit only `allowed_paths`.** A fix that turns out to need a file outside them → stop, report,
   request a scope exception (`apply-contract.md`); never widen silently.
5. **Validate per finding:** run its `reproduction_or_validation.command` and confirm
   `expected_result`. Then the repo gates that apply: `scripts/scope-check.sh` (hook), `npm run
   typecheck`, `npm run lint`, `npm run test` (via the scratchpad-node workaround — no node on
   PATH), and `/piqc-review` before any PR.
6. **Output:** a reviewable diff (`git diff --stat` + per-finding summary), validation results, and
   which findings were applied / skipped / failed-validation. Report failures plainly.

## Never

- Apply an unapproved, stale, or unconfirmed finding.
- `git add -A` / `git add .` — stage only the specific files edited.
- Touch `website/**`, `.env*`, credentials, or any path outside `allowed_paths`. Never edit a
  merged migration (append-only); a NEW migration is allowed only when explicitly listed in a
  finding's `allowed_paths`.
- Commit, push, or open a PR without a separate explicit instruction after the diff is reviewed.
- Strip product-bearing voice ("PIQC drafted / flagged / found") or provenance/attribution while
  fixing — that voice is the product.
