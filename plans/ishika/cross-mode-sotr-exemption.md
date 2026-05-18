---
owner: ish-dev-piqc
feature: cross-mode-sotr-exemption
status: in-review
started: 2026-05-18
target_pr: 86
---

# Cross-mode rule: allow public SOTR widgets

## Context

The `piqc-discipline` workflow's cross-mode-imports check (added in PR #83) is too strict. It forbids `audit → sotr` and `site → sotr` imports, but `src/components/dashboard/sotr/` already exposes UI widgets (`WorksheetItemsList`, `WorksheetItemRow`, `SourceTruthDrawer`, `SourceTruthListDrawer`) and a types module (`src/types/sotr/`) that audit and site mode legitimately render inline. The framework never ran on main, so the violations were invisible until PR #85's first CI run surfaced them all.

Two intentional integration points exist today on main:
- **Audit Mode** Stage 6 (`AuditWorkspaceShell.tsx`) and intake/conduct workspaces (`RiskTaggingForm.tsx`, `AuditConductWorkspace.tsx`) import the SOTR drawers + `formatExtractedValue` + `ExtractedItemRecord` to show parsed protocol items alongside risk tags.
- **Site Mode** Protocol tab (`ProtocolTab.tsx`) imports `WorksheetItemsList` to render the schedule-of-events parsed items.

These are SOTR's public UI surface. The rule needs an allowlist that names them explicitly, so accidental cross-domain imports still trip the check but the four intentional ones don't.

## Scope (files allowed)

- `.github/workflows/piqc-discipline.yml`
- `plans/ishika/cross-mode-sotr-exemption.md`

## Out of scope (files forbidden)

- Any `src/` file. This is a CI-only fix; no application code changes.
- Other workflow checks in the same file (raw Tailwind colors, supabase-in-components, etc).
- CODEOWNERS, CLAUDE.md, or other discipline-framework docs — separate concerns.

## Architecture layers touched

- [ ] migration
- [ ] RPC
- [ ] adapter
- [ ] context
- [ ] component
- [ ] test
- [x] CI workflow (mechanical-checks job in piqc-discipline.yml)

## Mock data plan

None. CI-only change.

## Approved-by

None required. The workflow file isn't listed in CODEOWNERS; it falls through to no required reviewer. Conceptually @ish-dev-piqc owns the discipline framework, which is the author of this PR.

## Verification

- [ ] Locally run the modified cross-mode check on the current main tree: zero failures (the four pre-existing intentional imports now pass via the allowlist).
- [ ] Locally simulate an accidental cross-mode import (e.g. `src/components/dashboard/site/foo.tsx` importing from `audit/`): the check still fails as expected.
- [ ] On PR open, the workflow runs against this branch and the cross-mode check passes.
- [ ] After merge, re-run CI on PR #85 (feat/site-demo-mode) — its cross-mode check now passes too.
