---
owner: fable-dev-piqc
feature: protocol-awareness-layer
status: in-review
started: 2026-07-08
target_pr:
---

# Protocol Awareness Layer (v1) — "What PIQC noticed"

## Context

PIQC already *computes* proactive observations about a parsed protocol (primary
endpoints needing source-data verification, visits with ≤2-day scheduling
tolerance, an amendment in force, low-confidence extractions) — but they are
buried: collapsed into one travel action-card's rationale string
(`action_cards_sync`), or reduced to an audit-mode-only dot (`usePiqcSignals`).
No cross-mode, ranked, itemized "here is what PIQC noticed about this protocol,
each with its evidence" surface exists. This is Pillar B of the Living Protocol
(reactive → proactive). v1 splits those buried observations into individual,
ranked, evidence-linked **notice cards**, mounted at the top of the SOTR
parse-review drawer where they sit next to the evidence they cite and are
visible now (owner-scoped, no entitlement gate).

**Not a new "PIQC suggested" surface.** The notice rail reuses the shipped
`ActionCardRail` anatomy (self-fetching ambient strip, silent-with-signal, one
click to dismiss, evidence chips) and the audit-signals doctrine
(derived-not-invented, low false-positive tolerance, theme = field value not
LLM inference). It is a **sibling of the Action Layer, not an extension of it**:
notices are observations ("what I saw"), action cards are warm handoffs to
external systems ("go do this there"). Keeping them separate preserves the
action layer's booking/link-out semantics and prevents a third competing
surface (non-negotiable #4).

**Design pass reserved for the powerful model (flagged, not pre-decided here):**
the final extend-vs-sibling call, the notice **taxonomy**, the **ranking**
function, and the "it noticed" provenance voice are resolved in the Fable design
pass *before* the migration SQL is written. This plan locks scope + the sibling
hypothesis; it does not lock the predicate/ranking internals.

## Scope (files allowed)

Each bullet is a bare path/glob so the scope-check hook can match it; the
rationale sits on the indented lines beneath (the hook only reads `- ` lines).

- `plans/fable/protocol-awareness-layer.md`
  - this plan.
- `supabase/migrations/2026072*_protocol_notices.sql`
  - new, append-only. Sibling `protocol_notices` table + `protocol_notices_sync`
    (DEFINER, `user_can_access_protocol` first-line gate, reads owner-gated SOTR
    fact tables exactly as `action_cards_sync` does), `protocol_notices_get`
    (INVOKER), `protocol_notice_set_status` (INVOKER).
- `supabase/migrations/2026072*_protocol_notices_lowconf_wording.sql`
  - new, append-only. fable-audit FA-160a358-9c899fe-bf434f6051b5 finding M1
    (confirmed, high): rewords the `low_confidence_extraction` notice's detail
    string only (drops "awaiting review", which collided with the drawer's
    review_status-based chip) via `CREATE OR REPLACE FUNCTION
    protocol_notices_sync`. No predicate/logic change. **No type impact** —
    string literal only, `NoticeRecord.detail` is already `string`.
- `src/types/actions/index.ts`
  - add the `NoticeRecord` / `NoticeType` / sync + status result mirrors
    alongside the existing `ActionCardRecord` (same non-mode types module; DB→TS
    mirror).
- `src/lib/actions/actionsApi.ts`
  - add `syncNotices` / `fetchNotices` / `setNoticeStatus` `Result<T>` wrappers
    (mirror the action-card wrappers).
- `src/lib/actions/actionsAdapter.ts`
  - pure notice packet → `NoticeRecord` mapper (no supabase import).
- `src/lib/actions/__tests__/`
  - adapter + api-shape tests (mirror existing).
- `src/lib/actions/__tests__/*`
  - individual test files under the actions test dir.
- `src/components/actions/NoticeRail.tsx`
  - non-mode, mirrors `ActionCardRail` (self-fetch, token-guarded, self-hiding,
    dismiss).
- `src/components/actions/NoticeCard.tsx`
  - non-mode, mirrors `ActionCard` (pure presentation, evidence-count chip).
- `src/components/actions/__tests__/`
  - rail/card render + silent-with-signal tests.
- `src/components/actions/__tests__/*`
  - individual test files under the actions component test dir.
- `src/components/sotr/SourceTruthListDrawer.tsx`
  - the ONE mount: render `<NoticeRail protocolId={studyId} />` above
    `<WorksheetItemsList>` (studyId IS protocol_id). **Ishika's file.**
- `docs/CODEOWNERS.md`
  - add the missing Fable-block lines for the action layer (`/src/lib/actions/`,
    `/src/types/actions/`, `/src/components/actions/`). **Ishika owns this file.**

## Out of scope (files forbidden)

- `src/lib/audit/signalsApi.ts`, `src/hooks/usePiqcSignals.ts`,
  `src/components/dashboard/audit/PiqcDock.tsx` — the audit signals surface stays
  as-is (mode isolation; no cross-import, no re-home).
- `supabase/migrations/*_protocol_action_cards.sql` and any existing merged
  migration (append-only).
- `src/lib/entitlements.ts`, the deliverable engine, and every gated
  Sponsor/CRA surface — this feature is visible-now and touches none of it.
- `src/components/sotr/WorksheetItemsList.tsx` and the per-item SOTR drawers —
  the mount adds a sibling rail above the list, it does not modify the list.
- The SOTR extraction pipeline / schema — notices read existing facts only; no
  new extraction (multi-hop edges remain a dev-team concern).
- Any second mount host — one SOTR mount in v1.

## Architecture layers touched

- [x] migration (`supabase/migrations/`)
- [x] RPC (`.sql`)
- [x] adapter (`src/lib/actions/actionsAdapter.ts`)
- [ ] context
- [x] component (`src/components/actions/`, one SOTR mount)
- [x] test

## Mock data plan

None.

## Approved-by

- @rv61 — `supabase/migrations/` (new `protocol_notices` migration).
- @ish-dev-piqc (Ishika) — `src/components/sotr/SourceTruthListDrawer.tsx` (the
  mount) and `docs/CODEOWNERS.md` (the action-layer ownership lines).

## Verification

- [x] Unit: notice adapter (partial-null tolerance, evidence passthrough,
  severity-last fallback), api Result<T> shape, NoticeRail silent-with-signal
  (loading → null, zero notices → null, dismiss → refetch), NoticeCard
  evidence-count chip + no-link-out. 43 tests green; typecheck + lint clean.
- [ ] SQL: `protocol_notices_sync` first-line `user_can_access_protocol` gate
  (non-member → 42501), derived-only rationale (no scores/dates fabricated),
  re-sync never resurrects a dismissed notice, `_get` empty-not-null.
- [ ] Manual (as protocol owner): open the SOTR source drawer from Audit/Site/VEW
  → the notice rail renders above the item list with ranked notices + evidence
  chips → dismiss one (stays gone across re-open) → a protocol with no notable
  facts renders no rail (self-hiding, no empty box).
- [ ] `/piqc-review` clean: scope, mode-isolation (NoticeRail is non-mode, no
  audit-signals import), pure adapter (no supabase), Result<T> in api, no `any`
  in `src/lib/**`, append-only migration, DB→TS mirror, semantic Tailwind tokens.
