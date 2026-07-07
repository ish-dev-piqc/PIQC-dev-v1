---
owner: fable
feature: fa-38bbb03-38bbb03-23e5de6f8d9d-apply
status: merged
merged: 2026-07-07
started: 2026-07-07
target_pr: #470
---

# Fable apply — FA-38bbb03-38bbb03-23e5de6f8d9d (Site Mode war-game audit)

## Context

Applies the 14 approved findings from the Site Mode full-surface audit per
approval-FA-38bbb03-38bbb03-23e5de6f8d9d.md, in 4 owner-batched PRs
(batch 1 site · batch 2 context 2-reviewer · batch 3 shared hook · batch 4 TodayTab split).
This single plan covers the union so the whole queue runs under one active plan.

## Scope (files allowed)

- src/components/dashboard/site/ReportsTab.tsx            # 901 902 903
- src/lib/site/repos/realSiteRepo.ts                      # 802
- src/lib/site/repos/types.ts                             # 802
- src/components/dashboard/site/ProtocolRequiredGate.tsx  # 501
- src/components/dashboard/site/TodayTab.tsx              # M3 201 (batch 1) · 203 (batch 4)
- src/components/dashboard/site/ProtocolDetailDrawer.tsx  # 102
- src/components/dashboard/site/AnchorDateModal.tsx       # 101
- src/components/dashboard/site/VisitsTab.tsx             # 301
- src/components/dashboard/site/ParticipantsTab.tsx       # 301
- src/App.tsx                                             # 301 (shared-infra seam, Approved-by below)
- src/context/SiteDataContext.tsx                         # 801 601 (batch 2)
- src/hooks/useOverlay.ts                                 # M2 (batch 3)
- src/hooks/__tests__/useOverlay.test.tsx                 # M2 locking test (new)
- src/components/dashboard/site/__tests__/ProtocolRequiredGate.test.tsx  # 501 locking test (new)
- src/components/dashboard/site/*.tsx                     # batch 4 pure-move extraction targets
- src/context/__tests__/SiteDataContext.refreshStability.test.tsx  # 601/801 assertions if shape changes

## Out of scope (files forbidden)

- website/
- supabase/                     # no migrations in this apply
- src/lib/site/reportsExport.ts # 903 excluded_path — CSV fix lives in ReportsTab only
- src/lib/site/calendarExport.ts
- src/lib/entitlements.ts
- src/hooks/useSwipeDismiss.ts
- .claude/

## Architecture layers touched

- [ ] migration — none
- [ ] RPC — none
- [ ] adapter — none
- [x] context (`src/context/SiteDataContext.tsx`, batch 2)
- [x] component (`src/components/dashboard/site/**`, `src/App.tsx`)
- [x] test (new locking tests + assertions broken by shape changes)

## Mock data plan

none

## Approved-by

- @ki-dev-piqc — src/components/dashboard/site/**, src/lib/site/** (batches 1, 4)
- @ish-dev-piqc @ki-dev-piqc — src/context/** (batch 2, 2-reviewer), src/App.tsx (301 seam),
  src/hooks/useOverlay.ts (batch 3, shared hook — 24 consumers)

## Verification

- [ ] 901: seed/spot-check — every VisitStatus lands in exactly one Reports bucket; overdue counted
- [ ] 902: todayStr derived via local-date parts (formatYmd); no toISOString date in ReportsTab
- [ ] 903: CSV cell starting with =,+,-,@ emitted with apostrophe prefix
- [ ] 802: all realSiteRepo fetches paginate past 1000 rows (.range loop)
- [ ] 501: gate renders null while ProtocolContext.isLoading; test locks it
- [ ] M3: openVisit re-syncs by id when allSiteVisits changes; closes if row disappears
- [ ] 201: CalendarEmptyBanner suppressed while loading && empty
- [ ] 102/101: both overlays adopt useOverlay (+useSwipeDismiss for the drawer); ad-hoc Esc removed
- [ ] 301: pending keys cleared on read; payload stamped {id, protocolId, ts} with TTL
- [ ] 801: cross-protocol loop aggregates failures into error state (batch 2)
- [ ] 601: realtime refresh debounced (batch 2)
- [ ] M2: Esc closes topmost overlay only; regression test (batch 3)
- [ ] 203: pure-move split of TodayTab inline components (batch 4)
- [ ] npm run typecheck · npm run lint · npm run test — via scratchpad node (no node on PATH)
- [ ] /piqc-review clean before each PR
