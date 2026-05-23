---
feature: site-d-e-followups
owner: ishika
status: merged
merged: 2026-05-23
target_pr: #97
created: 2026-05-19
---

# Site Mode — D/E follow-ups (bundled)

Cluster of small, mostly-component-level polish items from §11 of
`goal-complete-production-greedy-thunder.md`. Bundled into one branch /
one PR because each item is small (60–250 LOC), they touch overlapping
surfaces (TodayTab, Reports, AskTab, UploadForm), and shipping them
separately would burn more review time than the work itself.

## Items

- **D2 — Team cert-expiry alerts on dashboard.** Lift `isCertExpired` /
  `isCertExpiringSoon` from TeamTab to `dateUtils.ts`. Add a band above the
  Needs Attention strip in TodayTab listing team members whose certs are
  expired or expiring within 30 days. Clicking jumps to TeamTab.
- **D1 — Reports PDF export.** Add a "Export PDF" button next to the
  existing "Export CSV" in ReportsTab. Client-side render via `jspdf` +
  `jspdf-autotable`. Same data shape as the CSV export.
- **D3a — Rule-based dynamic Ask prompts.** Today AskTab has 4 hard-coded
  prompts per protocol code. Replace with a rule engine that derives 4
  prompts from `protocol.clinical_trial_phase` + presence/absence of
  visit templates + team-member roles. No LLM call. D3b (LLM-generated
  prompts) explicitly out of scope.
- **D4 — UploadForm picker polish.** When invoked from inside Protocol
  tab, the protocol picker dropdown is redundant (we already know which
  protocol to attach to). Hide the picker and show a "Attaching to
  &lt;CODE&gt;" line instead.
- **E1 — Cross-document references in visit drawer.** Schema + ingest
  hooks for `cross_document_references` already exist; nothing reads
  them. Wire VisitDetailDrawer to fetch cross-refs for the visit's
  procedures and show them in a collapsible "Related documents"
  section.
- **E2 — Site-mode smoke tests.** Extend `scripts/smoke-rpcs.sh` with
  T41–T48 covering: createProtocol, createParticipant + delete,
  createVisit + update, createTeamMember + delete, setAnchorDate,
  materializeVisits.

## Out of scope

- D3b — LLM-based prompt generation. Deferred.
- E3 — embedded PDF viewer. Deferred.
- F1 — admin UI for `is_demo_user`. Deferred.
- Any new RPC or migration. All items are pure client + script work
  except E1 which reads an existing table.

## Scope (files this branch may touch)

- `src/lib/site/dateUtils.ts` (extend)
- `src/lib/site/dateUtils.test.ts` (extend)
- `src/components/dashboard/site/TeamTab.tsx` (collapse local helpers)
- `src/components/dashboard/site/TodayTab.tsx` (cert banner)
- `src/components/dashboard/site/ReportsTab.tsx` (PDF export)
- `src/components/dashboard/site/AskTab.tsx` (rule-based prompts)
- `src/components/dashboard/site/VisitDetailDrawer.tsx` (cross-refs)
- `src/components/dashboard/UploadForm.tsx` (picker hide)
- `src/lib/site/siteApi.ts` + repos (read cross-refs)
- `src/lib/site/repos/types.ts` + `realSiteRepo.ts` + `demoSiteRepo.ts`
- `scripts/smoke-rpcs.sh`
- `package.json` (`jspdf`, `jspdf-autotable`)
- `plans/ishika/site-d-e-followups.md` (this file)

## Architecture layers touched

- {component, util, script}. No migration, no new RPC.

## Mock data plan

None. Demo mode picks up the new behavior automatically because every
new helper either lives in pure utils (`dateUtils`) or is rendered from
data already in the repo abstraction.

## Approved-by

Self-owned: `src/lib/site/`, plan MD.

Cross-mode touch: `src/components/dashboard/UploadForm.tsx` is shared
infra — small, additive change (one prop). Will tag Karl/Roger on the
PR per CODEOWNERS.

## Verification

- D2: set a team member's cert to today+10d → banner appears on TodayTab.
- D1: open Reports → click "Export PDF" → PDF downloads with the same
  stats and tables as the CSV.
- D3a: switch active protocol to a Phase 1 study → AskTab prompts shift
  to Phase-1-flavoured language.
- D4: open Protocol tab → click "Upload PDF" → picker is hidden, "Attaching
  to BRIGHTEN-2" is shown.
- E1: open a visit drawer with at least one cross-doc reference → "Related
  documents" expander shows entries.
- E2: `bash scripts/smoke-rpcs.sh` exits 0 and includes T41–T48 lines.
