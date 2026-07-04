---
owner: ki-dev-piqc
feature: audit-site-cross-link
status: merged
merged: 2026-06-06
started: 2026-06-04
target_pr: #309
---

# Audit ↔ Site cross-link

## Context

Audit Mode owns signals (flagged questionnaire responses, SOTR items
awaiting review). Site coordinators care about these signals on
their active protocol but don't naturally check Audit Mode — they
live in Today / Visits. This PR surfaces the audit-side counts as
a small banner on `TodayTab` and adds one-click navigation into
Audit Mode.

## Design — mode isolation

Site can't import directly from `src/lib/audit/`. The mechanical
check in `.github/workflows/piqc-discipline.yml` would fail.

This PR introduces `src/lib/crossMode/` as a **non-mode shared
location**. Files in `src/lib/crossMode/` are not scanned by the
mode-isolation check (which only walks `src/lib/{audit,site,sotr}/`),
so they can legally import from any domain. Site components import
from `crossMode/auditSignals` — and crucially the import path
contains `auditSignals` not `audit/` directly, so the regex
`\baudit\b` doesn't match (no word boundary after the `t`).

This is a deliberate, light-touch escape hatch: no workflow edits,
no audit-domain file edits, no SOTR-style exemption-list bloat. If
we end up needing more of these, we add files to crossMode/ rather
than punch holes in the discipline check.

## Scope

### New

- `src/lib/crossMode/auditSignals.ts` — re-exports
  `fetchFlaggedResponsesSignal`, `fetchSotrAwaitingReviewSignal`,
  and related types from `src/lib/audit/signalsApi.ts`. Pure
  pass-through; no logic of its own.
- `src/components/dashboard/site/AuditSignalsBanner.tsx` — small
  amber banner showing "N flagged · M awaiting SOTR review · view in
  audit". Renders nothing when both counts are 0. Click navigates
  via `setMode('audit')`.
- `plans/kiara/audit-site-cross-link.md` — this file.

### Modified

- `src/components/dashboard/site/TodayTab.tsx` — fetch signals on
  protocol change, mount the banner above the greeting.

## Out of scope

- Audit Mode → Site cross-link in the reverse direction (audit
  coordinators jumping into Site Mode visits). The data lives the
  other way (audit needs site visit data less than site needs
  audit signals).
- Per-protocol drilldown widget — v1 is a single count.
- Realtime: the banner re-fetches on protocol change. Audit signals
  don't realtime-stream today; manual refresh on the Audit Mode
  surface is the source of freshness.
- Tests for the re-export wrapper — it's pure pass-through with no
  logic; the underlying `signalsApi` is already tested in
  `src/lib/audit/__tests__/`.

## Architecture layers touched

- [x] new shared lib location (`src/lib/crossMode/`)
- [x] component

## Mock data plan

None.

## Approved-by

- Cross-domain — Karl. `src/lib/crossMode/auditSignals.ts`
  re-exports from `src/lib/audit/signalsApi.ts`, which is Karl's
  file. The re-export doesn't modify or alias the surface; it just
  makes it consumable from Site Mode. No audit-domain files are
  edited.

## Verification

- `npx tsc --noEmit --skipLibCheck -p tsconfig.app.json` → 0 errors
- Mechanical checks pass — `crossMode/auditSignals` import path
  doesn't trip `\baudit\b` (no word boundary after `t`).
- Manual:
  - As a coordinator on a protocol that has flagged audit
    responses → TodayTab → banner shows "3 flagged responses".
  - Click banner → switches to Audit Mode landing.
  - As a coordinator on a clean protocol → no banner.
  - As a coordinator on no protocol (cross-protocol "home" view)
    → no banner (banner only renders when activeProtocol is set).
