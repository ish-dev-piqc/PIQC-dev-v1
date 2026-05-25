---
owner: ish-dev-piqc
feature: post-106-followups
status: active
started: 2026-05-25
target_pr:
---

# Post-#106 follow-ups — drawer-header visit render, team-form gut, drop confidence chip

## Context

PR #106 (merged + on prod main) shipped 20+ post-ingest UX fixes. Verifying on the live dashboard surfaced three loose ends:

1. **Schedule-of-events visits still render as raw JSON inside the SOTR drawer header**, even though the worksheet list row itself renders semantically. The PR-106 `formatVisit` helper is wired into `WorksheetItemRow` (list-row path) but not into the drawer-header path — `WorksheetItemsList.tsx` passes `itemLabel={formatExtractedValue(active.extracted_value)}` to the drawer, which falls back to JSON for object-shaped values.
2. **Team-tab "New team member" drawer collects fields PIQC doesn't actually self-serve yet.** Replace the *create* path's form with a short message; edit path stays functional so existing members can still have their cert dates updated.
3. **The high / medium / low / needs_review confidence chip is opaque.** Remove the chip everywhere — the at-a-glance signal isn't worth the confusion right now. The `ReviewStatusBadge` already covers the "has this been reviewed" signal.

Small follow-up PR — three targeted changes, no migration, no schema work.

## Scope (files allowed)

- `plans/ishika/post-106-followups.md` (this plan)
- `src/components/sotr/WorksheetItemRow.tsx` — extract + export `getItemDisplayLabel(item)`; remove `<ConfidenceBadge>` render + import
- `src/components/sotr/WorksheetItemsList.tsx` — use `getItemDisplayLabel` for drawer `itemLabel`
- `src/components/sotr/SourceTruthPanel.tsx` — remove `<ConfidenceBadge>` render + import
- `src/components/sotr/ConfidenceBadge.tsx` — delete (no remaining production consumers)
- `src/components/sotr/__tests__/ConfidenceBadge.test.tsx` — delete (test of deleted component)
- `src/components/dashboard/site/TeamFormDrawer.tsx` — guard form body + submit on `mode === 'edit'`; `mode === 'create'` shows static "Contact PIQC…" message

## Out of scope (files forbidden)

- The edit path of `TeamFormDrawer` — must keep working.
- `src/components/sotr/ReviewActionBar.tsx` — Accept-for-Draft copy stays as-is.
- `supabase/migrations/**`, `supabase/functions/**`, Audit Mode files.

## Architecture layers touched

- [ ] migration
- [ ] RPC
- [ ] adapter
- [ ] context
- [x] component (`src/components/sotr/`, `src/components/dashboard/site/TeamFormDrawer.tsx`)
- [ ] test (deletion only)

## Mock data plan

None. UI-only render changes on existing real data.

## Approved-by

- **@ki-dev-piqc** (Kiara) — `src/components/dashboard/site/TeamFormDrawer.tsx` (Site Mode form rework).
- `src/components/sotr/*` — Ishika owns directly.

## Verification

- [ ] Worksheet list row for a visit item renders as "Visit Name — Day N (±Xd · M procedures)" (no regression).
- [ ] Click "View Source" on a visit row → drawer header shows the same semantic label, not JSON.
- [ ] No `<ConfidenceBadge>` chips visible in either the list row or the drawer.
- [ ] Team tab → "New team member" → drawer shows the static "Contact PIQC…" message; no form fields.
- [ ] Team tab → "Edit" on an existing member → full form still renders + submit still works.
- [ ] `npx tsc --noEmit -p .`, `npx vite build`, relevant `vitest run` are clean.
- [ ] `/piqc-review` locally + CI `piqc-discipline.yml` passes.
