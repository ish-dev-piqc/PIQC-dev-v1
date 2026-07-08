---
owner: sixonelabs-piqc
feature: fable-audit-workflow
status: merged
started: 2026-07-06
merged: 2026-07-08
target_pr: "#451"
---

# Fable Audit Workflow — Phase A tooling

## Context

The team builds in Opus while Fable is rate-limited; Fable reviews the Opus delta to the bar it
would ship. This feature adds the tooling: a strictly read-only `/fable-audit` skill, a separately
gated `/fable-apply` skill, and four narrowly-scoped subagents. Tooling only — no product code.

## Scope (files allowed)

- .claude/skills/fable-audit/
- .claude/skills/fable-apply/
- .claude/agents/

## Out of scope (files forbidden)

- src/
- supabase/
- website/
- .github/

## Architecture layers touched

- [ ] migration (`supabase/migrations/`)
- [ ] RPC (`supabase/functions/` or `.sql`)
- [ ] adapter (`src/lib/*/*Adapter.ts`)
- [ ] context (`src/context/`)
- [ ] component (`src/components/`)
- [ ] test (`src/**/__tests__/`)

None — Claude Code tooling only.

## Mock data plan

none

## Approved-by

- @ish-dev-piqc — for `.claude/**` (Discipline package per docs/CODEOWNERS.md); tag on the PR.

## Verification

- [x] All 11 artifact files exist (5 fable-audit skill files, 2 fable-apply files, 4 agents);
      frontmatter uses confirmed keys (`disable-model-invocation`, `allowed-tools`/
      `disallowed-tools` for skills; `tools`, `disallowedTools`, `model` for agents). Agents
      registered and visible to the Agent tool 2026-07-06.
- [ ] Residual risk (accepted): the orchestrator agent's Bash is restricted to read-only git/grep
      by prose, not by tool allowlist — permission-specifier syntax in agent `tools` is unverified
      on this Claude Code version. Revisit in Phase B with a deny-hook if needed.
- [x] Contracts consistent across files: run-ID format, tier names (T1/T2/T3), severity
      (Blocker/High/Medium/Low), finding schema fields, theme tags (TH*) — 59-agent verify
      workflow, 39 findings fixed, closure grep clean.
- [x] `/fable-audit` path provably read-only (Edit/Write/WebFetch/WebSearch disabled via
      frontmatter; agents Read/Glob/Grep-scoped; prompt forbids mutating Bash).
- [x] Sponsor dry-run 2026-07-06 (`full sponsor`, run FA-ec396aa-ec396aa-0f58acc22ec2): full pipeline
      exercised — preflight/run-ID, haiku triage, 5 reviewers, blind verify, Fable adjudication;
      report carried identity/evidence/coverage/needs-human; zero writes. Verify pattern worked:
      3 candidates → 0 confirmed, 1 needs-human (Portfolio access-model policy). Remaining: exercise
      **delta mode** on the first real Opus feature branch.
