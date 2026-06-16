---
owner: ish-dev-piqc
feature: demo-visit-prep-carbon-copy
status: merged
merged: 2026-06-16
started: 2026-06-16
target_pr: #373
---

# Demo Visit Prep = carbon copy of prod RPC output

## Context

Demo Visit Prep looked nothing like prod because demo served a thin synthetic mock while prod builds rich workspaces from the real `visit_execution_get_workspace` RPC over the parsed protocol (visit_requirements + conditional rules + timing + source fields + completeness signals + linked extracted-item confidence). Per request, demo should be a **carbon copy** of prod — hardcode if needed.

The RPC is auth-gated (`auth.uid()`), so it can't be called with a service key. Instead the prod output was **reconstructed from its source tables** (read via service role, matching the exact RPC field mapping in `20260624000000_visit_execution_get_workspace_order_fix.sql`) for the 3 demo protocols, remapped to the demo alias ids, and snapshotted into a generated fixture.

Captured: PP06489 → 12 visits / 247 items; CLR_18_06 → 12 / 160; ND-L02-s0201-005 → 9 / 25.

## ⚠️ Note on contents

The fixture contains **real parsed protocol content** (visit requirements, source-section quotes) from the PledOx / K0706 / ND-L02 protocols — real sponsor IP, shipped in the demo bundle. This is a deliberate choice (carbon copy) approved by the owner. No participant PHI is present (visit-execution data is protocol design, not patient data).

## Approach

- `src/lib/visit-execution/demoVisitWorkspaces.generated.ts` — generated snapshot: `Record<demoProtocolAliasId, VisitExecutionWorkspace[]>`, matching the `VisitExecutionWorkspace` TS type exactly (tsc-verified). Static; not re-fetched.
- `src/lib/visit-execution/mockVisitWorkspace.ts` — reduced to a thin lookup returning `DEMO_VISIT_WORKSPACES[protocolId] ?? []`. The previous synthetic curated/generic builders are deleted (dead).
- `isMockEnabled()` already treats Demo Mode as mock-on (prior PR #371), so demo sessions get this fixture.
- Tests updated to the real-data contract: confidence_state may be null; visits may have 0 items (protocol totals are non-empty); completeness-signal shape validated generically.

## Scope (files allowed)

- src/lib/visit-execution/demoVisitWorkspaces.generated.ts
- src/lib/visit-execution/mockVisitWorkspace.ts
- src/lib/visit-execution/__tests__/visitExecutionApi.test.ts

## Out of scope (files forbidden)

- src/lib/visit-execution/visitExecutionApi.ts (mock gating already correct)
- src/components/dashboard/visit-execution/
- supabase/ (no schema change)

## Architecture layers touched

- [x] test (`src/**/__tests__/`)
- visit-execution lib fixture (`src/lib/visit-execution/`)

## Mock data plan

Demo fixture is a captured snapshot of real RPC output (not a new toggle). Activated by the existing `piq-demo-active-v1` demo seam.

## Approved-by

- n/a — all under `/src/lib/visit-execution/` (Ishika). (Heads-up only: fixture embeds real protocol content — owner-approved.)

## Verification

- [x] `tsc --noEmit` exit 0; all visit-execution tests pass (162).
- [ ] Demo user, toggle on: Visit Prep for all 3 protocols renders the same rich content as prod (visits, phases, conditional rules, timing, source fields, completeness signals).
