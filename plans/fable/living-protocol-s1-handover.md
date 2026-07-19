# Handover — Living Protocol S1 (all-signal notice taxonomy)

**From:** Founder (sixonelabs) · **To:** Roger (dev partner, `supabase/` owner)
**Date:** 2026-07-09 · **Branch:** `fable/living-protocol` (git worktree `.claude/worktrees/living-protocol`, cut from `main` @ `0b93bb5`)

---

## Plain-English summary (30 seconds)

We built an experiment: make PIQC's "notable" rail sharper. Today it shows a few
standing notes that appear on almost every protocol (wallpaper). This change
retires the always-on one and adds two new checks that only fire when the
**uploaded protocol contradicts itself** — the same fact written two different
ways across its own documents, or some visits given scheduling windows while
others aren't. It never compares against any outside "industry standard" — only
the protocol's own text.

The code is written and it's been through an adversarial quality pass (two bugs
found and fixed, all tests green). **It is not merged and not meant to be merged
yet.** It's a proving-ground branch. We want to stand it up in an isolated copy
of our data, upload a protocol or two, and see with our own eyes whether PIQC
reads better. If it does, we adopt it into main as one small, clean change later.

**What I need from you:** set up the isolated environment so I can log in and
judge it. Details below. **What I'll do after:** the eyeballing — no code.

---

## What's already done (no action needed)

- New migration `supabase/migrations/20260723000000_protocol_notices_all_signal_taxonomy.sql`
  — `CREATE OR REPLACE` of `protocol_notices_sync` (supersedes the body in
  `20260722000100`), plus a one-time `DELETE` of the retired `endpoint_sdv` rows.
- TS mirror: `src/types/actions/index.ts` (NoticeType union) +
  `src/components/actions/NoticeCard.tsx` (icons) + a test case per new type.
- Full plan + SQL-QA runbook + verify log: `plans/fable/living-protocol-s1-taxonomy.md`.
- Verified locally: **69/69 tests green, `tsc --noEmit` clean.** Two adversarial
  agents found + we fixed: (1) N1 was over-citing evidence when 3+ documents
  share a field; (2) N2's guard wasn't confidence-gated symmetrically. Both fixed
  and re-verified.

## What the change does (the 5 checks after this)

Severity order, none always-on:
1. **cross_document_divergence (NEW)** — same fact (`protocol_number`,
   `protocol_title`, or `dosing_regimen`) extracted from ≥2 of the protocol's
   documents with values that disagree. Cites both sides.
2. tight_visit_window (unchanged)
3. amendment_in_force (unchanged)
4. **unwindowed_visit (NEW)** — protocol states a scheduling window for some
   visits and leaves others windowless. EXISTS-guarded so a protocol that
   uniformly omits windows never fires. High-confidence rows only.
5. low_confidence_extraction (now **gated** to high-stakes field_types —
   endpoint/visit/criteria/dosing/prohibited_med; metadata no longer surfaces).

---

## What I need you to do (the setup — your lane)

The detailed runbook is in `plans/fable/living-protocol-branch-isolation.md`
(§4A snapshot-seed path). Short version:

1. **Stand up an isolated Supabase project** (2nd cloud project — NOT prod, NOT
   sharing prod's DB). This is the whole reason it's safe to test freely: it's a
   throwaway copy.
2. **Snapshot-seed it from prod's already-parsed data** so we don't re-run
   Reducto (that budget is reserved for customers). Copy these tables only:
   `protocols`, `protocol_versions`, `protocol_extracted_items`,
   `protocol_source_evidence`, `protocol_item_evidence_links`,
   `evidence_attachments`, `chunks`, `documents`.
   **Exclude** `worksheet_review_events` and `protocol_notices` (the branch
   regenerates notices — copying prod's would confound the test).
3. **⚠️ Ownership remap (don't skip — the runbook flags this):** the copied rows
   FK into `auth.users` UUIDs that won't exist in the new project. After restore,
   remap `protocols.owner_id` / `documents.user_id` / `protocol_members.user_id`
   to the new login and insert `protocol_members` rows, then confirm the corpus
   is actually visible to that login before handing back.
4. **Apply all migrations, including the new S1 one**, to the preview DB.
5. **Run the precision-gate SQL QA** (the go/no-go — full steps in
   `living-protocol-s1-taxonomy.md` → "Verification"):
   - On ≥3 **clean** protocols: `protocol_notices_sync(id)` must produce **zero**
     `cross_document_divergence` and **zero** `unwindowed_visit` rows (silence is
     the win condition's other half — a wrong "PIQC caught something" is worse
     than nothing).
   - On a **seeded flawed** protocol (a `protocol_number` that differs between two
     documents + one high-confidence visit with no window alongside windowed
     ones): confirm exactly one of each notice, citing the right evidence.
   - Confirm zero `endpoint_sdv` rows survive.
6. **Wire the branch's `.env.local`** to the preview project + a launch config so
   the running app points at the isolated DB, and hand me a login.

**Getting the code:** the branch isn't pushed yet (founder-gated on your
go-ahead for the 2nd project). Once you're ready I'll push `fable/living-protocol`
so you can pull it, or we pair on it — your call.

## Definition of done (what you hand back to me)

A URL + login where I can: upload a protocol, open the notices rail, and see the
new checks behave — fire on real self-contradictions, stay silent on clean ones.

## Known limitation to log, not fix now

Cross-document checks have no "current version" concept yet — a superseded base
document's row counts the same as the current amendment's. It's a pre-existing
repo-wide pattern (shared by the unchanged tight-window check), out of scope for
this slice. Real fix waits on the amendment-versioning roadmap. Noted in the plan
MD's decision-debt ledger.

## Rollback (if we don't adopt)

Re-apply `20260722000100` to restore the prior sync body. It's additive and
isolated — nothing on `main` is touched by this branch.
