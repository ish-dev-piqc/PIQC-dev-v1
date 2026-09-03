---
owner: rv61
feature: definer-helper-grants
status: merged
merged: 2026-09-03
started: 2026-09-03
target_pr: #603
---

# Revoke anon EXECUTE on the un-gated SECURITY DEFINER helpers

## Context

Follow-up to #601. Nine `SECURITY DEFINER` helper functions carry no `auth.uid()` gate in their own body (their callers are expected to gate) and were never named in a `REVOKE`, so each still holds Postgres's default `EXECUTE` grant to `PUBLIC`. Anyone with the project's public key can call them through PostgREST as `anon`: `user_can_access_protocol`, `user_can_access_deliverable_engine`, `org_has_entitlement`, `protocol_owner_org_id`, `audit_mode_extracted_item_matches_protocol`, `_sotr_build_review_snapshot`, `_sotr_build_sources_json`, plus the orphan-cleanup pair `count_orphan_chat_attachments` / `delete_orphan_chat_attachments` (those two are gated on `current_user_is_any_org_admin()`, so for them the revoke is defense in depth only).

The smallest safe fix is grants-only: revoke from `PUBLIC` and `anon`, grant back to `authenticated` (RLS policies, SECURITY INVOKER RPCs and the frontend call them as that role) and `service_role` (`send-daily-digest` and `dashboard-chat` call `user_can_access_protocol` with the service key; the rest get the same grant for parity with the `hybrid_search` precedent in 20260721000000). No body changes, no `CREATE OR REPLACE`, every applied definition stays untouched.

## Scope (files allowed)

- supabase/migrations/20260911000000_definer_helper_grants.sql (NEW — grants only)
- plans/sixonelabs-piqc/definer-helper-grants.md

## Out of scope (files forbidden)

- Every applied migration that defines or redefines one of the nine functions (20260508020000, 20260508040100, 20260515010000, 20260618000400, 20260618000800, 20260704000000, 20260704000100, 20260720000300, 20260720000400) — append-only
- supabase/functions/** — the two service-role callers keep working; nothing to change
- src/** — every frontend caller runs as `authenticated`, which keeps EXECUTE
- src/types/** — grants carry no type impact

## Architecture layers touched

- [x] migration (`supabase/migrations/`)
- [ ] RPC (`supabase/functions/` or `.sql`)
- [ ] adapter (`src/lib/*/*Adapter.ts`)
- [ ] context (`src/context/`)
- [ ] component (`src/components/`)
- [ ] test (`src/**/__tests__/`)

No type impact: the migration changes privileges only; no table, column, enum or function signature changes.

## Mock data plan

none

## Approved-by

None required — `supabase/` is owned by @rv61. @ish-dev-piqc is tagged on the PR because her team applies migrations.

## Caller trace (why `authenticated` and `service_role` keep EXECUTE)

| Function | Callers that run as `authenticated` | Callers that run as `service_role` |
|---|---|---|
| `user_can_access_protocol(uuid, uuid)` | RLS policies in 11 migrations (all `TO authenticated`) | `send-daily-digest`, `dashboard-chat` |
| `user_can_access_deliverable_engine(uuid, uuid)` | deliverable RLS policies (20260720000500); generate-gate RPC (20260720000600) | — |
| `org_has_entitlement(uuid, text)` | `useDeliverableEntitlement` hook; called inside `user_can_access_deliverable_engine` (DEFINER → owner) | — |
| `protocol_owner_org_id(uuid)` | policy `protocol_messages_admin_update`; org-event triggers are DEFINER → owner | — |
| `audit_mode_extracted_item_matches_protocol(uuid, uuid)` | `audit_mode_create/update_workspace_entry` (INVOKER); `audit_mode_create/update_protocol_risk` are DEFINER → owner | — |
| `_sotr_build_review_snapshot(uuid[])` | `sotr_create_review_event` (INVOKER) | — |
| `_sotr_build_sources_json(uuid)` | `sotr_get_worksheet_item_evidence`, `sotr_get_worksheet_items_evidence_batch` (INVOKER) | — |
| `count_orphan_chat_attachments()` / `delete_orphan_chat_attachments()` | `chatAttachmentsCleanupApi` (org-admin gated in the body) | — |

No RLS policy that references any of the nine is `TO anon` / `TO public` / without a `TO` clause (checked statement-by-statement); anon table reads on the corpus were already revoked in 20260721000000.

## Decision-debt ledger

- **Authenticated reach stays wide.** Any logged-in user can still call the seven un-gated helpers with arbitrary ids: `_sotr_build_sources_json` / `_sotr_build_review_snapshot` return evidence rows across protocols, and the access/entitlement/owner-org helpers act as membership, entitlement and org-mapping oracles. Closing that needs the SECURITY INVOKER callers to become DEFINER-with-access-check (or the helpers to gate on `auth.uid()`), i.e. `CREATE OR REPLACE` of applied RPCs — memo Step 4 for the backend team. Trigger: first external tenant on the project.
- **~40 other SECURITY DEFINER functions gate on `auth.uid()` in their body but were never revoked from `PUBLIC`.** Anon calls fail on the gate, so this is hygiene, not exposure. Trigger: bundle with the Step-4 work.

## Verification

Pre-apply (recorded 2026-09-03): every one of the nine executed for the anon role via `POST /rest/v1/rpc/<fn>` with the public key and null arguments — seven returned `HTTP 200` (`false` / `null` / `true` / `[]`), and the orphan pair ran to its org-admin body gate and raised `P0001`. The exposure is observed, not inferred.

- [ ] CI green (mechanical checks only — CI does not execute migrations; the backend team's `supabase db push` is the first execution of this SQL)
- [ ] Backend applies the migration; `db push` reports no `function … does not exist` (every signature is pinned to the applied definition)
- [ ] Anon probes now return `401 / 42501 permission denied`: `POST /rest/v1/rpc/user_can_access_protocol` `{"uid":null,"pid":null}`, `POST /rest/v1/rpc/org_has_entitlement` `{"p_org_id":null,"p_capability":null}`
- [ ] Logged-in walk still works: open a protocol (access policies) → Deliverables tab loads and Generate is offered/withheld correctly (deliverable engine + entitlement) → SOTR worksheet item evidence opens (`_sotr_build_sources_json`) → approve one SOTR draft item (`_sotr_build_review_snapshot`) → Audit Mode Stage 6: add an entry with a protocol source link (`audit_mode_extracted_item_matches_protocol`) → org admin: Storage cleanup shows the orphan count
- [ ] Edge functions: daily digest sends; dashboard chat answers a protocol question (both check access via `user_can_access_protocol` as `service_role`)
- [ ] Rollback if a legitimate caller breaks: `GRANT EXECUTE … TO <that role>` for the one function, never back to `PUBLIC` or `anon`
