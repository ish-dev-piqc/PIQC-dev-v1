---
owner: ki-dev-piqc
feature: audit-signals-multi-surface
status: merged
merged: 2026-06-13
started: 2026-06-13
target_pr: #347
---

# Audit signals — surface beyond TodayTab

## Context

`AuditSignalsBanner` (PR 100) renders a slim amber bar with flagged-
response + SOTR-awaiting-review counts for the active protocol —
mounted only in `TodayTab`. A user landing on VisitsTab or
ParticipantsTab gets no signal until they switch tabs.

This PR mounts the same banner at the top of `VisitsTab`,
`ParticipantsTab`, and `ReportsTab` so the signal is visible wherever
the user is working within a protocol scope.

Out of scope: per-visit chips on individual visit rows. That would
need a new per-visit lookup RPC (`audit_flagged_responses_for_visit`)
+ crossMode re-export + a new chip component. Defer to a follow-up
once we have a real customer asking for visit-level precision.

## Design

Each tab gets one line at the top of its existing scrollable body:

```tsx
<AuditSignalsBanner protocolId={activeProtocol.id} />
```

The banner self-hides when both counts are 0, so this is a
zero-cost add when there's nothing to surface. Vertical spacing
follows the existing `space-y-5` pattern in each tab.

## Scope (files allowed)

### New

- `plans/kiara/audit-signals-multi-surface.md` — this file.

### Modified

- `src/components/dashboard/site/VisitsTab.tsx` — mount banner.
- `src/components/dashboard/site/ParticipantsTab.tsx` — mount banner.
- `src/components/dashboard/site/ReportsTab.tsx` — mount banner.

## Architecture layers touched

- [x] component

No data-layer changes. The banner already calls
`fetchFlaggedResponsesSignal` + `fetchSotrAwaitingReviewSignal` on
mount; adding three more callsites means three extra fetches when
the user navigates between tabs, which is fine.

## Mock data plan

None.

## Approved-by

Self (Site Mode).

## Verification

- `npx tsc --noEmit --skipLibCheck -p tsconfig.app.json` → 0 errors
- Manual:
  - With a protocol selected that has flagged responses → banner
    visible at the top of Today, Visits, Participants, Reports tabs.
  - Banner click in any tab → switches to Audit Mode.
  - Banner self-hides on protocols with zero signals.

## Mechanical checks

- Mode isolation: imports through `crossMode/auditSignals` (existing
  pattern, no regex hit).
- No `.channel(` outside `src/context/`.
- No `@supabase/supabase-js` imports in components — none added.
- No `: any` in `src/lib/**`.
- Plan MD referenced in PR body.
