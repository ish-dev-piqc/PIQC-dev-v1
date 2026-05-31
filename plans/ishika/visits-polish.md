---
owner: ish-dev-piqc
feature: visits-polish
status: active
started: 2026-05-31
target_pr:
---

# Visits Polish — Ask rail, Protocol-as-drawer, Visit Prep accuracy

## Context

Three Site-Mode polish items on one branch: (1) the **Ask** tab becomes a persistent, collapsible
right rail available on every Site tab, with in-session per-protocol memory; (2) the **Protocol** tab
becomes a button inside **Visit Prep** that opens a wide right drawer; (3) **Visit Prep accuracy** is
brought up to Protocol's by sourcing visit templates + requirements from the SOTR-deduped winner
(`protocol_extracted_items`, `field_type='visit'`) instead of re-deriving naively from the raw
`schedule_of_events[]` — fixing both the wrong-instance data bug and the false-`high` confidence.

## Scope (files allowed)

- src/components/dashboard/Dashboard.tsx
- src/components/dashboard/site/
- src/components/dashboard/visit-execution/
- src/lib/site/
- src/lib/visit-execution/
- src/types/site/
- src/types/visit-execution/
- supabase/functions/_shared/
- supabase/migrations/

## Out of scope (files forbidden)

- src/lib/sotr/
- src/components/sotr/
- src/components/dashboard/sotr/
- src/lib/audit/
- src/components/dashboard/audit/
- src/context/

## Architecture layers touched

- [x] migration (`supabase/migrations/`) — only if a new column/RPC param is needed; columns `protocol_visit_templates.confidence_state` + `visit_requirements.extracted_item_id` already exist
- [x] RPC (`supabase/functions/` or `.sql`)
- [x] adapter (`src/lib/*/*Adapter.ts`)
- [ ] context (`src/context/`)
- [x] component (`src/components/`)
- [x] test (`src/**/__tests__/`)

## Mock data plan

none. (`piq-visit-execution-mock-v1` toggle already exists and is untouched.)

## Approved-by

- @kiara — `src/components/dashboard/site/`, `src/components/dashboard/visit-execution/`, `src/lib/site/`, `src/lib/visit-execution/`
- @roger — `supabase/functions/_shared/`, `supabase/migrations/` (ingest pipeline)
- shared-infra reviewers — `src/components/dashboard/Dashboard.tsx`

## Verification

- [ ] Ask rail: opens on every Site tab, persists conversation across tab switches + reload (sessionStorage), swaps thread per protocol, remembers open/closed. Audit Chat unaffected.
- [ ] Protocol drawer: "Protocol" button in Visit Prep opens wide drawer w/ full ProtocolTab; ESC/backdrop/swipe/X close it; awaiting-review badge on the button updates after review. No Protocol tab in bar.
- [ ] Visit Prep accuracy: a protocol where Reducto emits a visit twice (inline + SoA) shows the same windows/procedures in Visit Prep as in Protocol's visit section; low-confidence visit shows `low`/`needs_review` (not `high`); Visits row shows the site-local confidence chip.
- [ ] `npm run typecheck`, `npm test`, and a manual app run all green.
