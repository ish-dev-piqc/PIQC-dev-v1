---
owner: ki-dev-piqc
feature: sponsor-mode-v2
status: merged
merged: 2026-06-13
started: 2026-06-13
target_pr: #349
---

# Sponsor mode v2 — protocol drill-in drawer

## Context

Sponsor v1 (PR #339) shipped the portfolio cards but the "View details"
button was a stub. This PR lights that button up — clicking opens a
read-only drawer with deeper info for the selected protocol.

## Design

### What the drawer shows

For one selected protocol from the user's portfolio:

1. **Header** — protocol code + title, site-org name.
2. **Visit activity (last 30 days)** — counts by status: scheduled,
   completed, missed, deviation, overdue. Rendered as 5 stat cards.
3. **Enrollment** — participant counts by status (screening, active,
   completed, withdrawn, screen_failure) as a horizontal stacked bar
   with a legend.
4. **Recent deviations** — last 10 visits where `status = 'deviation'`,
   showing date + participant code + visit name + deviation_reason
   preview. No PII beyond the pseudo-anonymous participant_code.

No actions — read-only. Team contacts and message-the-site-lead are
intentionally deferred to v3 because they require cross-org member
visibility decisions that aren't in scope for this PR.

### Data path

New RPC `get_sponsor_protocol_detail(p_protocol_id UUID)`:

- SECURITY DEFINER (sponsor_relationships has no RLS read policy).
- Verifies caller is in an org with a sponsor_relationships row for
  this protocol's owner_org. Raises insufficient_privilege if not.
- Returns JSONB with the three buckets so the client adapter can
  shape it once.

JSONB return chosen over a multi-result-set so the client gets one
network round-trip and one adapter call.

### Drawer plumbing

`SponsorProtocolDrawer` is a slide-in right pane (mirroring the
DocumentPreviewPane pattern). `SponsorPage` adds `useState` for the
selected protocolId and wires the card's button to open it.

Mobile: full-screen drawer (same `sm:w-[480px]` breakpoint).

## Scope (files allowed)

### New

- `plans/kiara/sponsor-mode-v2.md` — this file.
- `supabase/migrations/20260704001100_get_sponsor_protocol_detail.sql`
  — new RPC.
- `src/components/dashboard/sponsor/SponsorProtocolDrawer.tsx` — drawer.

### Modified

- `src/types/sponsor/index.ts` — add `SponsorProtocolDetail` and the
  three sub-shapes.
- `src/lib/sponsor/sponsorApi.ts` — add `getSponsorProtocolDetail`.
- `src/lib/sponsor/sponsorAdapter.ts` — add adapter for the JSONB.
- `src/lib/sponsor/__tests__/sponsorApi.test.ts` — test new endpoint.
- `src/lib/sponsor/__tests__/sponsorAdapter.test.ts` — test new adapter.
- `src/components/dashboard/sponsor/SponsorPage.tsx` — wire button +
  drawer state.

## Architecture layers touched

- [x] migration
- [x] RPC
- [x] adapter
- [x] API layer
- [x] component

## Mock data plan

None.

## Approved-by

- Roger (`supabase/migrations/*`)
- Self (sponsor)

## Verification

- `npx tsc --noEmit --skipLibCheck -p tsconfig.app.json` → 0 errors
- `npx vitest run src/lib/sponsor` → all tests passing
- Manual:
  - With a user in a sponsor org → portfolio loads. Click "View
    details" on a card → drawer slides in with visit counts +
    enrollment bar + recent deviations.
  - With zero deviations → deviations section shows an empty-state.
  - User without sponsor access tries to call the RPC directly →
    returns insufficient_privilege.
  - Esc / backdrop / X close the drawer.

## Mechanical checks

- Mode isolation: sponsor.
- No `.channel(` outside `src/context/`.
- No `@supabase/supabase-js` imports in components.
- Adapter is pure.
- `Result<T>` API layer.
- Migration is append-only.
- No `: any` in `src/lib/sponsor/**`.
- Sibling tests for the new endpoint + adapter (extending existing
  files in `__tests__/`).
- Plan MD referenced above.
