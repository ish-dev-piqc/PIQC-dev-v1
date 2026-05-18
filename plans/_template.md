---
owner: <github-handle>
feature: <short-name>
status: active
started: <YYYY-MM-DD>
target_pr:
---

# <Feature title>

## Context

<2-3 sentences: why this exists, what it enables>

## Scope (files allowed)

Files this feature is allowed to touch. `piqc-review` blocks if changes go outside this list.

- <path or glob>
- <path or glob>

## Out of scope (files forbidden)

Explicit forbidden files in the same domain. Any file not in Scope is also implicitly out-of-scope.

- <path or glob>

## Architecture layers touched

- [ ] migration (`supabase/migrations/`)
- [ ] RPC (`supabase/functions/` or `.sql`)
- [ ] adapter (`src/lib/*/*Adapter.ts`)
- [ ] context (`src/context/`)
- [ ] component (`src/components/`)
- [ ] test (`src/**/__tests__/`)

## Mock data plan

<"none" almost always. If any: must follow the `piq-*-v1` localStorage toggle pattern from SiteDataContext.tsx. Document the toggle key here.>

## Approved-by

<For any file in Scope owned by another dev per CODEOWNERS, list the owner. Tag them on the PR.>

- @<handle> — for <path>

## Verification

How to test end-to-end. Filled in before opening the PR.

- [ ] <step>
- [ ] <step>
