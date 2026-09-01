---
status: active
owner: sixonelabs-piqc
feature: audit-grounding-read-batching
target_pr: TBD
---

# Audit grounding-read batching — kill the user_profiles N+1, pin the read

PR-5 of the pre-D4 quality-hardening train (quality review 2026-08-31).

## Problem

`fetchWorkspaceEntries` — PR-D4's primary grounding read — issues one
`user_profiles` SELECT per entry (`resolveCreatorName` awaited inside
`flattenEntry`), so an audit with N observations costs N+1 round trips on
every Stage 6/7 mount. `fetchPreAuditDeliverables` has the same disease ×5
(`resolveApprovedByName` per flattener). Both reads are also untested on
their read path (the D1 ledger flagged the duplicate lookups; the
foundation survey flagged the missing tests).

## Fix (code-only; no migrations; deploy-safe)

- `workspaceEntriesApi`: one `user_profiles … in (unique ids)` query per
  fetch; `flattenEntry` becomes pure/sync taking the resolved name; the
  single-row create/update paths use the same batch helper with one id.
  Missing profile still yields '(unknown)'.
- `preAuditApi`: `fetchPreAuditDeliverables` prefetches one name map for
  the ≤5 approved_by ids and threads it through the flatteners (optional
  param — the single-row upsert/approve/prefill paths keep their solo
  resolve, one row = one lookup either way).
- First READ tests for `fetchWorkspaceEntries`: happy flatten, empty,
  error→[] (pins the current contract), one-profiles-query-for-N (pins the
  batching), '(unknown)' fallback. preAuditApi test pins one profiles
  query per bundle fetch.

## Scope

- src/lib/audit/workspaceEntriesApi.ts
- src/lib/audit/preAuditApi.ts
- src/lib/audit/__tests__/workspaceEntriesApi.test.ts
- src/lib/audit/__tests__/preAuditApi.test.ts
- plans/sixonelabs-piqc/audit-grounding-read-batching.md

## Out of scope

- supabase/**, contexts, components, other modes
- Context caching of entries/issues/evidence (ledgered with the
  AuditDataContext realtime story)
- Result-ification of fetchWorkspaceEntries (error→[] contract kept and
  now PINNED as-is; changing it is the opportunistic-Result rule's call at
  a consumer's request, not a rider here)

## Architecture layers touched

API (batching, no shape change), test

## Mock data plan

None. Test mocks in __tests__/ only.

## Approved-by

@karl-dev-piqc (audit lib)

## Verification

- CI: typecheck + vitest green (first execution).
- Tests pin: one user_profiles query for N entries with duplicate creators
  (unique-id set asserted); flatten output identical to before (field-level
  assert); '(unknown)' fallback; error→[]; preAuditApi bundle fetch issues
  exactly one profiles query.
- E2E (user, deployed): Stage 6 conduct list renders identically;
  network tab shows one user_profiles call where it showed N.
