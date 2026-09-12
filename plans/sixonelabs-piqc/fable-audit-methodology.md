---
owner: sixonelabs-piqc
feature: fable-audit-methodology
status: active
started: 2026-07-07
target_pr:
---

# Fable audit — methodology playbook (skill companion)

## Context

Documents the model architecture the fable-audit tooling implements, distilled from the real runs
across this platform (Audit-Mode + Deliverables audit, Sponsor dry-run, the 11-bug Site/VEW/SOTR/
context hunt, the Enterprise & Access security review, Phase B tooling). Committed as a skill
companion so the methodology is versioned + shared, and SKILL.md points to it.

## Scope (files allowed)

- .claude/skills/fable-audit/methodology.md
- .claude/skills/fable-audit/SKILL.md (companion-list pointer only)

## Out of scope (files forbidden)

- src/**, supabase/**, website/, any code change

## Architecture layers touched

Documentation only. No code, no tests.

## Mock data plan

none

## Approved-by

- @ish-dev-piqc — .claude/** per docs/CODEOWNERS.md

## Verification

- [x] methodology.md renders as a self-contained playbook (10 sections: modes, model architecture,
      tiers, lenses + "does the server enforce this?", verification doctrine, tooling, apply path,
      flag-don't-force, operational rules, definition of done).
- [x] SKILL.md Companions list references it.
- [ ] doc-only — CI mechanical checks pass trivially (no src/ change).
