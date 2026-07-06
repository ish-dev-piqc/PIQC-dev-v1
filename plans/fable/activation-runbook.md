---
owner: fable-dev-piqc
feature: activation-runbook
status: in-review
started: 2026-07-05
target_pr:
---

# Activation runbook refresh — turnkey backend handoff

## Context

The deliverable engine is feature-complete on main but nothing is live: 11
migrations + the `ingest` deploy are un-pushed (dev-team lane). The existing
`docs/deliverables/ACTIVATION.md` stopped at the amendment-refresh slice (8
migrations) and predates site-training / list-summary / portfolio + the
export-all / overview / review-filter UI. This refresh makes the handoff
turnkey so the backend push can happen in one confident pass.

## Design

Docs-only rewrite of `docs/deliverables/ACTIVATION.md`:
- A TL;DR with the exact `$TOKEN`/`$REF` command sequence (migrate → deploy ingest).
- The full **11-migration** table in apply order (adds #433 site-training,
  #437 list-summary, #443 portfolio), noting the live generate is **v7**, the
  four `ADD VALUE` files, the missing-14 gap, and the two pure-read RPCs.
- RLS probes extended to the new read RPCs (`deliverable_list_summary`,
  `deliverable_portfolio_summary`, `deliverable_get_change_summary`) + the
  append-only `deliverable_generation_log` check.
- End-to-end QA rewritten to cover every user-facing slice: portfolio grid +
  overview board framing, all five deliverables, all-five export, the review
  filter/progress loop, amendment refresh, action layer, and CRA mode.
- Triage pointers for the config-driven export builder + the refreshKey
  re-sync, and the ingest-side enrichment tee-up (real fact-diffing + typed
  labs/imaging extraction).

## Scope (files allowed)

- `plans/fable/activation-runbook.md` — this file.
- `docs/deliverables/ACTIVATION.md` — the rewrite.

## Out of scope (files forbidden)

- Any code / migration / test — this is documentation only.

## Architecture layers touched

- [ ] migration / RPC / adapter / context / component / test
- [x] docs

## Mock data plan

None.

## Approved-by

- No codeowner approval required — `docs/deliverables/` is Fable-authored docs;
  no `supabase/**` or shared-infra file is edited (the runbook only *describes*
  the queue, Roger still owns applying it).

## Verification

- [x] Every migration filename + apply order matches `supabase/migrations/`
  (verified by `ls`); Roger's handle (`@rv61`), the read-RPC security mode
  (INVOKER), and the ingest `prohibited_med` field verified against source.
- [ ] Roger reads it and can activate the batch end to end without back-and-forth.

## Decisions encoded

1. **One turnkey doc** — command sequence + ordered queue + probes + QA in a
   single file the backend owner follows top to bottom.
2. **Describe, don't apply** — Fable documents the queue; the actual
   push/deploy stays Roger's (gated on the founder's SUPABASE_ACCESS_TOKEN).
