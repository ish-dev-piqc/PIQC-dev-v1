---
owner: ish-dev-piqc
feature: discipline-workflow-hardening
status: in-review
started: 2026-05-18
target_pr:
---

# Discipline workflow: shell-injection fix + `: any` regex prose-match fix

## Context

Two bugs in `piqc-discipline.yml` surfaced when PR #85's CI re-ran after #87:

### Bug 1 — Shell injection in plan-MD-reference check (security)

The "Plan MD referenced in PR body" step inlines `${{ github.event.pull_request.body }}` directly into the bash script:

```bash
pr_body="${{ github.event.pull_request.body }}"
```

GitHub Actions substitutes the PR body as literal text *before* bash parses the script. When the body contains markdown backticks (which is normal — code identifiers, file names, etc), bash interprets them as command substitutions and runs whatever's inside. Observed failure on PR #85:

```
supabase: command not found
Protocol: command not found
UPDATE: command not found
syntax error near unexpected token `protocol'
```

These were fragments of my PR body being executed as shell commands.

The sibling "DB schema → type mirror" check at line 108-110 uses the correct `env: PR_BODY:` pattern. Just this one regressed.

### Bug 2 — `: any` regex matches English prose in comments

The "Forbid `any` types in src/lib" check uses `grep -rnE "(:\s*any\b|\bas\s+any\b)"`. The `:\s*any\b` half also matches English prose like:

```
// Defensive design: any sessionStorage read failure...
```

PR #85 hit this with a benign code comment. The author worked around it by rewording the comment (em-dash + plural), but the regex itself is the bug.

## What the fix does

### Fix 1: env-var pattern for PR-body access (security)

```diff
  - name: Plan MD referenced in PR body
+   env:
+     PR_BODY: ${{ github.event.pull_request.body }}
    run: |
      set -u
-     pr_body="${{ github.event.pull_request.body }}"
-     if ! echo "$pr_body" | grep -qE ...
+     if ! printf '%s' "$PR_BODY" | grep -qE ...
```

`env:` populates the variable safely. The script body has no interpolation, so backticks (or anything else) in the body never reach bash as code. Mirrors the type-mirror check's pattern.

### Fix 2: Skip comment lines in `: any` check

```diff
  hits=$(grep -rnE "(:\s*any\b|\bas\s+any\b)" src/lib --include="*.ts" --include="*.tsx" 2>/dev/null \
         | grep -vE "(/__tests__/|\.test\.)" \
+        | grep -vE ":[0-9]+:\s*(//|\*)" \
         || true)
```

Lines from `grep -rn` are formatted `<path>:<line>:<content>`. Stripping lines whose content starts with `//`, ` * `, or `/* ` (the common comment prefixes) gets rid of the prose false positive without semantic parsing.

## Scope (files allowed)

- `.github/workflows/piqc-discipline.yml`
- `plans/ishika/discipline-workflow-hardening.md`

## Out of scope (files forbidden)

- Any `src/` file. CI-only.
- Audit of every other workflow check — the two fixes here are surgical; other gates already use the env-var pattern correctly.
- Adding GHSA disclosure / advisory entries for the injection — internal repo, low blast radius (only collaborators can open PRs), but the fix itself closes it.

## Architecture layers touched

- [ ] migration
- [ ] RPC
- [ ] adapter
- [ ] context
- [ ] component
- [ ] test
- [x] CI workflow

## Mock data plan

None. No type impact (CI-only change).

## Approved-by

None required. Workflow file isn't in CODEOWNERS.

## Verification

- [ ] Locally: run the new `: any` check with the comment-skip filter against `src/lib/demo/store.ts` containing the original "Defensive design: any sessionStorage" comment → no false positive.
- [ ] Locally: confirm a genuine `: any` or `as any` on a code line still trips the rule.
- [ ] On PR open: CI passes against this branch (no PR-body markup tricks regressing the plan-MD-reference check).
- [ ] After merge: merge main into PR #85's branch; CI re-runs cleanly with no shell-injection chatter and no `: any` false positives.
