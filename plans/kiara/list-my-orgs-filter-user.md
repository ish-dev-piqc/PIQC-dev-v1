---
owner: ki-dev-piqc
feature: list-my-orgs-filter-user
status: active
started: 2026-05-30
target_pr:
---

# `listMyOrgs` — filter to current user's membership rows

## Context

The OrgSwitcher dropdown was showing the same org (PIQC) three times even though there's only one PIQC row in the `orgs` table. Diagnosed via the browser Network tab: the `org_members` SELECT was returning three rows — one per member of PIQC (Ishika, kiara2, Kiara LaRocca) — each joining back to the same PIQC org row.

Root cause: `listMyOrgs` queried `org_members` without filtering to the current user. RLS on `org_members` permits every member of an org to read the full roster (needed for in-org member-list queries elsewhere), so an unfiltered SELECT returns one row per total member, each with the same joined org. The dropdown then renders one entry per row → duplicates.

Fix: `.eq('user_id', user.id)` on the query. One-line change.

## Scope (files allowed)

- `src/lib/orgs/orgsApi.ts` — add `auth.getUser()` + `.eq('user_id', user.id)` filter to `listMyOrgs`. Updated header comment explains why.
- `plans/kiara/list-my-orgs-filter-user.md` — this file.

## Out of scope (files forbidden)

- `supabase/migrations/**` — no DB change. The RLS policy is correct as-is; only the application query was too broad.
- Anything else in `src/`.

## Architecture layers touched

- [ ] migration
- [ ] RPC
- [ ] adapter
- [ ] context
- [ ] component
- [ ] test
- [x] util (orgsApi.ts)

## Mock data plan

None.

## Approved-by

No cross-domain edits — `src/lib/orgs/orgsApi.ts` is owned by `@ki-dev-piqc`.

## Verification

- `npx tsc --noEmit --skipLibCheck -p tsconfig.app.json` → 0 errors
- `npx vitest run src/lib/orgs/__tests__/` → all pass (existing tests assert the exported surface; unchanged)
- Manual: as a multi-member org admin (e.g. Kiara LaRocca with Ishika and kiara2 in PIQC), open the OrgSwitcher → only one PIQC entry should appear (was three)
- For a user genuinely in multiple orgs: still shows one entry per org
