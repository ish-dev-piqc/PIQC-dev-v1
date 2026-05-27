---
owner: ish-dev-piqc
feature: visit-execution-sprint-7-confidence-visibility
status: merged
merged: 2026-05-27
started: 2026-05-27
target_pr: #147
---

# Visit Execution Workspace — Sprint 7: Quality / Trust / UX Hardening (v1 — Confidence Visibility)

## Context

Founder roadmap's seventh and final step. The roadmap bullets cover a wide surface:

> **7 — Quality, Trust, UX Hardening** | Confidence indicators, missing-requirement detection, conflicting-requirement warnings, amendment/version comparison, completeness checks, empty/error states | Pending

That's bigger than one PR. Sprint 7 v1 scopes to the **highest-leverage subset** — visit-level + per-item **confidence visibility end-to-end** — for these reasons:

1. **Foundation already laid.** `confidence_state` exists on `protocol_extracted_items` (since SOTR) and on `VisitExecutionItem.confidence_state` + `VisitSnapshot.confidence_state` (since Sprint 3.5a). Sprint 7 closes the loop by surfacing it in the UI + export.
2. **The honest agentic signal that earns trust.** Per `feedback_vew_completeness_and_mastery.md` Principle 1, "Confidence indicators are not optional polish — they're a primary trust mechanism." Without visible confidence, the coordinator can't tell which visits PIQC is shaky on.
3. **Missing-requirement detection already shipped** (Sprint 3.5b + 4c). That bullet in the roadmap is done.
4. **Smallest safe change.** No backend changes — derives visit-level confidence client-side from existing item-level data. Empty/error states already polished through Sprint 6.

Deferred to Sprint 7.5 / Sprint 8 (decision-debt encoded below):
- Conflicting-requirement warnings (needs new detection logic in ingest pipeline)
- Amendment / version comparison (needs diff UI; separate sprint scope)
- Reducto per-field confidence wiring (`protocol_visit_templates.confidence_state` populated server-side — currently always NULL)

## Scope (files allowed)

Pure helper + tests (NEW):
- `src/lib/visit-execution/deriveVisitConfidence.ts`
- `src/lib/visit-execution/__tests__/deriveVisitConfidence.test.ts`

Component (NEW):
- `src/components/dashboard/visit-execution/VisitConfidenceBadge.tsx`

Components (modified):
- `src/components/dashboard/visit-execution/VisitSnapshotCard.tsx` — render confidence chip when non-'high'
- `src/components/dashboard/visit-execution/VisitNavigator.tsx` — per-visit confidence dot (always shown for triage)
- `src/components/dashboard/visit-execution/ExecutionChecklist.tsx` — per-item confidence flag (only `low` / `needs_review`)

Export:
- `src/lib/visit-execution/visitExecutionExportApi.ts` — add visit + per-item confidence to PDF
- `src/lib/visit-execution/__tests__/visitExecutionExportApi.test.ts` — extended tests

Plan:
- `plans/ishika/visit-execution-sprint-7-confidence-visibility.md` (this file)

## Out of scope (files forbidden)

- Backend / RPC / migration changes (no schema or ingest changes — derivation is client-side)
- `src/lib/visit-execution/parseRoleHint.ts` — Sprint 6 surface, untouched
- `RoleFilterBar`, `ExportWorksheetButton`, `RequirementTextDrawer`, `TraceabilityDrawer`, `CompletenessSignalsPanel`, `EditLogDrawer`, `TimingBanner` — no Sprint 7 changes
- Cross-mode (`audit/`, `sotr/`) files — mode isolation
- Conflicting-requirement detection / amendment-comparison / orphan-row handling — separate sprint
- Per-mock-fixture confidence_state value tweaks — fixtures already populate this field

## Architecture layers touched

- [ ] migration
- [ ] RPC
- [ ] adapter
- [ ] context
- [x] component (new VisitConfidenceBadge; snapshot card / navigator / checklist gain a confidence surface; export builder gains confidence visibility)
- [x] test (pure helper + extended export-api role/confidence cases)

## Mock data plan

None. Mock fixture already populates `VisitExecutionItem.confidence_state` per Sprint 3.5a's curated values. Sprint 7 just surfaces what's already there.

## Approved-by

None — all in Ishika's ownership.

## Verification

- [ ] `npm run typecheck` clean
- [ ] `npm run build` clean
- [ ] `npm test` — new `deriveVisitConfidence` test group + extended export-api confidence tests pass
- [ ] Mock mode: visit navigator shows a per-visit confidence dot (color-coded green/blue/amber/rose) before each visit name; eye can scan-triage which visits are shaky.
- [ ] Mock mode: snapshot card shows a confidence chip in the attention-chip row **only when** the derived confidence is non-`'high'` (cognitive-load discipline — quiet on the boring case, loud on the alarm).
- [ ] Mock mode: checklist rows with `confidence_state in ('low', 'needs_review')` carry a small flag chip after the classification badge.
- [ ] Mock mode: exporting a worksheet → PDF title block carries the visit-level confidence; autotables include a per-item confidence column.
- [ ] Real-data path: verified against a protocol with mixed per-item confidence_states (mock-fixture-shaped).
- [ ] `piqc-review` clean

## Decisions encoded (don't re-litigate without reading these)

1. **Derivation is client-side ("weakest link").** When `snapshot.confidence_state` is populated, trust the server. Otherwise: derive from items + completeness signals. Pessimistic rule — any `'needs_review'` item drops the visit to `'needs_review'`; any `'low'` drops to `'low'`; presence of pending completeness signals demotes from `'high'` to `'medium'` (gaps suggest moderate confidence). This is the right safety default: PIQC under-claims rather than over-claims.

2. **Cognitive-load discipline on visibility.** Per polish v2 and `feedback_vew_cognitive_load_test.md`: only rare-but-loud states earn filled chips. `'high'` confidence on the snapshot is the EXPECTED baseline — no chip. `'medium'` is informational — text-only. `'low'` and `'needs_review'` are alarms — filled chips. Same discipline on item rows.

3. **Navigator dot ALWAYS visible.** Different rule from snapshot card — navigator is a triage surface where coordinators scan-decide which visit to open. A green dot on a confident visit is a POSITIVE signal worth showing. The 6px dot doesn't crowd the row.

4. **Role-filter scope.** Visit-level confidence respects the active role filter. If a coordinator filters to Nurse, the visit confidence is derived from the Nurse-relevant items only (consistency with the rest of the workspace). The deriveVisitConfidence helper takes the already-filtered items as input — keeping it pure.

5. **Export carries confidence end-to-end.** Title block gets a small "Confidence: <state>" line near the protocol-code label. Autotables include a per-item confidence column (rightmost). Drives the print artifact's honesty about what PIQC is sure about.

6. **VisitConfidenceBadge is VEW-namespaced.** SOTR's old ConfidenceBadge was removed in post-#106 cleanup; mode isolation says we don't import from sotr/ anyway. Building a fresh VEW-local badge is correct.

## Deferred to Sprint 7.5 / Sprint 8

1. **Backend ingest populates `protocol_visit_templates.confidence_state`** (currently NULL on first ingest per Sprint 4 decision-debt #2). Once that lands, the derivation helper's "trust server" branch fires and the client-side derivation becomes a fallback.

2. **Conflicting-requirement warnings.** Needs new detection logic — likely an ingest LLM pass comparing per-visit requirement sets for contradictions ("PK sample required AND PK sample not required"). Out of scope for v1.

3. **Amendment / version comparison.** Diff UI showing "Amendment 2.1 added these 3 items, removed these 2." Needs versioned-snapshot reads + a new drawer. Separate Sprint 8.

4. **Confidence-aware export filename** (e.g., `_low-confidence` suffix). Could mislead — a draft is a draft regardless. Not adding.

5. **Confidence-based sort in navigator.** Currently visits sort by study_day. Sorting by confidence (lowest first) would surface attention items but breaks the temporal mental model. Decision-debt — revisit if coordinator feedback wants it.
