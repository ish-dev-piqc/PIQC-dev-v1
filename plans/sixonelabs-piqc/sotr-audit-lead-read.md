---
owner: sixonelabs-piqc
feature: sotr-audit-lead-read
status: active
started: 2026-09-04
target_pr:
---

# SOTR: lead auditors can read the parsed protocol they audit (F-011)

## Context

Every parsed-protocol read — `documents`, `protocol_extracted_items`,
`protocol_source_evidence`, `protocol_item_evidence_links` — is gated on
`documents.user_id = auth.uid()` (20260508000000:84-155, 20260430130000). A lead
auditor whose audit is pinned to a protocol uploaded under another account sees
an empty worksheet with no error, while the drafting edge functions (service
role) cite that same document. F-011's own revisit trigger was "the first
deployment where an auditor account ≠ the uploading account". PR-2 of the
approved protocol → risks → scope plan: PR-3's readiness RPC counts visible
items under this same predicate and PR-5's candidates read these tables.

**Decision:** the lead auditor of an audit on protocol P may READ P's parsed
content regardless of who uploaded it. Writes, deletes, worksheet review
actions (`worksheet_review_events`) and `chunks` (Ask/chat) stay uploader-only.

## Scope (files allowed)

- supabase/migrations/20260912000000_sotr_audit_lead_read.sql
- plans/sixonelabs-piqc/sotr-audit-lead-read.md

## Out of scope (files forbidden)

- src/types/** — no type impact (policies only; no schema or column change)
- supabase/migrations/20260508000000_sotr_schema.sql and every applied migration (append-only)
- `chunks` and `worksheet_review_events` policies — deliberately not widened
- src/lib/sotr/**, src/components/sotr/** — reads inherit the new reach; no client change
- src/lib/audit/auditCreationApi.ts — `listAuditorProtocolLibrary` filters by `user_id` explicitly and stays owner-scoped by design

## Architecture layers touched

- [x] migration (`supabase/migrations/`)
- [ ] RPC (`supabase/functions/` or `.sql`)
- [ ] adapter (`src/lib/*/*Adapter.ts`)
- [ ] context (`src/context/`)
- [ ] component (`src/components/`)
- [ ] test (`src/**/__tests__/`)

## Mock data plan

none

## Approved-by

- supabase/ is owned by @rv61 (this PR's author). Courtesy review tag: @ish-dev-piqc (SOTR domain).

## Decisions

- Four additive `FOR SELECT TO authenticated` policies. Permissive policies OR
  together with the existing owner `FOR ALL` policies, so writes and deletes
  remain uploader-only. No grants change: the tables already grant SELECT to
  `authenticated`.
- Predicate shape copied from `audit_source_documents_via_audit`
  (20260830000000:83): `protocol_id IN (SELECT protocol_id FROM audits WHERE
  lead_auditor_id = auth.uid())`. `audits_select_lead_auditor` already limits
  that subquery to the caller's own audits.
- `documents` policy scoped to `kind = 'PROTOCOL'`: AUDIT_EVIDENCE documents
  keep their own via-audit reach and are never exposed by protocol_id (ingest
  refuses a pin on evidence anyway).
- Side effect, stated: Site Mode's Knowledge Base lists documents via SELECT —
  an auditor now sees the audited protocol's document there, with no delete
  control (delete stays owner-only).
- `sotr_get_worksheet_item_evidence` / `_batch` are SECURITY INVOKER
  (20260509000000:55-61) → inherit the new reach automatically.
  `hybrid_search` over `chunks` stays owner-scoped — ledger: Ask over an
  audited protocol returns nothing for the auditor.
- `DROP POLICY IF EXISTS` before each `CREATE POLICY` (precedent
  20260726000000) so the file is re-runnable.
- Nested RLS: the subqueries on `documents` / `protocol_extracted_items`
  inside the policies run as the caller, so their own policies apply — the
  explicit predicate makes the result independent of that (same pattern as the
  owner policies).

## Verification

- [x] Baseline recorded 2026-09-04 with the public key on the hosted project:
      `protocol_extracted_items`, `protocol_source_evidence`,
      `protocol_item_evidence_links` → `[]` HTTP 200 (anon has no policy);
      `documents` → HTTP 401 `42501` (SELECT revoked in 20260721000000).
      Expected UNCHANGED after apply — the new policies are `TO authenticated`.
- [ ] Static: `git log main -- supabase/migrations/20260912000000_sotr_audit_lead_read.sql`
      empty (append-only); no `src/types/` diff; "no type impact" in the PR body.
- [ ] After `db push` (two accounts, because the owner's own audits are same-login
      and show no change): account A uploads + parses a protocol; account B leads
      an audit pinned to it. In B's audit: Records ▸ Protocol source lists the
      worksheet items with evidence; vendor Stage 4 worksheet populated;
      RiskTaggingForm's "Choose a protocol source item" picker lists items; B's
      Site Mode Knowledge Base shows A's document without a delete control; B's
      Ask over that protocol returns nothing (chunks stay owner-scoped — expected);
      B's worksheet review actions on A's items are refused (uploader-only).
- [ ] Same-login audits: no behavior change.
- [ ] Re-run the anon probe above: identical results.
