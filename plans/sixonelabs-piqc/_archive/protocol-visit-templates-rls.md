---
owner: sixonelabs-piqc
feature: RLS on protocol_visit_templates (audit blocker B1)
status: merged
merged: 2026-07-20
started: 2026-07-20
target_pr: #525
---

# protocol_visit_templates RLS — audit blocker B1

## Context

The Fable whole-codebase quality audit (`plans/fable/main-quality-audit-2026-07.md`) found one blocker: `protocol_visit_templates` — the table holding every customer's parsed Schedule of Assessments — was created without row-level security, unlike every sibling visit table. Supabase serves public-schema tables through PostgREST by default, so any authenticated account (any org, including a zero-protocol fresh signup) could read every tenant's extracted SoA or corrupt another tenant's visit schedule. This slice adds the missing RLS in one append-only migration, mirroring `protocol_visit_coverage` exactly.

## Scope (files allowed)

- supabase/migrations/20260729000000_protocol_visit_templates_rls.sql
- plans/sixonelabs-piqc/protocol-visit-templates-rls.md

## Out of scope (files forbidden)

- supabase/migrations/20260507000000_protocol_visit_templates.sql (append-only — never edit a merged migration)
- Any RPC, adapter, context, or component. This is a pure DB-security slice; the read/write paths (service_role ingest + SECURITY DEFINER RPCs) already bypass RLS and need no change.
- src/types/site/ and all TS mirrors — RLS-only migration, no schema/column change.

## Architecture layers touched

- migration (only)

## Mock data plan

none

## Approved-by

- Roger — owns `supabase/` and `src/lib/supabase.ts`. This migration is entirely in his lane; flagged for his review-tag on the PR.

## Verification

- **Fix is present:** `grep -c "ENABLE ROW LEVEL SECURITY" supabase/migrations/20260729000000_protocol_visit_templates_rls.sql` → 1; policy uses `user_can_access_protocol(auth.uid(), protocol_id)` for `FOR ALL TO authenticated`.
- **No legitimate path breaks:** ingest writes as `service_role` (bypasses RLS); `materialize_protocol_visits` and `visit_execution_get_workspace` are `SECURITY DEFINER` (bypass RLS). An authorized authenticated user still passes the policy for their own protocols. Only cross-tenant direct PostgREST access is closed.
- **Timestamp is merge-monotonic:** `20260729000000` sorts after the current max migration on `origin/main` (`20260728000000`) — does not add to the timestamp-inversion class the audit flagged (S3/D1).
- **Post-deploy smoke (dev team):** as a user with no access to protocol X, `GET /rest/v1/protocol_visit_templates?protocol_id=eq.<X>` returns `[]` (was: full rows). As the protocol's owner, the same query still returns rows.

## Deploy step (dev-team-owned)

Migration only — `supabase db push` after merge. No edge-function deploy. No TS type impact.
