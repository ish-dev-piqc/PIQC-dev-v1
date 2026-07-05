# Protocol Deliverable Engine — Activation Runbook

One document for the backend pass that takes the Fable-lane deliverable
work (#402, #409, #412, #414, action-layer PR) from merged-on-main to
live-on-dev. Everything in it was built and unit-verified WITHOUT a live
database; the steps below are the parts only a real environment proves.

Owner: Roger (`@rv61`). Front-end/lens questions: Fable lane
(`plans/fable/_archive/*` holds each slice's full design + decisions).

---

## 1. Apply migrations (append-only, already ordered)

```
SUPABASE_ACCESS_TOKEN=<token> npx supabase db push --project-ref ygfcjwgsjmathinqkppq --dry-run && SUPABASE_ACCESS_TOKEN=<token> npx supabase db push --project-ref ygfcjwgsjmathinqkppq
```

Deliverable-engine migrations in the queue (other lanes' pending
migrations apply in the same push — the dry run lists everything):

| Migration | Ships | PR |
|---|---|---|
| `20260708000000_protocol_deliverables_schema.sql` | 3 tables + enums + RLS (content_origin taxonomy) | #402 |
| `20260708000100_deliverable_rpcs.sql` | generate/get_packet/review/edit/add/delete/export (v1) | #402 |
| `20260709000200_deliverable_risk_overview.sql` | `risk_overview` enum value + generate v2 (per-type dispatch) | #409 |
| `20260710000000_deliverable_prohibited_meds.sql` | generate v3 (checklist §2 consumes prohibited_med facts) | #412 |
| `20260711000000_deliverable_cra_focus.sql` | `cra_monitoring_focus` enum value + generate v4 | #414 |
| `20260712000000_protocol_action_cards.sql` | ActionCard table + sync/get/set_status | #416 |
| `20260713000000_deliverable_siv_package.sql` | `siv_package` + `speaker_note` + generate v5 | siv-package PR |
| `20260715000000_deliverable_amendment_refresh.sql` | generation_seq + generation log + generate v6 + packet v2 + change-summary RPC | amendment-refresh PR |

Notes that matter when they run:
- Each `CREATE OR REPLACE deliverable_generate` fully supersedes the
  previous version — v4 is the live body once the batch lands.
- The two `ALTER TYPE ... ADD VALUE` statements are safe in-transaction
  because nothing in the same migration *uses* the new value (function
  bodies are stored as text); do not merge these files together.

## 2. Deploy the ingest function

```
SUPABASE_ACCESS_TOKEN=<token> npx supabase functions deploy ingest --project-ref ygfcjwgsjmathinqkppq
```

Required for #412: `prohibited_medications` in `CLINICAL_EXTRACT_SCHEMA`
is inert until deployed. No other function changed in these slices.

## 3. Re-ingest one demo protocol

Re-ingest (existing idempotent flow) any demo protocol that contains a
concomitant/prohibited-medication section. This is the activation path
for prohibited_med facts — there is deliberately no backfill job
(#412 Decision 4).

## 4. RLS / auth probes (SQL editor or psql, per role)

- As a **non-member** of a protocol: `SELECT deliverable_generate('<pid>',
  'monitoring_prep_checklist')` → must raise `insufficient_privilege`;
  `deliverable_get_packet` → NULL; `action_cards_sync` → raises;
  direct `SELECT` on all four new tables → zero rows.
- As the **owner / org member**: generate returns counts; get_packet
  returns JSON; `action_cards_sync` then `action_cards_get` returns the
  travel card.
- Known-dormant path (documented decision debt, not a bug): the sponsor
  clause of `user_can_access_protocol()` has no `sponsor_relationships`
  rows yet, so true sponsor-org visibility stays dark until that ships.
- Append-only audit check: `UPDATE deliverable_block_edits SET ...` as
  any authenticated role → must fail (no UPDATE/DELETE policies).

## 5. Per-slice live QA (in the app, as owner/org member)

**#402 Monitoring Prep Checklist** — Sponsor → Protocol Intelligence →
Generate: blocks grouped in 9 sections with evidence chips + confidence;
traceability drawer shows quote/section/page; edit bumps version and
survives Regenerate; "Remove from draft" (two-step) stays gone after
Regenerate; reviewed→unmark restores edited/human_added correctly;
Export PDF: DRAFT watermark, disclaimer, traceability appendix, no
sponsor name anywhere in the file or filename.

**#409 Risk Overview** — second chip: explainable-factor cards, `low`
confidence on keyword-heuristic cards, no numeric scores anywhere.

**#412 prohibited meds** — after step 3: SOTR review list shows a
"Prohibited medications" group with citations; regenerate the checklist
→ §2 lists each medication with evidence; a protocol with no
restrictions still shows the coverage-gap fallback block.

**#414 CRA Monitoring Focus** — third chip: attention-allocation prose
(never duplicates checklist/risk wording for the same fact); risk
overview now also shows "Restricted medication in eligibility scope"
cards after its regenerate.

**siv-package** — fourth chip: nine teaching sections, every emitted
section ends with ONE speaker note whose text ends with the
sponsor-confirmation sentence; Export produces the landscape deck with
the notes band; checklist export unchanged.

**amendment-refresh** — generate (seq 1: no banner, no New chips) →
re-ingest an amended protocol → regenerate → "What changed" banner shows
new/removed/flagged counts + lists; New chips on inserted blocks;
human-edited blocks NEVER appear in the removed list (only pristine
drafts are deleted — verify against deliverable_generation_log);
`deliverable_get_change_summary` returns NULL for a non-member.

**action-layer** — after any deliverable exists: the travel card renders
under the panel with fact-derived rationale + "N protocol sources" +
disclaimer; NO link-out (URL config intentionally absent — Decision 2);
Dismiss hides it; regenerating/re-syncing does NOT resurrect it;
`action_card_set_status` probes for all three statuses.

## 6. Failure triage pointers

- Packet renders empty / "malformed RPC response": check
  `deliverable_get_packet` JSON keys against `src/types/deliverables`
  (adapter skips malformed blocks; whole-packet null means top-level
  shape). The adapter's artifact whitelist derives from
  `ARTIFACT_TYPE_LABELS` — if a new artifact type 404s here, the enum
  value landed without the label entry.
- Regenerate resurrected something a human removed: fingerprints include
  `derived_text`; see the match/apply block in the latest
  `deliverable_generate` before suspecting the UI.
- Every slice's full design rationale: `plans/fable/_archive/`.

## 7. Ingest-side enrichment tee-up (Roger's lane, optional)

The amendment-refresh slice tells the change story at the DELIVERABLE
level (what blocks appeared/vanished/were flagged). The richer story —
"exclusion criterion 4's TEXT changed from X to Y at the source" —
requires ingest-side fact diffing: on re-ingest, compare incoming
extracted values against the existing protocol_extracted_items rows
(the UNIQUE (document_id, field_path) upsert already pins identity) and
record per-field old→new deltas. Design sketch lives in the handover's
Phase-5 section; the deliverable-side machinery consumes it whenever it
lands — no client changes required to benefit (fingerprints already
key on derived_text).
