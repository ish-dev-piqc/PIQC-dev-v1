---
owner: sixonelabs-piqc
feature: kb-delete-owner-gate
status: merged
merged: 2026-09-04
started: 2026-09-04
target_pr: #609
---

# Knowledge Base: delete control only on documents you own

## Context

`DocumentList` in src/components/dashboard/KnowledgeBase.tsx lists `documents`
through RLS with no `user_id` filter and renders a delete button on every row.
The only DELETE policy is owner-only ("Users can delete own documents",
20260430130000), so `supabase.from('documents').delete().eq('id', id)` on a row
the caller can read but does not own returns no error and deletes 0 rows; the UI
then removes the row optimistically and it reappears on reload. Until now every
readable row was also owned, so the mismatch was latent. The pending migration
20260912000000_sotr_audit_lead_read.sql (plans/sixonelabs-piqc/sotr-audit-lead-read.md)
adds a `documents` SELECT policy for lead auditors, so a viewer can see the
audited protocol's document without owning it — and its header already promises
the Knowledge Base list shows it "read-only, no delete control". This PR makes
that promise true on the client. No RLS change; the DB was never at risk.

## Scope (files allowed)

- src/components/dashboard/KnowledgeBase.tsx
- src/components/dashboard/__tests__/KnowledgeBase.test.tsx
- plans/sixonelabs-piqc/kb-delete-owner-gate.md

## Out of scope (files forbidden)

- supabase/migrations/** — no RLS change; the owner-only DELETE policy is the guard
- src/components/dashboard/DashboardChat.tsx — untouched
- src/context/AuthContext.tsx — consumed via `useAuth()` only (2-reviewer gate)
- `UploadForm` inside KnowledgeBase.tsx and its callers (ProtocolUploadModal, ProtocolOnboarding)
- src/lib/audit/auditCreationApi.ts — `listAuditorProtocolLibrary` stays owner-scoped by design

## Architecture layers touched

- [ ] migration (`supabase/migrations/`)
- [ ] RPC (`supabase/functions/` or `.sql`)
- [ ] adapter (`src/lib/*/*Adapter.ts`)
- [ ] context (`src/context/`)
- [x] component (`src/components/`)
- [x] test (`src/**/__tests__/`)

## Mock data plan

none

## Approved-by

- src/components/dashboard/KnowledgeBase.tsx and src/components/dashboard/__tests__/
  have no CODEOWNERS entry (the `dashboard/` root is unowned; only `site/`,
  `audit/`, `visit-execution/`, `orgs/` subfolders are). No approval required.
- KnowledgeBase.tsx is already in CI's `KNOWN_COMPONENT_SUPABASE_DEBT`
  allowlist; widening the existing select is not a new architecture violation.

## Decisions

- Gate is `doc.user_id === user?.id` with `user` from `useAuth()`, mirroring the
  DB predicate `user_id = auth.uid()` exactly. A signed-out or still-loading
  `user` (undefined id) never matches a `string | null` `user_id`, so the
  fail-safe direction is "no delete control".
- Non-owned rows render nothing in the action slot — no "shared" badge. There is
  no house pattern for one, and the auditor already knows why the document is
  there (Audit Mode pinned it).
- The delete button gains `aria-label="Delete <title>"`: it was an icon-only
  button with no accessible name, and the test needs a per-row handle.
- Not building: a "which audit shares this with me" affordance, a server-side
  `count` check on delete, or moving the list fetch into a context. The fetch
  stays where it is (allowlisted debt, tracked separately).

## Verification

Static review only on this machine (no Node): CI's `npm run test` is the first
execution of the new test file. Owner walk on the deployed app after the
lead-read migration is applied:

- [ ] Account A uploads protocol P (Knowledge Base → Add Document). Account B is
      lead auditor of an audit pinned to P. As B, open Site Mode → Knowledge Base:
      P is listed, hovering the row shows the date but no trash control, and the
      row survives a reload.
- [ ] As A, P still shows the trash control on hover; delete → row disappears and
      stays gone after reload.
- [ ] As A with two own documents plus P shared to B: B sees only P (or B's own
      uploads plus P), never A's other documents.
- [ ] Keyboard: as A, Tab to the trash control; screen reader name reads
      "Delete <document title>".
- [ ] `src/components/dashboard/__tests__/KnowledgeBase.test.tsx` green in CI
      (2 cases: delete control present only on the owned row; clicking it removes
      the owned row).
