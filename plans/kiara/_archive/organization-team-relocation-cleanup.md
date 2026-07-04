---
owner: ki-dev-piqc
feature: organization-team-relocation-cleanup
status: merged
merged: 2026-06-01
started: 2026-06-01
target_pr: #216
---

# Cleanup: relocate Team files + archive superseded protocol-collaboration plan

## Context

Two leftover items from the Organization-page sequence:

1. **Team files still live in `src/components/dashboard/site/`.** The Team tab is no longer
   part of Site Mode's tab list — it renders only inside the Organization page. The file
   relocation was deferred from PR 1 due to sandbox `git mv` permission issues at the time;
   we left a comment in OrganizationPage.tsx noting the deferral. Now that we have a clean
   shell run, the move is trivial.
2. **`plans/kiara/protocol-collaboration.md` is functionally dead.** Its per-protocol-chat
   scope is being absorbed into the Organization-page chat sequence (PR 4a general, PR 4b
   per-protocol channels auto-synced from `protocol_members`). Leaving it `status: active`
   would create false overlap signals when other devs run `feature-intake`.

## Design

### File relocation

Move both Site-Mode Team files to the Organization domain:

- `src/components/dashboard/site/TeamTab.tsx` → `src/components/dashboard/organization/team/TeamTab.tsx`
- `src/components/dashboard/site/TeamFormDrawer.tsx` → `src/components/dashboard/organization/team/TeamFormDrawer.tsx`

Relative imports inside the moved files go from `../../../context/*` / `../../../lib/site/*`
to `../../../../context/*` / `../../../../lib/site/*` (one extra hop because the new directory
is one level deeper). The same-directory import for `./TeamFormDrawer` from TeamTab is
unchanged.

Importers of `TeamTab`:
- `src/components/dashboard/organization/OrganizationPage.tsx`: `../site/TeamTab` → `./team/TeamTab`
- `src/components/dashboard/Dashboard.tsx`: `./site/TeamTab` → `./organization/team/TeamTab`

No behavior change. Site Mode's `useSiteData` + `useProtocol` are still the data sources;
the file just lives in a directory that reflects its actual home.

### Plan archival

`plans/kiara/protocol-collaboration.md` moves to `plans/kiara/_archive/protocol-collaboration.md`
with the frontmatter changing to `status: superseded` and a `superseded_by:` field pointing at
the new chat-sequence plans. A short header banner inside the file explains the reason so
anyone digging into the archive understands what happened. This matches the plan-MD lifecycle
in CLAUDE.md (manual archival here because the original plan never merged via a PR — only the
auto-archive workflow handles merged plans).

## Scope (files allowed)

### Moved (delete + create at new path; logical rename)

- `src/components/dashboard/site/TeamTab.tsx` → `src/components/dashboard/organization/team/TeamTab.tsx`
- `src/components/dashboard/site/TeamFormDrawer.tsx` → `src/components/dashboard/organization/team/TeamFormDrawer.tsx`
- `plans/kiara/protocol-collaboration.md` → `plans/kiara/_archive/protocol-collaboration.md`

### Modified

- `src/components/dashboard/organization/team/TeamTab.tsx` — relative-import depth adjustment.
- `src/components/dashboard/organization/team/TeamFormDrawer.tsx` — relative-import depth adjustment.
- `src/components/dashboard/organization/OrganizationPage.tsx` — import path update + remove the
  now-stale "files still live in dashboard/site/ for now" comment.
- `src/components/dashboard/Dashboard.tsx` — import path update.
- `plans/kiara/_archive/protocol-collaboration.md` — `status: superseded` + `superseded_by:`
  + header banner explaining the absorption.
- `plans/kiara/organization-team-relocation-cleanup.md` — this file.

### Out of scope (forbidden)

- Behavior changes to TeamTab or TeamFormDrawer. Pure relocation.
- `src/lib/site/**` — data layer stays in Site Mode lib for now. A deeper refactor of
  `site_team_members` types and `siteApi.fetchTeamMembers` to live under `src/lib/org/team/`
  is a separate, larger PR that's not on the current path.
- `supabase/migrations/**` — no DB change.
- Anything related to the chat sequence — that starts in PR 4a.

## Architecture layers touched

- [ ] migration
- [ ] RPC
- [ ] adapter
- [ ] context
- [x] component (file relocation + import path updates)
- [ ] test

## Mock data plan

None.

## Approved-by

Self-only. `src/components/dashboard/Dashboard.tsx` is shared dashboard chrome but the change
is a single-line import path swap; no behavior or interface change. `src/components/dashboard/site/`
and `src/components/dashboard/organization/` are both under Kiara's domain per CODEOWNERS.

## Verification

- `npx tsc --noEmit --skipLibCheck -p tsconfig.app.json` → 0 errors
- `npx vitest run` → existing tests pass
- `grep -r "dashboard/site/TeamTab" src/` → no matches (no leftover stale imports)
- `grep -r "dashboard/site/TeamFormDrawer" src/` → no matches
- Manual: Organization page → Team tab still renders the delegation log identically (PI badges,
  cert callouts, search, role filter, add/edit/remove all work)
