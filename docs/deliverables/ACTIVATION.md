# Protocol Deliverable Engine — Activation Runbook

One document to take the whole Fable-lane deliverable engine from
**merged-on-main** to **live-on-dev**. Everything was built and unit-verified
**without a live database** (typecheck + build + vitest + `pglast` parse +
byte-diff branch-preservation); the steps here are the parts only a real
environment proves — applying the migrations, deploying ingest, and end-to-end
QA as real roles.

- **Owner:** Roger (`@rv61`) — `supabase/**` is his lane.
- **Design/lens questions:** the Fable lane. Every slice's full design +
  decisions live in `plans/fable/_archive/<slice>.md`.
- **Scope of "the engine":** 11 append-only migrations (below) + one edge-fn
  deploy (`ingest`). Everything else (CRA mode, the overview/portfolio grids,
  the review filter, all-five export) is **frontend-only** and already ships
  with the app build — it simply needs the backend live to have data to show.

> **Nothing below is live yet.** No migration in this queue has been pushed;
> the whole engine is dark until step 1 runs.

---

## 0. TL;DR — the turnkey order

Set the two variables once, then run 1 → 2 → 3 → 4 → 5 in order:

```bash
export SUPABASE_ACCESS_TOKEN=<token>
export REF=ygfcjwgsjmathinqkppq   # dev project ref

# 1. migrations (dry-run first, then apply)
npx supabase db push --project-ref "$REF" --dry-run
npx supabase db push --project-ref "$REF"

# 2. ingest edge function (unlocks prohibited-med extraction)
npx supabase functions deploy ingest --project-ref "$REF"
```

Then **3** (re-ingest one demo protocol), **4** (RLS probes), **5** (in-app QA).
Total human time is dominated by QA, not the commands.

---

## 1. Apply migrations (append-only, already ordered)

The 11 deliverable-engine migrations, in apply order. Other lanes' pending
migrations apply in the **same** push — the dry run lists everything; read it
before applying.

| # | Migration | Ships | PR |
|---|---|---|---|
| 1 | `20260708000000_protocol_deliverables_schema.sql` | 3 tables (`protocol_deliverables`, `protocol_deliverable_blocks`, `deliverable_block_edits`) + 3 enums (artifact_type / content_origin / review_state) + RLS via `user_can_access_protocol` | #402 |
| 2 | `20260708000100_deliverable_rpcs.sql` | RPCs v1: `deliverable_generate` (DEFINER) + get_packet / set_block_review / edit_block_text / add_block / delete_block / export_packet (INVOKER) | #402 |
| 3 | `20260709000200_deliverable_risk_overview.sql` | `ALTER TYPE … ADD VALUE 'risk_overview'` + generate **v2** (per-type dispatch) | #409 |
| 4 | `20260710000000_deliverable_prohibited_meds.sql` | generate **v3** (checklist §2 consumes `prohibited_med` facts) | #412 |
| 5 | `20260711000000_deliverable_cra_focus.sql` | `ADD VALUE 'cra_monitoring_focus'` + generate **v4** | #414 |
| 6 | `20260712000000_protocol_action_cards.sql` | `protocol_action_cards` table + `action_cards_sync` / `action_cards_get` / `action_card_set_status` | #416 |
| 7 | `20260713000000_deliverable_siv_package.sql` | `ADD VALUE 'siv_package'` + `speaker_note` block type + generate **v5** | siv PR |
| 8 | `20260715000000_deliverable_amendment_refresh.sql` | `generation_seq` columns + `deliverable_generation_log` table + generate **v6** + get_packet **v2** + `deliverable_get_change_summary` (INVOKER) | #425 |
| 9 | `20260716000000_deliverable_site_training_priorities.sql` | `ADD VALUE 'site_training_priorities'` + generate **v7** (5-type dispatch — the live body after the batch) | #433 |
| 10 | `20260717000000_deliverable_list_summary.sql` | `deliverable_list_summary(protocol)` read RPC (INVOKER) — per-protocol status board | #437 |
| 11 | `20260718000000_deliverable_portfolio_summary.sql` | `deliverable_portfolio_summary()` read RPC (INVOKER) — cross-protocol digest | #443 |

**Notes that matter when they run:**
- There is **no `20260714…` deliverable migration** — that slot belongs to a
  different lane (visit-prep). The queue jumps 13 → 15 on purpose.
- Each `CREATE OR REPLACE deliverable_generate` **fully supersedes** the prior
  version. After the batch, the live body is **v7** (site_training) — it
  dispatches all five artifact types and byte-preserves every earlier branch.
- **Four** `ALTER TYPE … ADD VALUE` statements land (risk / cra / siv /
  site_training). Each is safe in-transaction because nothing in the same
  migration *uses* the new value (plpgsql bodies are stored as text, evaluated
  at call time). **Do not merge these files together** — that would break the
  in-transaction guarantee.
- Migrations 10 & 11 are **pure reads** (SECURITY INVOKER, no writes, no new
  tables) — lowest-risk in the batch.

## 2. Deploy the ingest function

```bash
npx supabase functions deploy ingest --project-ref "$REF"
```

Required for #412: `prohibited_medications` in `CLINICAL_EXTRACT_SCHEMA`
(`supabase/functions/_shared/ingestPipeline.ts`) is **inert until deployed** —
protocols ingested before this deploy carry no `prohibited_med` facts. No other
edge function changed across these slices.

## 3. Re-ingest one demo protocol

Re-ingest (the existing idempotent flow) any demo protocol that contains a
concomitant/prohibited-medication section. This is the activation path for
`prohibited_med` facts — there is deliberately **no backfill job** (#412
Decision 4). One protocol is enough to prove the extraction end-to-end.

## 4. RLS / auth probes (SQL editor or psql, per role)

The engine's security model: **`deliverable_generate` is SECURITY DEFINER**
(it must read SOTR's owner-only rows internally); **every read/write RPC is
SECURITY INVOKER** and relies on RLS (`user_can_access_protocol`) as the gate.
Verify both halves:

**As a NON-member of the protocol** (nothing should leak):
- `SELECT deliverable_generate('<pid>', 'monitoring_prep_checklist')` → raises
  `insufficient_privilege` (42501).
- `SELECT deliverable_get_packet('<pid>', 'monitoring_prep_checklist')` → `NULL`.
- `SELECT deliverable_list_summary('<pid>')` → `[]` (empty, **not** an error).
- `SELECT deliverable_portfolio_summary()` → `[]` if they have no accessible
  protocols (each protocol they *can* see contributes rows; others never do —
  no existence leak).
- `SELECT deliverable_get_change_summary('<deliverable-id>')` → `NULL`.
- `action_cards_sync('<pid>')` → raises; direct `SELECT` on all four engine
  tables → zero rows.

**As the OWNER / org member:**
- generate returns `{deliverable_id, blocks_created, blocks_preserved}`;
  get_packet returns JSON; list_summary returns one row per generated type;
  portfolio_summary returns the protocol with `deliverable_count` +
  block counts; `action_cards_sync` then `action_cards_get` returns the travel
  card.

**Append-only audit check** (any authenticated role):
- `UPDATE deliverable_block_edits SET …` / `UPDATE deliverable_generation_log
  SET …` → must **fail** (both tables have SELECT + INSERT policies only; the
  absence of UPDATE/DELETE policies *is* the enforcement).

**Known-dormant path (documented decision debt, not a bug):** the sponsor
clause of `user_can_access_protocol()` has no `sponsor_relationships` rows yet,
so true sponsor-org visibility stays dark until Kiara's relationship rows ship.
**Validate everything as the document owner / enterprise org-member for now.**

## 5. End-to-end QA (in the app, as owner/org member, enterprise tier)

The engine surfaces in two places, both **enterprise-gated**
(`canUseSponsorMode` / `canUseCraMode`): the **Sponsor → Protocol Intelligence**
tab and the **CRA/Monitor mode**. Confirm a non-enterprise sub hits the calm
gate card in each; do the rest on an enterprise sub.

### Portfolio + selection (the framing, #437 / #443)
- **Sponsor → Protocol Intelligence** opens on a **portfolio grid** (not a
  dropdown): one card per protocol with **X/5 drafted**, a needs-review chip,
  and last-activity. Protocols with nothing generated read **"Not started."**
  Click a card → it selects (radio semantics) and the board + panel below load
  that protocol.
- Below the protocol grid, the **deliverable picker is also a card grid**
  (overview board): one card per artifact type with its own generated/reviewed/
  needs-review counts. Click one to view it.
- **Live re-sync:** generate or review a deliverable → both the deliverable
  card *and* the protocol's portfolio card update their counts without a reload
  (they share the panel's mutation tick).

### The five deliverables (generate each, one chip at a time)
- **Monitoring Prep Checklist** (#402) — 9 sections, evidence chips +
  confidence; traceability drawer shows quote/section/page; edit bumps version
  and survives Regenerate; "Remove from draft" (two-step) stays gone after
  Regenerate; reviewed→unmark restores edited/human_added correctly.
- **Risk Overview** (#409) — explainable-factor cards, `low` confidence on
  keyword-heuristic cards, **no numeric scores** anywhere; after step 3 shows
  "Restricted medication in eligibility scope" cards.
- **CRA Monitoring Focus** (#414) — attention-allocation prose that never
  duplicates the checklist/risk wording for the same fact.
- **SIV Package** (SIV PR) — nine teaching sections; every emitted section ends
  with **one** speaker note whose text ends with the sponsor-confirmation
  sentence.
- **Site Training Priorities** (#433) — instructional register ("Train… /
  Brief… / Retrain…"); the four fact domains (eligibility / visits / procedures
  / endpoints) **always say something** — real facts when extracted, an explicit
  "train from the protocol manually" gap block otherwise.

### Prohibited meds (#412 — after step 3)
- SOTR review list shows a "Prohibited medications" group with citations;
  regenerate the checklist → §2 lists each medication with evidence; a protocol
  with no restrictions still shows the coverage-gap fallback block.

### Export — all five are exportable (#435)
- Every chip shows an **Export** button. Checklist + SIV keep their existing
  outputs (checklist PDF; SIV landscape deck). Risk / CRA / Site-Training now
  each export a **DRAFT PDF** with **their own** section labels, header band,
  disclaimer, and filename slug. Every export: DRAFT watermark, requires-review
  disclaimer, source-traceability appendix, and **no sponsor name** anywhere in
  the file or filename.

### Review loop (#439)
- The panel header shows **reviewed/total** + a progress bar + an amber
  "N need review" count. The filter chips (**All / Needs review / Reviewed /
  Edited**) narrow the block list; marking an item reviewed moves it out of
  "Needs review" and ticks the progress. An empty filter shows an all-clear
  state; adding a block drops the filter back to All so the new item stays
  visible.

### Amendment refresh (#425)
- Generate (seq 1: no banner) → re-ingest an amended protocol → regenerate →
  the **"What changed"** banner shows new/removed/flagged counts + lists; New
  chips on inserted blocks; **human-edited blocks NEVER appear in the removed
  list** (only pristine drafts are deleted — verify against
  `deliverable_generation_log`).

### Action layer / Travel Bridge (#416)
- With any deliverable present, the travel card renders under the panel with
  fact-derived rationale + "N protocol sources" + disclaimer; **no link-out**
  (URL config intentionally absent — Decision 2). Dismiss hides it;
  regenerating/re-syncing does **not** resurrect it. Probe
  `action_card_set_status` for all three statuses.

### CRA / Monitor mode (#427 / #429)
- The CRA rail icon (amber) is discoverable but the workspace is enterprise-
  gated. Inside: the same portfolio-free flow scoped to a monitor — a
  focus-first **two-deliverable** picker (CRA Monitoring Focus + Monitoring Prep
  Checklist), the overview board, the panel, and the action rail. The amendment
  banner + travel card come through unchanged.

## 6. Failure triage pointers

- **Packet renders empty / "malformed RPC response":** check
  `deliverable_get_packet` JSON keys against `src/types/deliverables`. The
  adapter skips malformed *blocks*; a whole-packet null means the top-level
  shape is off. The adapter's artifact whitelist derives from
  `ARTIFACT_TYPE_LABELS` — if a whole artifact type nulls out, its enum value
  landed **without** a matching label entry.
- **A status card is stuck / wrong count:** the overview board + portfolio grid
  re-sync on the panel's mutation tick (`refreshKey`); a card that never updates
  after generate/review points at a missing `refreshKey` wire, not the RPC.
- **Regenerate resurrected something a human removed:** fingerprints include
  `derived_text`; read the match/apply block in the **v7** `deliverable_generate`
  before suspecting the UI.
- **A new export renders an empty body:** the export builder is config-driven
  (`src/lib/deliverables/deliverableExportConfig.ts`); a missing section-order
  entry there (not the RPC) is the cause.
- **Every slice's full design rationale:** `plans/fable/_archive/`.

## 7. Ingest-side enrichment tee-up (Roger's lane, optional — the remaining depth)

Two backend enrichments would deepen the engine without any client change:

1. **Real amendment fact-diffing (handover Phase 5).** The amendment-refresh
   slice tells the change story at the **deliverable** level (which blocks
   appeared/vanished/were flagged). The richer story — "exclusion criterion 4's
   TEXT changed from X to Y at the source" — needs ingest-side fact diffing: on
   re-ingest, compare incoming extracted values against the existing
   `protocol_extracted_items` rows (the `UNIQUE (document_id, field_path)`
   upsert already pins identity) and record per-field old→new deltas. The
   deliverable side consumes it for free — fingerprints already key on
   `derived_text`.
2. **Structured labs / imaging / specimen extraction.** Today the vendor/
   imaging/specimen sections are keyword-heuristic (forced `low` confidence). A
   typed sub-schema in `CLINICAL_EXTRACT_SCHEMA` would upgrade those cards to
   real facts across every lens at once (the selection specs already branch on
   `field_type`).

Neither blocks activation; both are pure upside whenever they land.
