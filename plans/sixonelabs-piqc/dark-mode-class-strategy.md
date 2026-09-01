---
owner: sixonelabs-piqc
feature: dark-mode-class-strategy
status: in-review
started: 2026-09-01
target_pr:
---

# darkMode: 'class' — make `dark:` utilities obey the in-app theme toggle

## Context

`tailwind.config.js` has no `darkMode` key, so Tailwind 3.4.1 defaults to the `media` strategy: every `dark:` utility (140 lines across 32 files) compiles to `@media (prefers-color-scheme: dark)` and follows the **OS**, while `src/context/ThemeContext.tsx` themes the app by toggling `.dark`/`.light` classes on `<html>`. The app is split-brain: `isLight` ternaries obey the toggle; `dark:` utilities obey the OS. SOTR (`src/components/sotr/**`, 56 `dark:` usages, zero `isLight`) does not respond to the theme toggle at all — a user on a dark-mode OS who switches PIQC to light gets a dark SOTR. One config key fixes it; the cost is visual QA, not code.

## Scope (files allowed)

- tailwind.config.js
- plans/sixonelabs-piqc/dark-mode-class-strategy.md

## Out of scope (files forbidden)

- src/index.css (the `html.dark` variable overrides already work; no change needed)
- src/context/ThemeContext.tsx (already toggles the class; no change needed)
- All `src/components/**` (no component edits — this PR changes compile behavior only; any visual fixups discovered in QA get their own scoped follow-up)

## Architecture layers touched

- [ ] migration (`supabase/migrations/`)
- [ ] RPC (`supabase/functions/` or `.sql`)
- [ ] adapter (`src/lib/*/*Adapter.ts`)
- [ ] context (`src/context/`)
- [x] component (`src/components/` — rendering behavior changes; no files edited)
- [ ] test (`src/**/__tests__/`)

## Mock data plan

none

## Approved-by

- @ish-dev-piqc — SOTR is the most affected surface (all 56 `dark:` usages re-point from OS to toggle)

## Verification

Human visual QA in browser — no test asserts rendered theme, so CI cannot prove this change.

- [ ] OS dark + app toggled light → SOTR renders **light** (today it stays dark; this is the bug)
- [ ] OS light + app toggled dark → SOTR renders dark (today it stays light)
- [ ] Walk pure-`dark:` surfaces in both themes: audit/AuditChatPanel, sotr/SourceTruthPanel, sotr/ReviewActionBar, sotr/WorksheetItemsList, visit-execution badges, site/VisitConfidenceChip
- [ ] Walk split-brain files (both `isLight` and `dark:` in one file) for half-themed renders: visit-execution/TimingBanner, VisitSnapshotCard, audit/stages/QuestionnaireReviewWorkspace, StudyOverviewPanel, site/ParticipantProfileDrawer + 12 more
- [ ] `localStorage('piq-theme-v2')` round-trips across reload; first load with nothing stored renders consistent light
- [ ] CI green (typecheck + vitest — first real execution; no local Node)
