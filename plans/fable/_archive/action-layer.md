---
owner: fable-dev-piqc
feature: action-layer
status: merged
merged: 2026-07-05
started: 2026-07-04
target_pr: #416
---

# Context-Aware Action Layer — ActionCards + Travel Bridge + activation runbook

## Context

Handover Phase 3: every intelligence view can end with an optional,
explainable **next-action card** that hands the user to the right
external system — PIQC suggests and links out; execution happens
elsewhere. Generic model (`protocol_action_cards` + `ActionCardRail`),
first card: monitoring-travel planning support derived deterministically
from existing deliverables + facts. Also ships the consolidated
**activation runbook** (`docs/deliverables/ACTIVATION.md`) so the dev
team's backend pass (db push, deploy, live QA) is one document, not five
plan MDs.

## Design

### Data (`20260712000000_protocol_action_cards.sql`)

Table `protocol_action_cards`: id, protocol_id FK, deliverable_id FK
NULL (SET NULL), trigger_context text, title, rationale,
protocol_evidence_ids uuid[] (soft refs into protocol_source_evidence —
arrays can't FK; documented), suggested_window jsonb NULL,
external_destination_type text CHECK ('travel','lms','ctms','none'),
external_url_or_template text NULL, disclaimer text NOT NULL, status
text CHECK ('suggested','dismissed','acted') DEFAULT 'suggested',
timestamps. UNIQUE (protocol_id, trigger_context) — one card per
trigger, sync updates in place. RLS via user_can_access_protocol
(all four commands; status writes via RPC).

RPCs:
- `action_cards_sync(p_protocol_id)` — SECURITY DEFINER (reads
  owner-gated SOTR facts), access-gated first. Deterministic: emits the
  `monitoring_prep` travel card IFF the protocol has ≥1 deliverable.
  Rationale assembled from real facts only (primary-endpoint count,
  narrow-window visit count ≤2d, amendment presence — clauses with zero
  data are omitted); protocol_evidence_ids = those facts' primary
  evidence ids. **Status preserved on re-sync; a dismissed card is
  updated in place but stays dismissed — never resurrected** (the
  engine's rejection discipline). Card fields refresh; status doesn't.
- `action_cards_get(p_protocol_id)` — INVOKER, JSON array, excludes
  nothing (client renders dismissed=hidden; keeps the model simple and
  lets a future "show dismissed" affordance exist without RPC change).
- `action_card_set_status(p_card_id, p_status)` — INVOKER; 'suggested'
  ↔ 'dismissed'; 'acted' recorded when the user follows the link-out
  (a fact about a click, not an approval).

### Client

- `src/types/actions/index.ts` — mirrors + packet shapes + label maps.
- `src/lib/actions/actionsApi.ts` (Result<T>) / `actionsAdapter.ts`
  (pure, defensive) + `__tests__`.
- `src/components/actions/ActionCard.tsx` — the handover pattern:
  Context → why this matters (rationale) → next action → external
  destination. Evidence chip count (opens nothing v1 — evidence ids
  render as "n protocol sources"; drilldown is follow-up), link-out ↗
  ONLY when external_url_or_template present, else neutral guidance
  ("Open your organization's travel tool"); disclaimer always visible;
  Dismiss (two-step like Remove-from-draft? No — dismiss is reversible
  by design here, one click, card hides; decision below).
- `src/components/actions/ActionCardRail.tsx` — takes protocolId,
  fetches via api, renders suggested cards, hides dismissed.
- Mount: one insertion in `ProtocolIntelligenceTab.tsx` below the
  deliverable panel; rail self-hides when empty. Sync fires on tab load,
  protocol switch, and deliverable-chip switch (refreshKey) — no panel
  callback, keeping DeliverablePanel out of scope; a just-generated
  deliverable surfaces its card on the next chip/tab visit.

### Runbook — `docs/deliverables/ACTIVATION.md`

For the dev team: ordered migration list (six: 20260708000000 →
20260712000000), `functions deploy ingest`, re-ingest note, per-slice
live-QA checklists (#402/#409/#412/#414/this), RLS probe scripts,
known dormant paths (sponsor clause of user_can_access_protocol).

## Scope (files allowed)

- `plans/fable/action-layer.md` — this file.
- `src/types/actions/` (new).
- `src/lib/actions/` (new, + `__tests__`).
- `src/components/actions/` (new).
- `src/components/dashboard/sponsor/deliverables/ProtocolIntelligenceTab.tsx`
  — rail mount + post-generate sync callback only.
- `supabase/migrations/*_protocol_action_cards.sql` (new).
- `docs/deliverables/ACTIVATION.md` (new).

## Out of scope (files forbidden)

- `src/lib/deliverables/**`, `DeliverablePanel.tsx`,
  `src/components/deliverables/**` — the rail is a sibling, not a
  panel change (panel exposes no hooks; the tab wires the sync).
- All mode dirs, contexts, entitlements, LeftRail/Dashboard/App.
- `deliverable_generate` — cards sync in their own RPC, not inside
  generation (keeps the fat function stable and the concerns separate).
- Merged migrations; ingest pipeline.

## Architecture layers touched

- [x] migration (1 new: table + RLS + 3 RPCs)
- [x] RPC (sync / get / set_status)
- [x] adapter (`actionsAdapter.ts`, pure)
- [ ] context
- [x] component (ActionCard, ActionCardRail + tab mount)
- [x] test (adapter, api, sync semantics via fixtures)

## Mock data plan

None.

## Approved-by

- Roger (`@rv61`) — `supabase/migrations/*`. The ACTIVATION.md runbook
  is written FOR Roger's backend pass — review it for accuracy.

## Verification

- [x] typecheck / build / new suites green (15 new actions tests;
  741/741 across src/lib); existing suites unregressed; zero new
  full-suite failures vs baseline.
- [ ] Manual (post db push): generate a deliverable → travel card
  appears with fact-derived rationale + evidence count + disclaimer;
  no link when no URL template configured; Dismiss hides it; re-sync
  (regenerate) does NOT resurrect it; set_status probes.
- [x] Card language contains no booking/mandate/approval verbs
  (planning-support framing only — grep-verified in SQL + components).
- [x] `piqc-review` clean.

## Decisions encoded

1. **No suggested_window in v1.** Protocol-only data cannot honestly
   suggest travel dates (that's operational context). The column exists
   for the overlay phase; the sync RPC writes NULL. Never fabricate.
2. **No third-party URL hardcoded.** external_url_or_template stays
   NULL until an org-config surface exists; the card renders neutral
   guidance instead of a link. No provider coupling, no UI cloning.
3. **Cards sync in their own RPC**, not inside deliverable_generate —
   separate concern, separately testable, keeps v4 stable.
4. **One-click dismiss (reversible)** unlike block rejection: a
   dismissed card is preserved + re-showable by design; no data loss,
   so no confirm step.
5. **'acted' is a click record, not workflow state** — draft-only
   doctrine extends here: PIQC never claims the action happened.
6. Rail lives in `src/components/actions/` (non-mode) so Site/Audit
   surfaces can mount it later without isolation violations.
