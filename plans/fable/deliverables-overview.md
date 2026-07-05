---
owner: fable-dev-piqc
feature: deliverables-overview
status: active
started: 2026-07-05
target_pr:
---

# Deliverables Overview — protocol-level status board

## Context

The engine has five exportable lenses, but the orientation layer is thin: a
sponsor/monitor lands on a protocol picker → a deliverable picker → one panel,
with no answer to "what has PIQC drafted for this protocol, and where does the
review stand?". This slice adds a status board (the first non-trivial new read
RPC since the engine core) that shows, per artifact type, whether it's been
generated and its review progress — collapsing the situational-awareness gap.
It replaces the flat chip picker with a richer board that IS the selector, so
there is one navigation surface, not two.

## Design

- **Read RPC** `deliverable_list_summary(p_protocol_id)` — SECURITY INVOKER +
  STABLE (RLS on protocol_deliverables/blocks is the gate; an inaccessible
  protocol yields an empty array, no existence leak — the get_change_summary
  precedent). Returns a JSON array, one object per EXISTING deliverable:
  {deliverable_id, artifact_type, title, protocol_version, generated_at,
  regenerated_at, generation_seq, total_blocks, reviewed_blocks,
  needs_review_blocks}. Counts exclude rejected blocks and mirror the PDF
  title-block stats (open = draft + needs_review). No new table/enum — read only.
- **Types**: `DeliverableSummary` mirror in src/types/deliverables.
- **Adapter** `adaptDeliverableSummaries` (pure, defensive; drops malformed rows
  and unknown artifact_types via the ARTIFACT_TYPES whitelist-from-labels set).
- **API** `fetchDeliverableSummaries(protocolId): Result<DeliverableSummary[]>`
  (null payload → []; the adapter runs here, never in the component).
- **Component** `DeliverablesOverview` (non-mode, src/components/deliverables/):
  a clickable card grid — one card per configured artifact type, each a tab
  (onSelectType). A card shows the label always; when a summary exists it
  overlays "Generated <date>", a reviewed/total progress bar, and a
  "N need review" chip; ungenerated types read "Not generated yet". Self-managed
  data flow (fetch on mount + refreshKey, fetchToken guard, silent degrade — the
  ActionCardRail precedent). CRITICAL: the board is a working selector even when
  the summary fetch fails (e.g. the RPC isn't deployed yet) — counts are a pure
  enhancement, so nothing breaks pre-migration.
- **Mount** in BOTH the Sponsor Protocol Intelligence tab and the CRA workspace
  (shared non-mode component — same "config over Layer B" reuse as
  DeliverablePanel), replacing each surface's chip picker. Each passes its own
  accent (Sponsor purple / CRA amber) and artifact order (Sponsor all five /
  CRA its two).

## Scope (files allowed)

- `plans/fable/deliverables-overview.md` — this file.
- `supabase/migrations/20260717000000_deliverable_list_summary.sql` — NEW (Approved-by Roger).
- `src/types/deliverables/index.ts` — DeliverableSummary.
- `src/lib/deliverables/deliverablesAdapter.ts` — adaptDeliverableSummaries.
- `src/lib/deliverables/__tests__/deliverablesAdapter.test.ts` — extend.
- `src/lib/deliverables/deliverablesApi.ts` — fetchDeliverableSummaries.
- `src/lib/deliverables/__tests__/deliverablesApi.test.ts` — extend.
- `src/components/deliverables/DeliverablesOverview.tsx` — NEW.
- `src/components/dashboard/sponsor/deliverables/ProtocolIntelligenceTab.tsx` — mount (replace chips).
- `src/components/dashboard/cra/CraWorkspaceShell.tsx` — mount (replace chips).

## Out of scope (files forbidden)

- DeliverablePanel + the export layer + the selection specs (unchanged).
- Any write RPC / new table / enum. Other mode dirs. The generate/review RPCs.

## Architecture layers touched

- [x] migration (read RPC) + RPC
- [x] adapter
- [ ] context (component self-fetches via API, ActionCardRail precedent — no context)
- [x] component (overview board + two mounts)
- [x] test (adapter + API)

## Mock data plan

None.

## Approved-by

- Roger (`supabase/**`) — the read RPC migration. DB→TS mirror satisfied
  (migration + src/types/deliverables in the same diff).
- All other files Fable-owned.

## Verification

- [ ] typecheck / build green; new adapter + API tests pass; zero new full-suite
  failures vs baseline.
- [ ] Migration: pglast parse_sql + parse_plpgsql clean; SECURITY INVOKER; no
  writes; empty-array (not error) for an inaccessible protocol.
- [ ] Manual (enterprise sub): Sponsor + CRA show the board; generated types show
  counts + progress; ungenerated read "Not generated yet"; clicking a card
  selects it and the panel follows; reviewing/generating + switching refreshes
  the counts; a fetch failure still leaves the board a working selector.
- [ ] `/piqc-review` clean (pure adapter, Result<T>, no any, semantic tokens,
  append-only migration, no fetch in the component beyond the API call).

## Decisions encoded

1. **Board replaces the picker** (no duplication) — one navigation surface that
   also carries status, not a chip row plus a status strip.
2. **Read-only RPC, RLS-gated** — INVOKER + empty-array-on-no-access; the board
   never writes; generate stays the panel's job (clicking an ungenerated card
   selects it, the panel shows its Generate CTA).
3. **Counts are an enhancement** — the board is a functional selector even when
   the summary RPC is absent/erroring, so it ships safely ahead of the dev-team
   db push.
