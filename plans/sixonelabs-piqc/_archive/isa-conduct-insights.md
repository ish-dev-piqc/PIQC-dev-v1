---
owner: sixonelabs-piqc
feature: isa-conduct-insights
status: merged
started: 2026-07-19
target_pr: 502
merged: 2026-07-19
---

# ISA conduct insights — S2.5 of the notes → findings → report arc

## Context

S1/S2 (PRs #498/#500) gave `ISA_CONDUCT` the pad and the finding writer. S2.5 adds the three zero-LLM insight surfaces from the arc spec (`plans/fable/isa-notes-finding-writer-fable-pass.md`): a **coverage strip** (15 domains × has-notes/has-findings — catches the auditor's blind spot before the auditee does), the **escalation tripwire** (the templates' accumulation rules firing live, advisory-only per D-008), and the **closing-meeting view** (findings grouped by severity + positive observations — the preliminary-findings presentation the templates describe, generated from data already on screen).

## Scope (files allowed)

- src/lib/audit/isaInsights.ts
- src/lib/audit/__tests__/isaInsights.test.ts
- src/components/dashboard/audit/stages/investigator/IsaClosingMeetingView.tsx
- src/components/dashboard/audit/stages/investigator/IsaConductWorkspace.tsx

## Out of scope (files forbidden)

- supabase/** (no schema, no functions — everything derives from already-fetched data)
- src/lib/audit/isaNotesApi.ts, src/lib/audit/isaFindingsApi.ts
- src/components/dashboard/audit/stages/AuditConductWorkspace.tsx (vendor lane)
- src/hooks/useOverlay.ts (consumed, not modified)

## Architecture layers touched

- [ ] migration
- [ ] RPC
- [ ] adapter
- [ ] context
- [x] component (`src/components/`)
- [x] test (`src/lib/audit/__tests__/`)

## Mock data plan

none

## Approved-by

- @karl-dev-piqc — src/lib/audit/, src/components/dashboard/audit/

## Verification

- [ ] `tsc --noEmit -p tsconfig.app.json` clean; vitest green (isaInsights unit tests)
- [ ] Coverage strip: domains with findings render filled, notes-only tinted, untouched muted; untagged count shows; clicking a chip sets the capture form's domain tag
- [ ] Tripwire: 3+ Minor findings in one domain surfaces the accumulation advisory (and 2+ Major → Critical); advisory only — no writes, no severity changes
- [ ] Closing-meeting view: opens from the Findings header, groups by severity, includes positive observations, ESC/backdrop closes, focus returns
