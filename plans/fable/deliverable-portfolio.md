---
owner: fable-dev-piqc
feature: deliverable-portfolio
status: active
started: 2026-07-05
target_pr:
---

# Portfolio digest — cross-protocol deliverable status

## Context

The overview board gives per-protocol situational awareness; this zooms out to
the sponsor's portfolio. The Sponsor Protocol Intelligence tab currently picks a
protocol with a bare `<select>` dropdown. This replaces it with an informative
**portfolio grid** — one card per protocol showing its deliverable coverage
(X/5 drafted) + open-review backlog + last activity — so a sponsor sees where
attention is needed across protocols before drilling into one. Stays entirely in
the Fable-owned `sponsor/deliverables/` dir (the Sponsor portfolio PAGE is
Kiara's; this is inside the Intelligence tab). CRA workspace is untouched
(portfolio oversight is a sponsor concept; a monitor works one protocol).

## Design

- **Read RPC** `deliverable_portfolio_summary()` — no arg; SECURITY INVOKER +
  STABLE. One row per protocol that has ≥1 deliverable (RLS on
  protocol_deliverables/blocks is the gate — only accessible protocols count, no
  leak): {protocol_id, deliverable_count (# artifact types generated),
  total_blocks, reviewed_blocks, needs_review_blocks (open), last_generated_at}.
  Grouped by protocol_id over the engine tables only (no coupling to the
  protocols table — the client already has code/name from ProtocolContext).
- **Types**: `DeliverablePortfolioEntry` mirror.
- **Adapter** `adaptDeliverablePortfolio` (pure, defensive; drops rows without a
  protocol_id; number defaults) + **API** `fetchDeliverablePortfolio()`
  (Result<T>, empty/null → []).
- **Component** `DeliverablePortfolioGrid` (Fable-owned sponsor/deliverables):
  takes the protocol list (from context) + active id + onSelect; self-fetches
  the summary (ActionCardRail precedent, token-guarded, silent degrade); merges
  and renders a card per protocol — code/name + "X/5 drafted", a needs-review
  chip, last activity; protocols with no deliverables read "Not started". Active
  card highlighted (Sponsor purple). Clicking selects (drives the same
  overrideProtocolId as the old select). Counts are a pure enhancement — the
  grid is a working picker even if the RPC isn't deployed yet.
- **ProtocolIntelligenceTab**: swap the `<select>` block for the grid; the
  selection model (overrideProtocolId ?? activeProtocol) is unchanged, so the
  board + panel below are untouched.

## Scope (files allowed)

- `plans/fable/deliverable-portfolio.md` — this file.
- `supabase/migrations/20260718000000_deliverable_portfolio_summary.sql` — NEW (Approved-by Roger).
- `src/types/deliverables/index.ts` — DeliverablePortfolioEntry.
- `src/lib/deliverables/deliverablesAdapter.ts` — adaptDeliverablePortfolio.
- `src/lib/deliverables/__tests__/deliverablesAdapter.test.ts` — extend.
- `src/lib/deliverables/deliverablesApi.ts` — fetchDeliverablePortfolio.
- `src/lib/deliverables/__tests__/deliverablesApi.test.ts` — extend.
- `src/components/dashboard/sponsor/deliverables/DeliverablePortfolioGrid.tsx` — NEW.
- `src/components/dashboard/sponsor/deliverables/ProtocolIntelligenceTab.tsx` — swap select→grid.

## Out of scope (files forbidden)

- The Sponsor portfolio PAGE / SponsorPage.tsx (Kiara's) — this lives in the
  Fable-owned Intelligence tab only.
- CRA workspace (portfolio = sponsor oversight; not a monitor concept).
- DeliverablePanel / the board / selection specs / export layer — unchanged.
- Any write RPC / new table / enum.

## Architecture layers touched

- [x] migration (read RPC) + RPC
- [x] adapter
- [x] component (portfolio grid + tab swap)
- [x] test (adapter + API)

## Mock data plan

None.

## Approved-by

- Roger (`supabase/**`) — the read RPC. DB→TS mirror in the same diff. All
  other files Fable-owned.

## Verification

- [ ] typecheck / build green; new adapter + API tests pass; zero new failures.
- [ ] Migration: pglast clean; SECURITY INVOKER; no writes; RLS-gated (empty
  array for a caller with no accessible protocols, no leak).
- [ ] Manual (enterprise sub, multiple protocols): the tab shows a portfolio
  grid; each card shows X/5 drafted + needs-review + last activity; protocols
  with no deliverables read "Not started"; clicking a card selects it and the
  board/panel follow; a fetch failure still leaves the grid a working picker.
- [ ] `/piqc-review` clean (pure adapter, Result<T>, no any, semantic tokens,
  component fetches via API not supabase, append-only migration).

## Decisions encoded

1. **Grid replaces the select** — a richer picker that also carries portfolio
   status; same selection model underneath (no board/panel change).
2. **Engine-tables-only RPC** — no coupling to the protocols table; the client
   supplies code/name from context, the RPC supplies deliverable stats.
3. **Sponsor-only** — portfolio oversight is a sponsor concept; CRA untouched.
4. **Counts are an enhancement** — the grid works as a plain picker even before
   the RPC is deployed.
