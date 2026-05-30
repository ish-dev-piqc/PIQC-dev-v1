---
owner: ki-dev-piqc
feature: typecheck-cleanup
status: active
started: 2026-05-30
target_pr:
---

# Typecheck cleanup — Site Mode + askPrompts.test

## Context

`tsc --noEmit -p tsconfig.app.json` against main reports 22 errors. None block runtime (Vite still builds + serves) but they hide real bugs and erode the typecheck signal. They cluster cleanly by domain:

| Domain | Files | Errors | Owner |
|---|---|---|---|
| Site Mode | `ReportsTab`, `TodayTab`, `VisitsTab`, `TeamFormDrawer`, `askPrompts.test` | 12 | Kiara |
| Audit | `signalsApi.ts` (missing `seenUnknownFieldTypes` identifier) | 2 | Karl |
| Visit Execution | `visitExecutionExportApi*` (`confidence_state` drifted off `VisitWorksheetExportSnapshot`) | 8 | Ishika |

This PR fixes only the 12 in Kiara's domain. Karl and Ishika get separate Slack handoffs for their 10.

## Scope (files allowed)

- `src/lib/site/protocolColors.ts` — loosen `getProtocolColorsById` param type so callers passing `{id, code}[]` (Site Mode picker shapes) typecheck cleanly. Function body already only reads `id` + `code`.
- `src/components/dashboard/site/ReportsTab.tsx` — three `getProtocolColors(protocol)` → `getProtocolColors(protocol.code)` corrections.
- `src/components/dashboard/site/TeamFormDrawer.tsx` — drop unused `protocolId` from the function's destructure (kept in the interface for caller compat).
- `src/lib/site/askPrompts.test.ts` — fixture fixes: add `timezone: null` to the Protocol mock; change `email: null` to `email: ''`.
- `plans/kiara/typecheck-cleanup.md` — this file.

The TodayTab.tsx and VisitsTab.tsx errors resolve as a side-effect of the protocolColors.ts type-loosening; no edits needed in those files.

## Out of scope (files forbidden)

- `src/lib/audit/**` — Karl's domain. The `seenUnknownFieldTypes` not-defined error in `signalsApi.ts:103-104` looks like an incomplete rename; fixing it without understanding the intent could change behaviour.
- `src/lib/visit-execution/**` — Ishika's domain. The `confidence_state` drift off `VisitWorksheetExportSnapshot` could be intentional (callers need to stop passing it) or accidental (type needs the field restored); the right fix needs her decision.
- `src/lib/sotr/**`, `src/lib/orgs/**`, `supabase/migrations/**`, `src/context/**`, `src/lib/entitlements.ts` — all non-Site-Mode.

## Architecture layers touched

- [ ] migration
- [ ] RPC
- [ ] adapter
- [ ] context
- [x] component (3 site/ files)
- [x] test (askPrompts.test.ts)
- [x] util (`src/lib/site/protocolColors.ts`)

No `src/types/` impact.

## Mock data plan

None.

## Approved-by

No cross-domain edits. All files are owned by `@ki-dev-piqc` per CODEOWNERS.

## Design

### `protocolColors.ts` param loosening

`getProtocolColorsById` currently takes `protocols: Protocol[]`. The function body uses only `.id` and `.code`. Several sub-components in TodayTab.tsx + VisitsTab.tsx declare `protocols: { id: string; code: string }[]` as a slim prop shape and pass it in — which fails the typecheck against the full `Protocol[]`.

Fix: tighten the function's param to what it actually uses.

```ts
// before
export function getProtocolColorsById(
  protocolId: string,
  protocols: Protocol[],
): ProtocolColors;

// after
export function getProtocolColorsById(
  protocolId: string,
  protocols: ReadonlyArray<Pick<Protocol, 'id' | 'code'>>,
): ProtocolColors;
```

Backward compatible — `Protocol` is assignable to `Pick<Protocol, 'id' | 'code'>`, so existing callers passing the full type still work.

### ReportsTab `getProtocolColors` corrections

Three sites call `getProtocolColors(protocol)` where `protocol` is a `Protocol` object. The function signature is `getProtocolColors(code: string | null | undefined)`. Change to `getProtocolColors(protocol.code)` at lines 337, 406, 459.

### TeamFormDrawer unused `protocolId`

`protocolId` is destructured from props but never referenced in the function body. The interface keeps the prop so callers don't break. Just drop it from the destructure.

### askPrompts.test fixtures

- `makeProtocol`: add `timezone: null` to match the `Protocol` interface (added recently).
- `makeMember`: change `email: null` to `email: ''`. The `SiteTeamMember.email` type is `string` (not nullable). Also add `added_at: '2026-01-01'` to satisfy the required field (currently inferred only via spread which TypeScript doesn't validate).

## Verification

- [ ] `tsc --noEmit --skipLibCheck -p tsconfig.app.json` reports zero errors in any of: `src/lib/site/`, `src/components/dashboard/site/`, `src/lib/site/askPrompts.test.ts`.
- [ ] Overall error count drops from 22 to 10 (the remaining 2 in `lib/audit/signalsApi.ts` and 8 in `lib/visit-execution/visitExecutionExportApi*`).
- [ ] `npm run dev` / `vite build` succeeds — runtime behaviour unchanged (these were type-only errors).
- [ ] Spot-check the protocol-picker dropdowns and visit rows in Today / Visits / Reports tabs to confirm protocol-color rendering still works.
