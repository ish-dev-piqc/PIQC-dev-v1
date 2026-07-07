---
owner: sixonelabs-piqc
feature: fable-phase-b-manifest
status: active
started: 2026-07-06
target_pr:
---

# Fable audit Phase B — deterministic manifest + gates inventory

## Context

Phase B of the approved fable-audit plan (deferred until the toolchain was proven; the
scratchpad-node workaround unblocked it). Replaces the audit's grep-based, best-effort scope
discovery with a deterministic engine: TS-AST consumer graph, changed-export detection, owner
resolution from docs/CODEOWNERS.md, CI-gate inventory, T1/T2/T3 tiering, and a fail-closed run
identity — so a run without identity can never look like a clean run.

## Scope (files allowed)

- scripts/fable-audit-manifest.mjs
- scripts/fable-audit-gates.mjs
- scripts/lib/fableAudit.mjs
- scripts/__tests__/fableAudit.lib.test.ts
- package.json (two npm scripts only)
- vitest.config.ts (one include line)
- .claude/skills/fable-audit/SKILL.md (Phase 0 wiring)

## Out of scope (files forbidden)

- src/** (no product code)
- supabase/**, website/

## Architecture layers touched

None (tooling). Plain .mjs — runs on any node ≥18 with zero build step and zero new
dependencies (uses the repo's own `typescript` package for AST work).

## Mock data plan

none

## Approved-by

- @ish-dev-piqc — .claude/** (skill wiring) per docs/CODEOWNERS.md; scripts/ is unowned.

## Verification

- [x] 14 unit tests green (codeowners parse/longest-prefix, exported-symbol extraction incl.
      default-export semantics, reverse-import graph incl. unresolved dynamic imports,
      risk tiers, digest stability, gates RULE_MAP ↔ workflow sync lock)
- [x] Empirical vs real history: manifest of #458 → T2 with exact removed exports
      (persistAdapterOutput …) + correct consumers/owners; manifest of #451→#453 → T3 on the
      ISA migration; empty delta → T1/0 files; bogus ref → JSON error, exit 1 (fail closed)
- [x] gates CLI green vs the live workflow (all 14 steps mapped, none missing/unmapped)
- [x] full suite 1343 passed + 1 pre-existing skip; tsc unaffected (scripts outside tsconfig)

## Deferred (Phase B items 8–9)

Seeded-defect benchmark (precision/recall) and CI checks for skill frontmatter/no-write
guardrails — separate follow-up, needs a fixture corpus decision.
