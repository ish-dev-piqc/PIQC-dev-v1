---
name: piqc-review
description: This skill should be used when the user says "/piqc-review", "review my changes", "ready to merge", "check before PR", or asks for a project-specific pre-merge review of the current PIQC branch. Runs scope, ownership, architecture, mock, type, style, PHI, dead-code, overengineering, test, and plan-MD checks.
---

# PIQC Pre-Merge Review

Run these checks on the current branch (`git diff main...HEAD`) in order. For each check: report PASS / FAIL / WARN with specific files and line numbers. Fail loudly — do not soft-pedal. At the end, print a punch list and block PR creation if anything failed.

## Checks

### 1. Scope
- Find the active plan in `plans/<current-dev>/*.md` (status: active).
- Compare changed files (`git diff main...HEAD --name-only`) against the plan's Scope list.
- **Fail** if any changed file is outside Scope or in Out-of-scope.

### 2. Ownership
- Parse `docs/CODEOWNERS.md`.
- For each changed file, resolve the owner.
- **Fail** if a file's owner is not the current dev *and* is not listed under the plan's "Approved-by" section.

### 3. No new mocks
- Grep added lines for `mock`, `fixture`, `MOCK_`, `demo`, `seedData` (case-insensitive).
- Allow if: comment-only, inside `__tests__/`, or behind a `piq-*-v1` localStorage toggle following the [SiteDataContext](../../../src/context/SiteDataContext.tsx) pattern.
- **Fail** any other match.

### 4. Architecture
Grep the diff. Fail on any match:
- **Components must not fetch directly**: `src/components/**/*.{ts,tsx}` importing from `@supabase/supabase-js` or `lib/supabase`
- **Adapters are pure**: files matching `src/lib/*/*Adapter.ts` importing `supabase`
- **Realtime in context only**: `src/components/**/*.{ts,tsx}` containing `.channel(` or `.on('postgres_changes`
- **Mode isolation**:
  - `src/{lib,components/dashboard,types}/audit/**` importing from `sotr` or `site`
  - `src/{lib,components/dashboard,types}/site/**` importing from `audit` or `sotr`
  - `src/{lib,components/dashboard,types}/sotr/**` importing from `audit` or `site`
- **Context isolation**: imports of `SiteDataContext` outside `src/{lib,components,context}/site/**`; same for `AuditDataContext` and any future `SotrDataContext`
- **`Result<T>` in API**: files matching `src/lib/*/*Api.ts` containing `throw new` outside obvious programmer-error guards
- **No `any` in lib**: `src/lib/**/*.ts` containing `: any` or `as any`

### 5. Database / migrations
If `supabase/migrations/` is in the diff:
- **B1 append-only**: each changed migration file must be newer than the merge base. `git log main -- <file>` should be empty. If any older migration was modified, fail.
- **B2 type mirror**: `src/types/<domain>/` should also be in the diff. If not, fail unless the plan MD explicitly states "no type impact".

### 6. Style
- **Tailwind tokens**: grep added lines under `src/**/*.{ts,tsx}` for `text-(gray|slate|zinc|neutral)-\d`. Fail any hit; recommend the `text-fg-*` token.
- **No leftover debug**: grep diff for `console\.(log|debug)` in non-test files. Fail any hit.

### 7. PHI / clinical data
Grep added test or fixture files for patterns that look like real PHI:
- 8+ digit numbers labeled like MRNs
- `DOB:` / `date of birth` near real-looking dates
- Common name patterns combined with real dates of birth
Best-effort flag. On any match, fail and ask the dev to confirm the data is synthetic.

### 8. Dead code
- Run `npx tsc --noEmit` and surface unused-import warnings.
- Grep for new files in `src/` that aren't imported anywhere.
- Check for `vitest.config.ts.timestamp-*.mjs` litter at repo root.

### 9. Overengineering (judgment call — flag, don't auto-fail)
- New abstractions (helper functions, classes, hooks) used by only one caller
- New optional config flags with no consumer
- Try/catch around code that can't throw (internal calls returning `Result<T>`)
- Validation against types already enforced by TypeScript
Surface as WARN; the dev decides.

### 10. Tests
- For each changed `*Api.ts` or `*Adapter.ts`, check that a sibling `__tests__/<name>.test.ts` exists or was updated.
- Fail if a new API/adapter has no test.

### 11. Plan-MD hygiene
- Confirm the active plan MD's Verification section is filled in (not placeholder text).
- If all other checks pass and the dev is opening a PR, offer to flip the plan's frontmatter from `status: active` to `status: in-review`. This signals to other devs' `feature-intake` that the work is locked in for review but not blocking on new development. Update `target_pr: <number>` once the PR exists.
- Remind the dev: after the PR merges, run `/archive-plan` (or use the bundled GitHub Action if installed) to move the plan to `plans/<dev>/_archive/`.

## Output format

```
PIQC Review — branch: <branch>

✅ Scope
✅ Ownership
❌ No new mocks
   - src/lib/audit/mockEvilDemo.ts (line 12): unguarded mock data
✅ Architecture
✅ Database
❌ Style
   - src/components/dashboard/site/Foo.tsx (line 23): text-gray-700 → use text-fg-body
✅ PHI
✅ Dead code
⚠️  Overengineering
   - src/lib/sotr/draftCommentsApi.ts: createDraftCommentValidator used by 1 caller — inline?
⚠️  Tests
   - src/lib/sotr/draftCommentsApi.ts has no sibling __tests__/draftCommentsApi.test.ts
✅ Plan-MD hygiene

2 failures, 2 warnings. Fix before opening PR.
```

## Leveraging existing skills

For the dead-code and overengineering passes, you may invoke the bundled `simplify` skill on the diff. For diff narrative, the bundled `review` skill complements this one — this skill adds the project-specific mechanical gates.
