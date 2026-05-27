---
owner: ish-dev-piqc
feature: visit-execution-sprint-6-role-filtered-views
status: merged
merged: 2026-05-27
started: 2026-05-27
target_pr: #145
---

# Visit Execution Workspace — Sprint 6: Role-Filtered Views

## Context

Sixth and biggest step in the founder roadmap (`project_vew_sprint_roadmap.md`):

> **6 — Role-Filtered Views** | Coordinator / Nurse / Investigator / Lab / Pharmacy views.
> **CRITICAL: must render from same canonical protocol logic layer — never separate disconnected worksheets.**

The data model already supports this: `VisitExecutionItem.role_hint: string | null` is parser-emitted free text (`"Coordinator"`, `"Phlebotomy nurse"`, `"Pharmacist + Coordinator"`, etc.). Sprint 6 turns that into a first-class filter lens over the same canonical workspace.

The architecture rule is the load-bearing constraint: **one workspace, five views**. Don't fork data. Don't fork RPCs. Don't fork export pipelines. The filter is a presentation lens applied client-side over the existing packet.

## Scope (files allowed)

Pure helper + tests:
- `src/lib/visit-execution/parseRoleHint.ts` (NEW) — `parseRoleHint(text: string | null): ExecutionRole[]`. Free-text → typed role set. Multi-role hints supported.
- `src/lib/visit-execution/__tests__/parseRoleHint.test.ts` (NEW)

Types:
- `src/types/visit-execution/index.ts` — add `ExecutionRole` union (`'coordinator' | 'nurse' | 'investigator' | 'lab' | 'pharmacy'`), `RoleFilter` (`ExecutionRole | 'all'`), `ROLE_LABELS`, `ROLE_FILTER_OPTIONS`.

Export pipeline (role-aware):
- `src/lib/visit-execution/visitExecutionExportApi.ts` — `buildVisitWorksheetPdf` + `downloadVisitWorksheet` accept optional `roleFilter`. When non-`'all'`: items filtered, filename includes role slug, PDF header shows `Filtered view: <role>`.
- `src/lib/visit-execution/__tests__/visitExecutionExportApi.test.ts` — role-filter cases.

Components (NEW):
- `src/components/dashboard/visit-execution/RoleFilterBar.tsx` (NEW) — chip-strip filter. Default `'all'`. Shows scope hint when filtered.

Components (modified):
- `src/components/dashboard/visit-execution/VisitExecutionTab.tsx` — role filter state; pass to children.
- `src/components/dashboard/visit-execution/ExecutionChecklist.tsx` — accept `roleFilter` prop; apply filter to items before grouping.
- `src/components/dashboard/visit-execution/ExportWorksheetButton.tsx` — accept role filter, pass to API.

Plan:
- `plans/ishika/visit-execution-sprint-6-role-filtered-views.md` (this file)

## Out of scope (files forbidden)

- Backend / RPC / migration — no schema or RPC changes. The filter is client-side over the existing packet.
- `VisitSnapshotCard` — snapshot stats stay canonical-visit-level in v1. RoleFilterBar carries the "X of Y shown" scope hint instead. (Revisit if coordinator feedback wants scoped snapshot stats.)
- `VisitNavigator` — navigator chips stay canonical too. (A future polish could add role-relevance hints per visit.)
- `CompletenessSignalsPanel` + `EditLogDrawer` — signals + audit log are role-agnostic.
- Other 4c/5 surfaces (`RequirementTextDrawer`, `TraceabilityDrawer`) — no role-filter changes.
- All cross-mode (`audit/`, `sotr/`) files — mode isolation.
- All other `src/lib/visit-execution/*` files except the two listed.

## Architecture layers touched

- [ ] migration
- [ ] RPC
- [ ] adapter
- [ ] context
- [x] component (RoleFilterBar new; checklist + tab + export button modified)
- [x] test (parseRoleHint + export-api role cases)

## Mock data plan

None. Existing mock fixtures already populate `role_hint` strings via `mockVisitWorkspace.ts`. Sprint 6 just teaches the UI to filter on them.

## Approved-by

None — all in Ishika's ownership.

## Verification

- [ ] `npm run typecheck` clean
- [ ] `npm run build` clean
- [ ] `npm test` — new `parseRoleHint` test group + extended export-api role tests pass
- [ ] Mock mode: click each chip in the role bar; checklist re-renders to that role's items only. Unscoped items (no `role_hint`) appear under every role. Multi-role items (e.g. "Pharmacist + Coordinator") appear under both. Scope hint "Showing N of M requirements" updates.
- [ ] Mock mode: with a role active, click `Export worksheet` → PDF filename includes role slug; PDF header includes "Filtered view: <role>"; body only contains role-relevant items. "All" exports the full worksheet (current behavior).
- [ ] `piqc-review` clean

## Decisions encoded (don't re-litigate without reading these)

1. **Canonical role enum**: 5 values — `coordinator`, `nurse`, `investigator`, `lab`, `pharmacy`. Lowercase singular, deliberately small. If coordinator feedback surfaces a missing role (e.g., "data manager"), extend the enum; don't fork.

2. **`parseRoleHint` is a pure substring-match.** Lowercases input, checks for each role keyword. Maps:
   - `"coordinator"` / `"coord"` → coordinator
   - `"nurse"` / `"phleb"` → nurse
   - `"investigator"` / `"pi"` → investigator
   - `"lab"` / `"lab tech"` → lab
   - `"pharmacist"` / `"pharmacy"` → pharmacy
   - Anything else / null / `"site staff"` / `"site"` → empty array (unscoped — shows for all roles)

   Substring not word-boundary because real parser output has compound phrases ("Phlebotomy nurse", "Lab tech", "Pharmacist + Coordinator").

3. **Unscoped items show for every role.** If `role_hint` is null OR matches none of the keywords, the item appears under every role filter. Rationale: an unassigned item is a clinical default that any role might need to know about. Hiding it from filtered views would be unsafe.

4. **Snapshot stats stay canonical in v1.** The chip bar carries scope. Snapshot's 3-cell grid (Requirements / Reviewed / To review) describes the WHOLE visit. Future iteration may add a scoped view if coordinators say they want it.

5. **Export takes the active filter as scope.** Filename includes role; PDF header shows "Filtered view: <role>"; body filters. The `'all'` filter is a no-op (current Sprint 5 behavior, no regression).

6. **No URL persistence in v1.** Role filter resets on visit change + page reload. Per-visit filter persistence is decision-debt for Sprint 6.5 if coordinators want it. (Cross-visit role memory in `localStorage` would be the natural store.)

7. **Frontend filter, not RPC parameter.** Same packet, presented differently. Preserves the "one workspace, five views" rule from the founder roadmap. Don't add `p_role` to the export RPC.
