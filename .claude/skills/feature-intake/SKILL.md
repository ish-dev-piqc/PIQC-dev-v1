---
name: feature-intake
description: This skill should be used automatically when the user asks Claude to build, add, implement, change, refactor, fix, or wire up any feature/component/RPC/migration in this PIQC repo — any request that will result in code changes beyond a trivial typo. Phrases like "let's build X", "add a Y", "implement Z", "wire up W", "change V", "fix bug in U" should trigger this skill before any Edit/Write tool is called. Also runs on the explicit slash command /feature-intake.
---

# Feature Intake

Before touching code on a non-trivial change in PIQC, run this intake. The goal: surface impact to the dev *before* you start editing, so they confirm scope, see overlaps with other devs' active work, and know which codeowners will be involved.

## When to skip

- Pure typo / whitespace / comment-only edits
- Continuing work on a file Claude has already edited this session under an active plan
- Read-only operations (running tests, reading code, answering questions)

Everything else: run the intake.

## Steps

1. **Detect the dev.** Run `git config user.name` and map to a folder under `plans/`. If no clear match, ask once which dev folder to use and remember for the session.

2. **Figure out the impact yourself.** Don't ask the dev to list files. From the user's request + the codebase:
   - Identify the feature's primary domain (site / audit / sotr / shared / supabase).
   - Trace which files will be touched: grep for relevant symbols, read [plan.md](../../../plan.md) for context, check existing adapters and components in the domain.
   - List the architecture layers in play: `{migration, RPC, adapter, context, component, test}`.
   - Note whether mock data is involved (almost always "none").

3. **Look up owners.** Read `.github/CODEOWNERS`. For each impacted file, resolve the owner. Flag files outside the current dev's ownership.

4. **Detect overlap across all devs.** Plan MDs live on feature branches, not just main, so you must scan the whole repo:
   1. `git fetch --all --prune` — pull every dev's latest branches.
   2. List candidate branches: `git for-each-ref --format='%(refname:short)' refs/remotes/origin/ | grep -v 'origin/HEAD\|origin/main'`.
   3. For each branch, list its plan files: `git ls-tree -r <branch> --name-only -- 'plans/*/*.md' | grep -v '/_archive/'`.
   4. For each plan file, read it with `git show <branch>:<path>` and check the frontmatter — count it if `status` is `active` or `in-review`.
   5. Also include any plan files in your local working tree with the same statuses (in case the dev hasn't pushed yet).
   6. For every active/in-review plan you find, read its Scope section. If any file in your impact list appears in another dev's Scope, flag a conflict — name the dev, branch, plan path, and file.

5. **Post a heads-up to the dev**, formatted like this:

   ```
   Here's what I'm about to build:

   Feature: <short name>
   Files I'll touch:
     - <path>   (owner: <handle> — you)
     - <path>   (owner: <handle> — needs <name>'s review)
   Architecture layers: <list>
   Mock data: none
   Overlap with active plans: <none | ⚠️ plans/<dev>/<plan>.md also lists <file>>
   Proceed? (yes / adjust scope / hand off)
   ```

6. **Wait for confirmation.**
   - On "yes": write `plans/<dev>/<feature-slug>.md` from the answers gathered, using `plans/_template.md` as the structure. Set `status: active`, `started: <today YYYY-MM-DD>`. The dev does not fill in anything.
   - On "adjust scope" / rejection: iterate.

7. **Make the plan visible to other devs immediately.** After writing the plan MD:
   1. If the dev is on `main`, create a feature branch: `git checkout -b <dev>/<feature-slug>`.
   2. Stage and commit just the plan MD: `git add plans/<dev>/<feature-slug>.md && git commit -m "Plan: <feature> (scope declared)"`.
   3. Push the branch: `git push -u origin <dev>/<feature-slug>`.
   4. This is what lets other devs' `feature-intake` see your active Scope — they can't detect overlap with a plan that only exists on your laptop.

8. **Then proceed to build.** The plan MD is now the source of truth for `scope-check` and `piqc-review`.

## What goes in the plan MD

You fill in these fields from the intake; the dev does not:

- `owner`: GitHub handle for the dev detected in step 1
- `feature`: short name
- `status: active`
- `started: <YYYY-MM-DD>`
- `target_pr`: leave blank
- **Context** — 2-3 sentences from the user's request
- **Scope (files allowed)** — the impact list from step 2
- **Out of scope (files forbidden)** — explicit list of nearby files in the same domain that this feature will *not* touch
- **Architecture layers touched** — the list from step 2
- **Mock data plan** — "none" by default; if any, name the `piq-*-v1` localStorage key
- **Approved-by** — for any Scope file the dev doesn't own, the codeowner whose approval is implied
- **Verification** — sketch in 2-3 bullets; the dev expands before review
