---
name: scope-check
description: This skill should be used when Claude is about to edit a file and needs to verify it's in the active feature's scope, or when the user runs /scope-check. Acts as a guard against accidentally editing files outside the current plan MD's declared Scope.
---

# Scope Check

Before any Edit or Write call on this PIQC repo, verify the target file is in the active plan's Scope.

## Steps

1. Find the active plan: the file in `plans/<current-dev>/*.md` (not under `_archive/`) with `status: active` in frontmatter. If there are zero or multiple, ask the user which feature this edit belongs to.

2. Read the plan's **Scope (files allowed)** and **Out of scope (files forbidden)** sections.

3. Compare the file path you're about to edit:
   - **In Scope** → proceed silently.
   - **In Out of scope** → stop. Print: `Blocked: <path> is marked out-of-scope in plans/<dev>/<feature>.md. Either edit the plan to add it (and notify the codeowner) or hand this off.`
   - **In neither (not mentioned)** → stop. Print: `Pause: <path> is not in the active plan's Scope. Owner per CODEOWNERS: <owner>. Options: (a) add to scope and continue, (b) finish current scope first, (c) hand off.`

4. Wait for user direction before retrying the edit.

## When to skip

- The file being edited is `plans/<current-dev>/<active>.md` itself (Claude is allowed to update its own plan during a feature).
- Read-only operations.
