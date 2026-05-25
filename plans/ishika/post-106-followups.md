---
owner: ish-dev-piqc
feature: post-106-followups
status: in-review
started: 2026-05-25
target_pr: 110
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
- `src/components/dashboard/Dashboard.tsx` — Account settings rework: split `fullName` into first/last name, add read-only `Organization` (from `user_profiles.organization`), swap timezone free-text for `<select>` over the shared `TIMEZONE_OPTIONS`, remove the Password section + handler + state, remove Security from nav + render
- `src/components/Navbar.tsx` — remove the Security menu items (desktop + mobile) since the Security section is gone; drop now-unused `Shield` import
- `src/lib/timezones.ts` (NEW) — extract `TIMEZONE_OPTIONS` so AnchorDateModal + Dashboard share the curated IANA list
- `src/components/dashboard/site/AnchorDateModal.tsx` — switch to importing the shared `TIMEZONE_OPTIONS`

## Out of scope (files forbidden)

- The edit path of `TeamFormDrawer` — must keep working.
- `src/components/sotr/ReviewActionBar.tsx` — Accept-for-Draft copy stays as-is.
- The `SettingsSection` type's `'security'` enum member — keeping it as a no-op fallback for any stale URLs; deleting it would force the Dashboard switch to be exhaustive, which is more churn than the user asked for.
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

- **@ki-dev-piqc** (Kiara) — `src/components/dashboard/site/TeamFormDrawer.tsx`, `src/components/dashboard/site/AnchorDateModal.tsx` (Site Mode).
- Shared infra (`src/context/`, `src/components/Navbar.tsx`, `src/components/dashboard/Dashboard.tsx`, `src/lib/timezones.ts`) requires 2 reviewers per CODEOWNERS — Kiara + one other suffices.
- `src/components/sotr/*` — Ishika owns directly.

## Verification

- [ ] Worksheet list row for a visit item renders as "Visit Name — Day N (±Xd · M procedures)" (no regression).
- [ ] Click "View Source" on a visit row → drawer header shows the same semantic label, not JSON.
- [ ] No `<ConfidenceBadge>` chips visible in either the list row or the drawer.
- [ ] Team tab → "New team member" → drawer shows the static "Contact PIQC…" message; no form fields.
- [ ] Team tab → "Edit" on an existing member → full form still renders + submit still works.
- [ ] Navbar user menu → "Account" → renders first name, last name, title (editable); organization, email (read-only); timezone (dropdown with the curated IANA list). Save updates the user_metadata fields.
- [ ] Navbar user menu (both desktop dropdown and mobile sheet) does not show a "Security" entry.
- [ ] Account section does not render the Password form.
- [ ] AnchorDateModal timezone picker still works (regression check on the shared `TIMEZONE_OPTIONS`).
- [ ] `npx tsc --noEmit -p .`, `npx vite build`, relevant `vitest run` are clean.
- [ ] `/piqc-review` locally + CI `piqc-discipline.yml` passes.
