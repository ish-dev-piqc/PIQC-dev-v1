---
owner: sixonelabs-piqc
feature: archive-kiara-merged-plans
status: merged
started: 2026-07-03
target_pr: 407
merged: 2026-07-03
---

# Archive kiara's 81 merged plan MDs

## Context

Every non-archived plan under `plans/kiara/` (81 files) still carried
`status: active` (77) or `status: in-review` (4) even though all of
their features merged to main between 2026-05-25 (#109) and 2026-06-29
(#387) — all predating the archive-plan-on-merge automation.

Because feature-intake's overlap detection counts every active and
in-review plan across all branches, these produced false-positive scope
conflicts. Concrete case: anyone touching `src/lib/orgs/__tests__/`
collided with `chat-file-uploads.md`, `chat-search.md`,
`organization-chat-general.md`, and `organization-chat-per-protocol.md`,
whose Scopes list those test files.

## What this does

For each of the 81 plans, the merge was verified against origin/main
first-parent history (`git log --first-parent --reverse origin/main --
<plan>` — the merge that carried the plan into main), then the standard
/archive-plan treatment was applied:

- `git mv plans/kiara/<feature>.md plans/kiara/_archive/<feature>.md`
- `status: merged`
- `merged: <date of that merge>`
- `target_pr: #<that PR>`

Frontmatter only — no plan body text was touched (+3/−2 lines per file,
matching the archive-plan-on-merge bot's format).

Known caveat: for a few plans the recorded `target_pr` is the umbrella
or sibling PR whose branch carried the plan file into main, not a
branch named after the feature slug: `organization-chat-general` →
#233 (teamtab-removal), `participant-timeline` → #299
(site-drawer-polish), `chat-mentions-inbox` → #285
(chat-cross-mode-refs-v2), `teamtab-removal` → #231
(organization-team-unified), and the three K1 batch squashes #109,
#113, #115. In each case the feature code is verifiably in main.

## Scope (files allowed)

- plans/kiara/*.md
- plans/kiara/_archive/*.md
- plans/sixonelabs-piqc/archive-kiara-merged-plans.md — this file.

## Out of scope

- Everything under src/, supabase/, .github/ — docs-only change.
- plans/kiara/_archive/logo-placement.md and protocol-collaboration.md
  — already archived, untouched.

## Architecture layers touched

None — no migration, RPC, adapter, context, component, or test.

## Mock data plan

None.

## Approved-by

Kiara (@ki-dev-piqc) — `plans/kiara/` is her folder; her review is
requested on the PR per the CLAUDE.md ownership convention.

## Verification

- `plans/kiara/` contains only `.gitkeep` + `_archive/` after the move.
- All 81 archived files carry `status: merged`, a `merged:` date, and a
  filled `target_pr`.
- `git diff --stat` shows 81 renames, +3/−2 frontmatter lines each,
  zero body-text changes.
- Spot-check: the four chat plans' shipped code exists in main
  (`src/lib/orgs/chatSearchAdapter.ts` + test, `ChatSearchPanel.tsx`,
  `chatAttachmentsAdapter.ts`, `orgMessagesAdapter.ts`,
  `protocolMessagesAdapter.ts`).
- No live (non-archive) unmerged branch carries divergent copies of
  these plan files, and kiara has no open feature branch.
