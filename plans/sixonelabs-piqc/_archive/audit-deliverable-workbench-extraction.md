---
status: merged
merged: 2026-09-01
owner: sixonelabs-piqc
feature: audit-deliverable-workbench-extraction
target_pr: #581
---

# Audit deliverable workbench extraction — behavior-frozen moves

PR-6 (final) of the pre-D4 quality-hardening train (quality review
2026-08-31). Zero behavior change intended; the proof is the three
existing workspace test suites passing UNCHANGED.

## Problem

Every reusable piece of the deliverable machinery is private to
PreAuditDraftingWorkspace.tsx (2,901 lines) — which is why each new
deliverable kind has cost ~20 files of copy-paste. PR-D4 (Findings
Report, 6th kind, Stage-7 surface) would be the 7th copy. Separately,
the numbered-observation-block rendering exists three times
(ReportDrafting's screen render, FinalReview's buildMarkdown and
buildDocx) with drift already visible.

## Fix (code-only; no migrations; deploy-safe; moves not rewrites)

New `src/components/dashboard/audit/deliverables/`:

- `DeliverableGenerationPanel.tsx` — moved verbatim; `PANEL_NOUNS`
  lookup becomes a `noun` prop, the hardcoded
  `kind === 'confirmation_letter'` recipients line becomes an optional
  `privacyNote` prop (caller supplies it; the caller owns the truth of
  the claim), and the deliverable prop is typed structurally (the
  shared generation fields all five Mock types carry). `kind` is typed
  `DeliverableKind` — the `${kind}-*` data-testids the existing tests
  assert on are preserved byte-for-byte AND a typo'd kind stays a
  compile error, as it was pre-extraction.
- `useDeliverablePersistence.ts` — persistDeliverable +
  reloadAfterStaleApprove + the PR-1 state they drive (savingTabs,
  persistErrors, unsavedDrafts, approveErrors, staleReloadNotices),
  generic over the bundle map: the returned maps are bundle-keyed
  (typo-proof reads, as pre-extraction), persistDeliverable indexes the
  row type by its key (`NonNullable<B[K]>` — a letter row under the
  agenda key is a compile error), and D4's FindingsReport can
  instantiate it later. Exposes `unsavedDraftFor(aid, key)` (precise
  per-key draft reads), `dismissSaveError(key)` (collapses the five
  identical inline closures) and `resetTransient()` (called from the
  workspace's existing audit-switch effect). Load-path state
  (failedKindsByAudit, settledAudits, refreshBundle) stays in the
  workspace — it is bundle-fetch-specific, not per-deliverable.
- `useDeliverableGeneration.ts` — runDeliverableGeneration +
  generatingTab/generationError. Calls the same
  requestDeliverableDraft/applyDeliverableGeneration; the
  letter-recipients merge stays at the call site via an
  `applyOptions()` callback evaluated at apply time (same closure
  semantics as today).
- `useDeliverableResync.ts` — the 4 identical tab effect pairs
  (skip-resync-while-saveError + force-edit-on-saveError) → 1 hook.

New `src/lib/audit/observationGroups.ts` + unit test:

- `buildObservationGroups(entries)` — pure: ordered
  FINDING/OBSERVATION/OPPORTUNITY_FOR_IMPROVEMENT groups, per-group
  1-based numbering, impact/classification labels resolved from
  labels.ts, checkpoint ref, and the source entry (ReportDrafting's
  linked-risk lookup needs it). NOT_YET_CLASSIFIED is excluded by
  design (its screen-only count derives directly from entries).
  Heading LABELS stay per-surface: the screen uses sentence case
  ("Opportunities for improvement"), the exports use title case
  ("Opportunities for Improvement") — deliberate, recorded in the
  module header so nobody "fixes" it.

Consumers rewired, output identical: PreAuditDraftingWorkspace imports
the four moved pieces; ReportDrafting's grouped memo + render loop and
FinalReview's two group loops consume buildObservationGroups.

NOT extracted (recorded so nobody re-litigates): SimpleLetterTab
(rule of three — two users), the TAB_DEFS render loop (indirection
without payoff), ReportDrafting's twin refine branches (the third copy
never arrives — D4 joins the D-engine).

## Scope

- src/components/dashboard/audit/deliverables/DeliverableGenerationPanel.tsx (new)
- src/components/dashboard/audit/deliverables/useDeliverablePersistence.ts (new)
- src/components/dashboard/audit/deliverables/useDeliverableGeneration.ts (new)
- src/components/dashboard/audit/deliverables/useDeliverableResync.ts (new)
- src/lib/audit/observationGroups.ts (new)
- src/lib/audit/__tests__/observationGroups.test.ts (new)
- src/components/dashboard/audit/stages/PreAuditDraftingWorkspace.tsx
- src/components/dashboard/audit/stages/ReportDraftingWorkspace.tsx
- src/components/dashboard/audit/stages/FinalReviewExportWorkspace.tsx
- plans/sixonelabs-piqc/audit-deliverable-workbench-extraction.md

## Out of scope

- supabase/**, contexts, other modes, other stages
- The three workspaces' existing test files — passing UNCHANGED is the
  extraction's correctness proof; editing them would destroy it
- Any behavior change, however small (banner text, testids, log tags,
  label casing all preserved)
- SimpleLetterTab / TAB_DEFS-loop / refine-branch extraction (see above)

## Architecture layers touched

Component (moves), lib (one new pure module), test (one new unit test)

## Mock data plan

None. Test fixtures in __tests__/ only.

## Approved-by

@karl-dev-piqc (audit components + lib)

## Verification

- CI: typecheck + vitest green (first execution — no local Node).
- The three existing workspace suites (PreAuditDrafting 656 lines,
  ReportDrafting 923, FinalReviewExport 471) pass with ZERO diff to
  their files.
- New observationGroups test pins: group order, per-group numbering
  restarting at 1, NOT_YET_CLASSIFIED exclusion, label derivation,
  checkpoint-ref and entry-identity pass-through, empty input → three
  empty groups.
- E2E (user, deployed): Stage 5 tabs save/approve/generate exactly as
  before; Stage 7 findings sections and Stage 8 markdown/docx exports
  render identical content.
