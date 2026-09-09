---
owner: ki-dev-piqc
feature: org-wide-parsed-protocol-read
status: active
started: 2026-09-09
target_pr: TBD
---

# Org-wide read access to already-parsed protocol documents

## Context

Kiara added Roger to the PIQC org so he could pick up audit-deliverable
testing on a protocol she'd already uploaded and parsed. Tracing the actual
RLS showed org membership alone doesn't grant that: `documents` /
`protocol_extracted_items` / `protocol_source_evidence` /
`protocol_item_evidence_links` are only readable by the uploader
(`documents.user_id = auth.uid()`) or the lead auditor of an audit pinned to
that protocol (`20260912000000_sotr_audit_lead_read.sql`). Neither covers
"another member of the same org wants to reuse a parse someone else ran" —
today that person sees an empty worksheet with no error and is tempted to
re-upload the same PDF, burning another Reducto Extract pass. Goal: "we only
want to parse documents once per organization unless someone else wants to
manually do it."

## Scope (files allowed)

- `supabase/migrations/20260913000000_org_members_read_parsed_protocol_docs.sql` (NEW)

## Out of scope (files forbidden)

- Ingest/re-parse dedup — `documents_content_hash_idx` is scoped to
  `(user_id, content_hash)`, so a teammate re-uploading the identical PDF
  still triggers a fresh parse today. Making dedup org-scoped (so the
  re-upload is recognized and skipped, not just readable after the fact) is
  a related but separate change to the ingest pipeline
  (`supabase/functions/ingest/`) — flagged as a natural follow-up, not
  included here.
- `chunks`, `worksheet_review_events` — intentionally not widened, matching
  the precedent in `20260912000000_sotr_audit_lead_read.sql` (Ask/chat
  hybrid_search and per-reviewer audit trail are separate decisions).
- Any INSERT/UPDATE/DELETE policy — this migration only adds SELECT policies.
  Upload/edit/delete stay uploader- or service-role-only, unchanged.

## Architecture layers touched

- [x] migration (`supabase/migrations/`) — 4 new permissive SELECT policies,
      additive only (existing owner-only + lead-auditor policies untouched)
- [ ] RPC
- [ ] adapter
- [ ] context
- [ ] component
- [ ] test — no vitest coverage for RLS; verification is a live Supabase
      check (see below), matching how `20260912000000` was verified

## Mock data plan

None — read-only RLS policy addition, no schema/column change, no new
response shape.

## Approved-by

- @rv61 — for `supabase/migrations/**` (Roger's exclusive domain per
  CODEOWNERS; not shared infra). **Not yet obtained.** This migration
  broadens a data-access boundary (who can read parsed protocol content)
  and should not be merged/deployed without Roger's explicit review — this
  PR is a drafted proposal, not a request to fast-track past that review.

## Verification

- [ ] As a non-uploading, non-lead-auditor member of the same org as the
      protocol's owner, confirm the worksheet / source drawer / item picker
      now show the already-parsed content instead of empty states.
- [ ] Confirm a member of a DIFFERENT org (no `protocol_org_access` row)
      still sees nothing — the widening is org-scoped, not global.
- [ ] Confirm AUDIT_EVIDENCE-kind documents are unaffected (still
      via-audit-only).
- [ ] Confirm chunks / Ask / hybrid_search behavior is unchanged.
- [ ] Confirm the uploader can still edit/delete their own document, and a
      non-uploading org member cannot (SELECT widened, nothing else).
