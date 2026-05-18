---
name: archive-plan
description: This skill should be used when the user says "/archive-plan", "archive my plan", "the PR merged", "clean up the plan", or asks to move a merged feature's plan MD into the archive. Moves a plan from plans/<dev>/<feature>.md to plans/<dev>/_archive/<feature>.md so it stops counting toward overlap detection.
---

# Archive Plan

A merged feature's plan MD should not keep blocking other devs' overlap checks. Move it into `_archive/` once the PR is in.

## Steps

1. **Detect the dev.** Run `git config user.name` and map to `plans/<dev>/`.

2. **Find the plan.** If the user names a feature, use that. Otherwise list active/in-review plans in `plans/<dev>/` and ask which one merged. Plans with `status: merged` should also be auto-detected.

3. **Confirm merge.** Read the plan's `target_pr` field. Run `gh pr view <num> --json state` and check that state is `MERGED`. If not, stop and tell the user — don't archive a plan whose PR is still open.

4. **Move the file.**
   - `mkdir -p plans/<dev>/_archive/`
   - `git mv plans/<dev>/<feature>.md plans/<dev>/_archive/<feature>.md`
   - Edit the frontmatter to set `status: merged` and add `merged: <YYYY-MM-DD>`.

5. **Commit and push to main.**
   - Stage: `git add plans/<dev>/_archive/<feature>.md plans/<dev>/<feature>.md`
   - Commit: `git commit -m "Archive plan: <feature>"`
   - If the user is on main, push directly (this is a docs-only change and `plans/` has self-owner per CODEOWNERS). If they're on a different branch, ask whether to switch to main first or open a tiny followup PR.

6. **Report.** Print the new archived path and a one-line confirmation.

## When to skip

- The plan is already under `_archive/`.
- The PR has not been merged (still open or closed-unmerged).
- The dev wants to delete instead of archive — point them at the alternate `/delete-plan` flow if it exists, or just `git rm` the file manually and commit.

## Alternative: GitHub Action (recommended for round 2)

A `.github/workflows/archive-plan-on-merge.yml` Action can do this automatically when a PR with a `plans/` reference in its body is merged. Currently not installed; the user can add it as round 2 once the manual flow is proven.
