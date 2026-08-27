---
feature: sotr-governance-path-fix
dev: sixonelabs-piqc
status: in-review
created: 2026-08-26
---

# Fix stale `components/dashboard/sotr` paths in governance files

SOTR components live at `src/components/sotr/` (no `dashboard/` segment). Two
governance files still referenced the nonexistent `src/components/dashboard/sotr/`,
silently disabling checks for the real SOTR component directory:

- `docs/CODEOWNERS.md` — the SOTR component rule pointed at the stale path, so
  every file under the real `src/components/sotr/` resolved to no owner in the
  lookups run by `feature-intake` and `piqc-review`.
- `.github/workflows/piqc-discipline.yml` — the cross-mode-imports loop only
  scanned `src/components/dashboard/${domain}`; for `sotr` that directory does
  not exist, so the `[ -d ]` guard silently skipped SOTR components entirely.

`CLAUDE.md` carried the same stale path in the Ownership table and the drawer
reference link.

## Scope

- docs/CODEOWNERS.md
- .github/workflows/piqc-discipline.yml
- CLAUDE.md
- plans/sixonelabs-piqc/sotr-governance-path-fix.md

## Out of scope (files forbidden)

- src/** — no application code changes
- plans/ishika/** — her active plans mention the stale path only in
  "Out of scope" notes; harmless, hers to update
- plans/*/_archive/** — forensic logs, never rewritten

## Architecture layers touched

- None of {migration, RPC, adapter, context, component, test} — governance
  files only.

## Mock data plan

None.

## Approved-by

- @ish-dev-piqc — owns `docs/CODEOWNERS.md`, `CLAUDE.md`, and `.github/`
  (Discipline package). Tag on the PR.

## Verification

- `find src/components -maxdepth 2 -type d -name sotr` prints only
  `src/components/sotr` — confirmed.
- Ran the fixed cross-mode-imports step locally: it now scans
  `src/components/sotr` (plus the same dirs as before) and exits 0 — no latent
  cross-mode imports surfaced, ALLOWED_CROSS_MODE behavior unchanged.
- `grep -rn "dashboard/sotr" CLAUDE.md docs/ .github/ .claude/ scripts/` — no
  remaining stale references in governance files.
