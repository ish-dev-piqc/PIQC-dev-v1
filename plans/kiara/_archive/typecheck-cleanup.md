---
owner: ki-dev-piqc
feature: typecheck-cleanup
status: merged
merged: 2026-05-30
started: 2026-05-30
target_pr: #180
---

# Typecheck cleanup — Site Mode + askPrompts.test + low-risk cross-domain fixes

## Context

`tsc --noEmit -p tsconfig.app.json` against main reports 22 errors. None block runtime (Vite still builds + serves) but they hide real bugs and erode the typecheck signal. They cluster cleanly by domain:

| Domain | Files | Errors | This PR? |
|---|---|---|---|
| Site Mode | `ReportsTab`, `TodayTab`, `VisitsTab`, `TeamFormDrawer`, `askPrompts.test` | 12 | ✓ (own domain) |
| Audit | `signalsApi.ts` (missing `seenUnknownFieldTypes` declaration) | 2 | ✓ (mechanical fix; @karl-dev-piqc Approved-by) |
| Site Mode types | `src/lib/site/types.ts` — `VisitCrossReference.document_id?: string` should allow `null` per its own self-documenting comment | 0 direct, fixes 2 Ishika test errors as a side effect | ✓ (own domain; fixes Ishika's `visitExecutionAdapter.test.ts` errors as a side effect) |
| Visit Execution | `visitExecutionExportApi*` (`confidence_state` drifted off `VisitWorksheetExportSnapshot`) | 6 | ✓ Story A (restore the Sprint 7 confidence surface — Ishika's audio gave us latitude and the right product call is to keep showing PIQC's confidence to coordinators; the fix for low confidence is improving extraction quality, not hiding the indicator) |

This PR fixes all 22 errors. The `confidence_state` cluster resolves via Story A — restoring `confidence_state` + `completeness_signal_count` to `VisitWorksheetExportSnapshot`, adding `confidence_state` to `VisitWorksheetExportRow` (for the per-item PDF column), keeping the `deriveVisitConfidence` call + PDF rendering + Sprint 7 tests. The function gracefully derives from per-item confidence when server-stamped snapshot confidence is null (the documented Sprint 4 decision-debt #2 bridge), so the surface works today even before the export RPC is updated to populate the new fields.

## Scope (files allowed)

- `src/lib/site/protocolColors.ts` — loosen `getProtocolColorsById` param type so callers passing `{id, code}[]` (Site Mode picker shapes) typecheck cleanly. Function body already only reads `id` + `code`.
- `src/lib/site/types.ts` — widen `VisitCrossReference.document_id?: string` → `string | null` to match its own self-documenting comment ("null = same doc that produced SoA"). Purely additive; existing callers passing strings remain valid.
- `src/components/dashboard/site/ReportsTab.tsx` — three `getProtocolColors(protocol)` → `getProtocolColors(protocol.code)` corrections.
- `src/components/dashboard/site/TeamFormDrawer.tsx` — drop unused `protocolId` from the function's destructure (kept in the interface for caller compat).
- `src/lib/site/askPrompts.test.ts` — fixture fixes: add `timezone: null` to the Protocol mock; change `email: null` to `email: ''`; add missing `added_at`.
- `src/lib/audit/signalsApi.ts` — **cross-domain (Karl)**. Add the missing `const seenUnknownFieldTypes = new Set<string>();` module-level declaration. The file's own comment at L87-89 documents the intent ("Module-level set; never drained… log-once dedup not a leak"); the declaration was deleted by mistake and left the two usages orphaned. Mechanical fix.
- `plans/kiara/typecheck-cleanup.md` — this file.

The TodayTab.tsx and VisitsTab.tsx errors resolve as a side-effect of the protocolColors.ts type-loosening. The 2 `visitExecutionAdapter.test.ts:91,97` errors resolve as a side-effect of the `document_id` widening. No edits needed in those files.

## Out of scope (files forbidden)

- `src/lib/visit-execution/deriveVisitConfidence.ts` — the source helper stays as-is; Ishika may reuse it in her rewrite.
- `src/lib/sotr/**`, `src/lib/orgs/**`, `supabase/migrations/**`, `src/context/**`, `src/lib/entitlements.ts` — all non-Site-Mode/Audit/Visit-Execution-export and not in our cleanup target.

## Cross-domain scope additions (after Ishika's audio confirmation + Kiara's product call)

Ishika confirmed by audio that the `confidence_state` removal was deliberate ("I didn't want people to know we weren't very confident") and gave latitude ("you can do whichever one feels right because I am working on that feature right now"). Kiara made the product call: **don't hide the indicator while underlying per-item confidence is being improved — the coordinator handing the worksheet off needs to know PIQC's confidence (Sprint 7's original intent) and the right path to "high confidence" is improving extraction, not removing the signal.**

- `src/types/visit-execution/index.ts` — restore `confidence_state: VisitConfidenceState | null` and `completeness_signal_count: number` on `VisitWorksheetExportSnapshot`. Add `confidence_state: VisitConfidenceState | null` on `VisitWorksheetExportRow` for the per-item PDF column. Comment block updated to explain why these fields are kept on the export shape (Sprint 7 PDF surface).
- `src/lib/visit-execution/visitExecutionExportApi.ts` — restore the `deriveVisitConfidence(packet.snapshot, filteredItems)` call at line 519, restore the "PIQC confidence: …" PDF rendering block. Restore `CONFIDENCE_SHORT_LABELS` / `deriveVisitConfidence` imports. Add the two new snapshot fields + per-item `confidence_state` to the demo-mode packet builder so demo exports show real values.
- `src/lib/visit-execution/__tests__/visitExecutionExportApi.test.ts` — restore the Sprint 7 confidence-visibility test group. Update the test fixture's snapshot and items to include the new required fields (`confidence_state: 'high'` on fixture items as a sensible default; `confidence_state: null` + `completeness_signal_count: 0` on the snapshot to exercise the derived-from-items fallback).

## RPC update — surfaced in this PR (was originally deferred)

The export RPC `visit_execution_export_worksheet` in `supabase/migrations/20260617000000_visit_execution_export_rpc.sql` didn't previously populate the confidence fields. To make Story A end-to-end (types AND real-mode data flow), we add a new migration that `CREATE OR REPLACE`s the function with the same name + signature, extending the packet:

- `supabase/migrations/20260618001000_visit_execution_export_rpc_confidence_fields.sql` (NEW)
  - `snapshot.confidence_state` ← `protocol_visit_templates.confidence_state` (NULL today; LLM passes populate it later)
  - `snapshot.completeness_signal_count` ← `COUNT(*) FROM visit_completeness_signals WHERE visit_template_id = t.id AND resolution = 'pending'`
  - Per-item `confidence_state` ← `protocol_extracted_items.confidence_state` via `LEFT JOIN` on `visit_requirements.extracted_item_id` (NULL when the requirement was created via signal promotion rather than ingest extraction)

No new columns are added — both source columns already exist (`protocol_visit_templates.confidence_state` from `20260615000000_visit_templates_add_purpose.sql`; `protocol_extracted_items.confidence_state` pre-existing). This is purely a function-body change exposing already-stored data.

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

- `@karl-dev-piqc` — for the one-line `seenUnknownFieldTypes` Set declaration in `src/lib/audit/signalsApi.ts`. The file's existing inline comment documents the variable's intent; the fix restores what was clearly removed in an incomplete edit. Flag Karl on the PR.
- `@ish-dev-piqc` — for the Visit Execution Story A fixes. Ishika confirmed by audio (2026-05-30) that her removal of `confidence_state` from `VisitWorksheetExportSnapshot` was deliberate ("I didn't want people to know we weren't very confident") and gave explicit latitude ("you can do whichever one feels right because I am working on that feature right now"). Kiara took the product call to restore the indicator: the Sprint 7 design ("the coordinator handing off the worksheet should KNOW PIQC's confidence") matches PIQC's review-first ethos, and hiding the signal while extraction confidence is being improved would treat a symptom. Flag Ishika on the PR — her in-progress rewrite can adjust further if she disagrees, but the restored types + render are additive over what she had.
- `@rv61` — for the new export-RPC migration `20260618001000_visit_execution_export_rpc_confidence_fields.sql`. `supabase/migrations/` is Roger's domain. The migration is a pure `CREATE OR REPLACE` of an existing function with no schema additions and no removed fields — purely additive at the JSON level. Flag Roger on the PR.

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

- [ ] `tsc --noEmit --skipLibCheck -p tsconfig.app.json` overall error count drops from 22 to **0**.
- [ ] `npm run dev` / `vite build` succeeds — runtime behaviour unchanged (these were type-only errors, plus the restored Set declaration which now actually dedupes warn-logs as the comment promised).
- [ ] Spot-check: trigger a SOTR field-type drift (set a field_type value that isn't in `SOTR_FIELD_TYPE_LABELS`) — the console should warn once per novel value, not on every render. Confirms the Set-based dedup is doing its job.
- [ ] Spot-check the protocol-picker dropdowns and visit rows in Today / Visits / Reports tabs to confirm protocol-color rendering still works.
