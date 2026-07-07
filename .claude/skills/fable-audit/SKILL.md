---
name: fable-audit
description: Read-only Fable review of the Opus-built delta across Audit / Sponsor / Deliverables / CRA / shared surfaces. Emits an evidence-backed decision — Approve / Approve with upgrades / Block — with independently verified findings and an apply-eligible set. Never edits code; remediation goes through /fable-apply against a human approval record.
argument-hint: "[audit|sponsor|deliverables|cra|all | full <surface>] [--base <ref>]"
disable-model-invocation: true
disallowed-tools: Edit, Write, NotebookEdit, WebFetch, WebSearch
---

# /fable-audit — read-only, downstream-aware review of the Opus delta

The team builds in Opus; Fable reviews. This skill converts "would Fable build and approve this?"
into a repeatable, evidence-backed decision with downstream impact, ownership, blind verification,
and a safe remediation path. It is **strictly read-only**: no edits, no staging, no commits, no DB
mutation, no network/MCP. Fixes are applied only by `/fable-apply` against an approval record.

## Goal & success criteria

**Goal:** for every material Opus change on an audited surface, decide **Approve / Approve with
upgrades / Block**, backed only by findings that survived blind verification.

Done when:
1. Run identity exists — run ID bound to base SHA + head SHA + scope digest.
2. Every changed contract on a T2/T3 path was reviewed with its direct consumers, or the edge is
   explicitly labeled `unresolved` — never silently assumed safe.
3. Every finding in the confirmed table is `confirmed` by a blind verifier; refuted and
   CI-duplicate candidates are dropped from the report (kept in telemetry). `low` candidates are
   never verified — they may appear only in the clearly-labeled "Unverified low upgrades" section,
   never in the confirmed table, and never affect the decision.
4. The report follows `report-template.md`: decision, coverage, macro verdict, ranked findings,
   needs-human (≤3), apply set, non-findings.
5. Zero writes happened.

Every non-approval carries: violated rule/contract · reproducible evidence · downstream consumers
(or an explicit "none found") · severity + confidence + owner · smallest safe fix with
`allowed_paths` · the validation command that confirms the repair.

## Arguments

`/fable-audit [surface] [--base <ref>]` — surface ∈ `audit | sponsor | deliverables | cra | all`
(default `all`), or `full <surface>` to review an entire surface regardless of delta authorship.
Base defaults to `main`. Empty delta and no `full` → report "no delta" and stop.

**Model routing:** if this session's model is not Fable, do not run the phases inline — spawn
`fable-audit-orchestrator` (model: fable) with the requested arguments and relay its report.

## Phase 0 — Preflight & run identity (deterministic, before any agent)

Read-only git only:
- `base_sha=$(git merge-base HEAD <base>)` · `head_sha=$(git rev-parse HEAD)` ·
  dirty check `git status --porcelain`.
- Delta = `git diff <base>...HEAD --name-only` ∩ baseline globs in `surfaces.md` (these include
  `supabase/migrations/**` — the T3 migration trigger must be reachable). Drop only the explicit
  denylist: `website/**`, `landing.html`, `plans/**`, `.claude/**`, `docs/**` are never the subject.
- Digest = sorted changed-file list → `shasum -a 256`, first 12 hex.
- **Run ID:** `FA-<base_sha:7>-<head_sha:7>-<digest:12>`. Stamp it on everything.
- Report identity extras: skill-rev = `git log -1 --format=%h -- .claude/skills/fable-audit`;
  models = the agent-frontmatter aliases (haiku / sonnet / sonnet / fable), plus resolved IDs when
  the platform reports them.

**Full runs (`full <surface>`):** there is no diff. File list = `git ls-files` ∩ that surface's
globs; digest over that sorted list; tiers from the path-trigger table only (T2 = exported symbol
with consumers outside its file, found by grep). Triage and reviewers receive hotspot-weighted
file/section assignments instead of hunks, and every prompt must state "full-surface run — no
diff hunks".

**Consumer discovery (best-effort, grep):** for each changed file / exported symbol, grep `src/`
for importers (by module basename and by exported name). Label barrel, dynamic, and string-built
imports `unresolved`. Never write "none found" unless the search ran and returned nothing.

**Risk tier per changed path** (triggers table in `surfaces.md`):
T1 internal-only → triage-selected lenses. T2 changed export/type/route/RPC signature with ≥1
consumer → producer + all direct consumers. T3 entitlements / migrations / provenance / ModeContext
/ auth / cross-mode / PHI-adjacent → all applicable lenses + Fable adjudication. **A T3 change
cannot receive Approve while any of its consumer edges is `unresolved` or a required gate did not
run.**

**Hard stops:** unresolvable base/head; dirty tree overlapping the delta (surface it, ask once);
scope intersects another active apply worktree. If the human reports typecheck failing, run
**diagnostic-only**: emit findings as usual but withhold the Approve/Block decision until
typecheck is green.

## Phase 1 — Triage (haiku, one per changed surface)

Spawn `fable-audit-triage` per surface, passing: its changed files, tier + reasons, the spine
anchors + hotspots from `surfaces.md`, and the lens menu. Returns JSON only: cells worth deep
review (lens × files, with why) + macro questions. T1 surfaces get only triage-selected cells.

## Phase 2 — Review (sonnet, concurrent)

Spawn `fable-audit-reviewer` agents of two kinds:
- **Macro — one per surface:** workflow coherence (the spine questions in `surfaces.md` — does the
  journey cohere end-to-end: order, gates, no dead-ends, systemic patterns to fix once?) plus
  contract blast radius (each changed contract vs its consumer edges). Macro findings may cite a
  flow/stage range instead of `file:line`.
- **Micro — one per triaged cell:** exact files/hunks + ONE lens rubric pasted from `lenses.md` +
  the candidate schema and caps from `findings-schema.md` + the CI-suppression list from
  `surfaces.md`.

Rules: pass the manifest explicitly to every worker; excerpts, not whole files; structured YAML
back, nothing else; **≤3 candidates per cell** (a 4th only if Blocker); approve generously — file
only a real gap Fable wouldn't ship, never taste.

## Phase 3 — Blind verification (sonnet)

Every Blocker/High/Medium candidate → `fable-audit-verifier`, given the claim, evidence locations,
and gate facts — **not** the reviewer's rationale. Gate facts = the static CI-suppression list in
`surfaces.md` plus any gate results the human pasted into the invocation; nothing else exists in a
read-only run. Disconfirm first. Returns `confirmed | refuted | needs-human`. Low candidates are
never verified, never block, never affect the decision — they surface only in the report's
"Unverified low upgrades" section.

## Phase 4 — Adjudication & synthesis (Fable — this loop)

- Fable adjudicates every confirmed **T3 Blocker/High** before it enters the report.
- Dedupe (same file:line + root cause = one), cluster into themes tagged `TH1, TH2, …`.
- `priority = severity_weight × confidence_weight × downstream_blast_radius`.
- Decision: any confirmed Blocker → **Block**. Confirmed High on a T3 path that stays unresolved →
  **Block**. Any other confirmed findings → **Approve with upgrades**. None → **Approve**.
- Emit per `report-template.md`. End with the apply set and the handoff: create
  `plans/fable/approval-<run-id>.md` (format in `../fable-apply/apply-contract.md`), then run
  `/fable-apply <run-id> <finding-ids>`.

## Non-negotiables

- **Read-only.** Edit/Write are disabled by frontmatter; never mutate via Bash either (no
  `git add/commit/checkout -- <path>`, no file redirection, no installs).
- Never read `website/**`, `.env*`, credentials, or data exports. The marketing site belongs to a
  concurrent run — if it appears in a delta, drop it silently.
- Never emit PHI/PII/secret values in findings; a report containing them is invalid until redacted.
- Never restate a deterministic CI/scope failure (suppression list in `surfaces.md`); only a
  distinct downstream consequence the gate cannot express justifies a finding.
- `needs-human` ≤ 3, each naming the precise decision required.
- No persistent memory for audit conclusions; every run stands on its own manifest.
- Static claims in `surfaces.md` are advisory; the runtime delta is authoritative.

## Companions

`surfaces.md` — globs, spines, hotspots, tier triggers, CI suppression · `lenses.md` — 4 lens
rubrics at 2 altitudes · `findings-schema.md` — candidate YAML, severity, caps, verification rules ·
`report-template.md` — final report shape · `../fable-apply/` — approval record + apply contract.
