---
status: active
owner: sixonelabs-piqc
feature: audit-stage5-persist-honesty
target_pr: TBD
---

# Audit Stage-5 persist honesty — silent data-loss fix

PR-1 of the pre-D4 quality-hardening train (quality review 2026-08-31).

## Problem

Stage-5 deliverable saves fail silently. `persistDeliverable` reverts the
optimistic row on a failed upsert (deliberate and latch-correct — unsaved
content must never render as saved, or a later Approve would CAS-latch text
the reviewer never wrote) but the only failure signal is a `console.error`.
With the internal-notification / evidence-gap-summary migrations not yet
applied in prod, every save on those two tabs destroys typed content with no
user-visible signal. Additionally `fetchPreAuditDeliverables` swallows
per-table errors, so a failed read renders a scratch form over real server
data — and the prefill bootstrap fires on that false "all missing" state.

## Fix (code-only; no migrations; no edge-fn changes; deploy-safe)

- Per-tab `persistErrors` / `savingTabs` state in PreAuditDraftingWorkspace
  (follows the `advanceStageError` precedent in AuditContext).
- New invariant: Approve is disabled while a save is in flight or the last
  save failed — closes the phantom-id approve race and the CAS-safety hole.
- `persistDeliverable`: revert semantics unchanged; failures now set a banner
  ("your text is preserved in the editor"), tabs keep local draft state
  (resync effect skips while a save error is pending). Approve failures split
  on `errorHint`: STALE_CONTENT keeps today's reload plus an informational
  note; every other failure banners without a reload-overwrite.
- `fetchPreAuditDeliverables` returns `{ bundle, failedKinds }`; failed kinds
  render an honest could-not-load state instead of a scratch form; prefill
  bootstrap and Stage-8 currency computation are suppressed on partial
  failure; `generateAllStubs` failures banner instead of vanishing.

Honesty note: prod's notification/gap tabs currently lose data silently;
after this PR they fail visibly (banner, content preserved, approve blocked)
until the migration stack is applied. Dishonest-broken → honest-degraded.

## Scope

- src/lib/audit/preAuditApi.ts
- src/components/dashboard/audit/stages/PreAuditDraftingWorkspace.tsx
- src/components/dashboard/audit/stages/FinalReviewExportWorkspace.tsx
- src/lib/audit/__tests__/preAuditApi.test.ts
- src/components/dashboard/audit/stages/__tests__/PreAuditDraftingWorkspace.test.tsx
- src/components/dashboard/audit/stages/__tests__/FinalReviewExportWorkspace.test.tsx
- plans/sixonelabs-piqc/audit-stage5-persist-honesty.md

## Out of scope

- supabase/** (no migrations, no edge functions)
- src/lib/audit/deliverableGenerationApi.ts
- Vendor-enrichment / questionnaire / intake load paths (PR-2 of the train)
- src/context/** (2-reviewer shared infra; not needed)
- All other modes (site, sotr)

## Architecture layers touched

component, API (return-shape change, no new fetch), test

## Mock data plan

None. Test mocks in __tests__/ only.

## Approved-by

@karl-dev-piqc (audit components + lib/audit)

## Verification

- CI: typecheck + vitest green (first execution — no local Node).
- New tests pin: upsert-failure banner + approve disabled + editor content
  preserved (prev-exists and first-save cases); approve STALE_CONTENT reloads
  with note; approve non-stale failure banners without overwrite; in-flight
  save blocks approve; `fetchPreAuditDeliverables` maps per-kind errors to
  `failedKinds`; prefill suppressed when any kind failed; FinalReview currency
  suppressed on partial failure.
- Grep self-check: no remaining silent `persisted ?? prev` path without an
  accompanying error-state write.
- E2E (user, deployed — reproducible today against the missing RPCs): save on
  the internal-notification tab → banner appears, typed text stays in the
  editor, Approve is disabled; after the backend partner applies the
  migration stack the banners clear with no code change.
