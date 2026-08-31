# PIQC Audit & Refactor Playbook — Fable model architecture

> A reusable, best-in-class audit + refactor methodology for every future build. Distilled from
> real runs across this platform: the Audit-Mode + Deliverables audit, the Sponsor dry-run, the
> Site/VEW/SOTR/context bug hunt (11 fixed), the Enterprise & Access security review (2 criticals),
> and the Phase B tooling. It encodes what actually held up — zero false positives across every run —
> not theory.

---

## 0. What this is and when to run it

Three modes, one engine. Pick by intent:

| Mode | Question it answers | Primary output | When |
|---|---|---|---|
| **Audit** (`/fable-audit`) | "Would Fable build and approve this?" | ranked, verified refactors | after an Opus/contractor build lands on a surface |
| **Bug hunt** | "What's actually broken here?" | ranked, verified bugs | on never-audited or high-churn surfaces |
| **Security review** | "Can this be exploited?" | ranked, verified vulnerabilities (report-only by default) | on money / access / tenant / auth / PHI surfaces |

All three share the **same engine, topology, verification discipline, and apply path** below — only the
lens weighting and severity vocabulary change. Never skip the engine because a task "looks small": the
smallest-looking finding (a `±window` label, a fail-open guard) has been the most clinically dangerous.

---

## 1. The model architecture (the part to copy verbatim)

```
┌─ Phase 0 ─────────────┐   deterministic, NO llm
│ preflight + manifest  │   scripts/fable-audit-manifest.mjs (fail closed)
│ scope · tiers ·       │   scripts/fable-audit-gates.mjs (suppression list)
│ consumers · owners    │
└──────────┬────────────┘
           │  run manifest (JSON) passed explicitly to every agent
┌──────────▼────────────┐
│ Phase 1 — TRIAGE       │  Haiku · one per surface · read-only
│ which cells to review  │  returns JSON only: cells + macro questions + skipped
└──────────┬────────────┘
           │  (T1 → selected cells only; T2/T3 → all applicable lenses)
┌──────────▼────────────┐
│ Phase 2 — REVIEW       │  Sonnet · concurrent · read-only
│ macro (1/surface) +    │  macro = workflow coherence + blast radius
│ micro (1/cell)         │  micro = one lens over specific files
└──────────┬────────────┘
           │  candidate findings (structured YAML, capped)
┌──────────▼────────────┐
│ Phase 3 — VERIFY       │  Sonnet · one per candidate · BLIND
│ adversarial refute     │  gets claim + evidence, NOT reviewer rationale
└──────────┬────────────┘
           │  survivors only (confirmed / needs-human; refuted dropped to telemetry)
┌──────────▼────────────┐
│ Phase 4 — ADJUDICATE   │  Fable · the orchestrator loop
│ dedup · rank · decide  │  Approve / Approve-with-upgrades / Block
└──────────┬────────────┘
           │  ranked report + apply set
┌──────────▼────────────┐
│ Phase 5 — APPLY GATE   │  human approves → /fable-apply (separate, gated)
└───────────────────────┘
```

**Model routing (empirically tuned — spend the expensive model only on judgment):**

| Stage | Model | Why |
|---|---|---|
| Preflight | none (deterministic script) | facts, not opinions — must be reproducible + fail-closed |
| Triage | **Haiku** | cheap routing; decides where to spend, files nothing |
| Review (macro + micro) | **Sonnet** | the bulk of the reading; parallel, capped per cell |
| Verify | **Sonnet**, blind | independent second read; the quality firewall |
| Adjudicate + apply | **Fable** | final judgment, dedup, decision, and the only writer |

**Model-routing guard:** if the invoking session is *not* Fable, the skill spawns
`fable-audit-orchestrator` (model: fable) and relays its report — so "would Fable approve" is never
silently answered by a lesser model.

### Why this topology beats a single deep pass
- **Triage-before-review** stops paying Sonnet to read files with no signal (token efficiency).
- **Blind verification** is the reason for zero false positives across every run: the verifier hunts
  *disconfirming* evidence and defaults to refuted. It has repeatedly killed plausible-but-wrong
  findings and correctly downgraded client-only gaps that a server control backstops.
- **Macro + micro together** catches both the systemic gap (a stage hand-off that drops a draft; an
  authz model enforced only client-side) and the line-level defect — the systemic ones are the
  highest-value and a pure line-by-line pass misses them.
- **Adjudication separate from review** means one model reconciles duplicates and owns the decision,
  instead of N reviewers each asserting severity.

---

## 2. Risk tiers (drive review depth + apply strictness)

| Tier | Trigger | Depth | Apply rule |
|---|---|---|---|
| **T1 contained** | internal change; no changed export/type/route/gate/migration/provenance | triage-selected lenses | normal |
| **T2 boundary** | changed export/type/route/RPC signature/event contract **with ≥1 consumer** | producer + all direct consumers reviewed | verify all consumers |
| **T3 safety/shared** | entitlements · migrations · auth · provenance · cross-mode isolation · PHI-adjacent · **any authz/tenant/payment boundary** | all applicable lenses + Fable adjudication | **cannot Approve with an unresolved consumer edge or a missing required gate** |

The Phase-0 manifest assigns the tier deterministically from changed paths + the consumer graph. A T3
change with unresolved edges exits the manifest non-zero — automation must not treat it as clean.

---

## 3. The lenses (and the one discipline that governs all of them)

Five lenses. Each *applies the methodology of* an existing skill (reviewers can't call skills — the
rubric is inlined). Weight them by mode:

| Lens | Audit mode | Bug hunt | Security review |
|---|---|---|---|
| **Correctness** | primary | **primary** | supporting |
| **Design / UX** | **primary** | broken-states only | — |
| **Architecture** | guardrail (S1/S2) | guardrail | supporting |
| **Clinical integrity** | guardrail (red-lines) | guardrail (completeness) | — |
| **Security** | on shared/authz surfaces | on authz/data surfaces | **primary** |

**The governing discipline — "does the server enforce this?"** Learned hard in the security review:
a missing *client* gate backstopped by correct Postgres RLS is **low**; a missing/over-permissive RLS
policy, or a `SECURITY DEFINER` RPC without its own authz check, is **critical**. Every access finding
must be judged at the layer that actually enforces it, not where the UI happens to check. This single
question changed severities and killed false positives more than any other rule.

**Lens rubrics — the durable PIQC checks:**
- **Correctness** — `Result<T>` discipline; swallowed mutation errors (the AUD-301 class: null-return +
  console.error, no user signal); fail-open guards (the AUD-M1 class: a NULL/unmapped value skips a
  check); stale-cache-after-realtime + cross-channel races; date/window off-by-ones; `as`/`!` that lie.
- **Design/UX** — semantic tokens (`text-fg-*`); empty/loading/error/partial states that teach a
  first-time user; drawer parity (`useOverlay`+`useSwipeDismiss`); cognitive load (derive, don't
  re-type); "PIQC drafted/flagged/found" attribution present, never stripped.
- **Architecture** — mode isolation for the *new* modes (sponsor/deliverables/cra — CI only checks
  site/audit/sotr); context isolation; dead code; single-caller abstractions; bypassed/dead gates.
- **Clinical integrity** — no default-on mocks on a clinical surface (only `piq-*-v1` localStorage
  toggle, default-off); no PHI beyond the seeded demo set; provenance/ALCOA + earned write-back (no
  silent auto-writes to record); **completeness** (a dropped protocol-mandated requirement is a
  blocker); no wrong-evidence pairing (normalization collisions); no sponsor branding in artifacts.
- **Security** — broken access control / IDOR; tenant isolation (every org/protocol query + table RLS
  scoped by membership/`auth.uid()`); privilege escalation via `SECURITY DEFINER`; invite/token binding
  (bind redemption to the invited identity); payment integrity (server-authoritative price/plan/qty;
  webhook/return proof of payment); open redirect; secrets/PHI in the client bundle or logs.

**Severity vocabularies** — audit/bug: `blocker|high|medium|low`; security:
`critical|high|medium|low` with `vuln_class` + a required exploit scenario. Guardrail lenses file
**high/critical only** — red-lines, not nits.

---

## 4. Verification doctrine (the quality firewall — never weaken)

1. The verifier receives the **claim + evidence locations + gate facts — NOT the reviewer's prose.**
   It forms its own view.
2. It seeks **disconfirming evidence first**, in this order: (a) is the fact actually at those lines?
   (b) is there handling the reviewer missed — a guard, a caller-side check, a toggle, a **server-side
   RLS/RPC control**? (c) is it **deliberate design intent** (check `plans/*/_archive`, seed migrations,
   code comments, doctrine) → if so it's `needs-human`, not a bug; (d) is it already CI-caught? (e) is
   the proposed fix wrong or out of scope?
3. **Default to refuted when uncertain** — a dropped true positive costs far less than a false fix in a
   clinical system.
4. `needs-human` only when repo evidence can't settle a clinical/product/ownership question. Cap 3.
5. Only `confirmed` findings are apply-eligible. Refuted + CI-duplicates kept in telemetry only.

This is why the runs found real bugs (fail-open ISA gate, cross-channel chat leak, invite-binding
criticals) and shipped **zero** false fixes.

---

## 5. Scope & tooling (deterministic, fail-closed)

- **Phase 0 is a script, not a vibe.** `npm run fable:audit:manifest -- --base <ref>` emits run
  identity (bound to base+head SHA + digest), effective scope (denylist applied), a **TS-AST reverse
  consumer graph** (unresolved edges *surfaced, never dropped*), changed-export/type detection, owners
  from `docs/CODEOWNERS.md`, the gate inventory, and the risk tier. Bogus ref → JSON error + exit 1.
  T3-with-unresolved-edges → exit 2. Pass the JSON to every agent instead of re-deriving scope by hand.
- **Subtract the CI gate.** `fable-audit-gates.mjs` maps each `piqc-discipline` step to the rule it
  covers; the audit never spends a finding on something a deterministic gate already catches. The map
  fails loudly if a step is renamed (the suppression list must never lie).
- **Subject = the delta by default** (`git diff main...HEAD` ∩ surface globs); `full <surface>` for a
  whole-surface pass. Denylist (never the subject): `website/`, `plans/`, `.claude/`, `docs/`,
  `landing.html`.
- **No node on the machine** → the scratchpad-node workaround (copy the Codex node, ad-hoc re-sign,
  symlink `node_modules` into the worktree). Proven to run `tsc` + the full 1300+ test suite.

---

## 6. The refactor / apply path (report-only → gated write)

**Default is report-only.** Writing happens only through `/fable-apply` against a human approval record.

1. **Approve** — the human picks findings (all / by-severity / by-surface / cherry-pick) and an
   `approval-<run-id>.md` record is created (bound to base+head SHA + digest; stale head → reject).
2. **Dedicated worktree per apply run** (`git worktree add … origin/main`) — never share the checkout
   with another mutating agent (the marketing-site run has been live in this repo). Symlink node_modules.
3. **Parallel fixers, disjoint files.** One agent per file-group; each applies its fix **plus a locking
   test**; none runs git/tests. This is fast and safe *because* the groups don't overlap.
4. **Central verification** (the orchestrator, once): `tsc --noEmit` + full `vitest` via scratchpad-node.
   This is the firewall — across a 10-agent apply it caught exactly one tsc error the agents couldn't
   see. Fixers do not self-certify.
5. **Owner-batched commits.** One commit per CODEOWNERS owner (audit → @karl-dev-piqc · deliverables →
   @fable-dev-piqc · site → @ki-dev-piqc · entitlements/context → @ish-dev-piqc @ki-dev-piqc, isolated ·
   supabase → @rv61). Stage explicit paths — **never `git add -A`** (bundles unrelated uncommitted work).
6. **One branch per concern**, `/piqc-review` before PR, PR body references the (lowercase) plan MD.
   Never commit/push/merge without explicit instruction after the diff is reviewed.

---

## 7. Flag-don't-force (the judgment rule)

When a fix requires guessing at clinical or product semantics, **flag it, don't force it.** SOT-301
(visit-cycle grouping) was correctly *not* auto-fixed by the reviewer because no pure-string rule could
distinguish a distinguishing cycle from a restatement — a guessy fix to clinical grouping is worse than
a tracked follow-up. The later, correct fix moved the logic to the layer that had the missing context
(the adapter's grouping key). Rule: **a wrong fix to a clinical invariant outranks an unfixed finding.**
Likewise, **approve generously** — never churn code that's already good; a taste difference is an
approval, not a finding.

---

## 8. Hard-won operational rules (codified gotchas)

- **CI must run `tsc` + `vitest`.** `vite build` skips type errors and greps don't run tests — type-
  broken code merged twice before this gate existed. The gate lives inside the required
  `mechanical-checks` job so it needs no branch-protection change.
- **Plan MD filenames must be lowercase** (`plans/[a-z0-9_.-]+\.md`) — the "Plan MD referenced in PR
  body" check rejects uppercase; it broke a PR once.
- **`scope-check` needs `PIQC_DEV_FOLDER=<folder>`** when your git name doesn't substring-match a
  `plans/<folder>/` — otherwise it silently enforces the wrong (or no) plan.
- **RLS coverage ≠ RLS correctness.** Coverage was uniform; the holes were invite-binding + missing
  server-side tier checks. Audit the *effective* policy set (later migrations supersede earlier) and
  every `SECURITY DEFINER` function's internal authz.
- **Security findings go to a scratchpad/Desktop MD, not the repo** — an exploit roadmap shouldn't sit
  in a public tree before fixes ship.
- **Read from a clean worktree at merged `main`**, never the working checkout (it may be on another lane).

---

## 9. Definition of done (per run)

- Run identity exists (run ID bound to base+head SHA + digest); zero writes during audit.
- Every T2/T3 changed contract reviewed with its consumers, or the edge is explicitly labeled unresolved.
- Every reported finding survived blind verification; refuted + CI-dupes are telemetry only.
- Report follows the template: decision · coverage (incl. unresolved edges) · macro verdict · ranked
  findings · needs-human (≤3) · apply set (owner-batched) · non-findings · telemetry.
- If anything was applied: `tsc` clean + full suite green (central run), owner-batched diffs, plan MD.
- Subtle clinical/product ambiguity was flagged, not force-fixed.

---

## 10. Artifacts (already built — this plan documents the model they implement)

- `.claude/skills/fable-audit/` — SKILL.md (orchestration) + surfaces.md + lenses.md + findings-schema.md
  + report-template.md.
- `.claude/skills/fable-apply/` — gated apply contract.
- `.claude/agents/fable-audit-{orchestrator,triage,reviewer,verifier}.md` — the model-routed, read-only
  worker fleet.
- `scripts/fable-audit-manifest.mjs` + `scripts/fable-audit-gates.mjs` + `scripts/lib/fableAudit.mjs`
  — the deterministic Phase-0 engine (zero deps, node ≥18).
- CI: `tsc` + `vitest` gates in `piqc-discipline.yml`.

### Deferred / optional extensions
- Seeded-defect benchmark (precision/recall/cost baselines) — a fixture corpus of known-planted defects.
- CI checks validating skill frontmatter + the no-write audit guardrail.
- A standing **security lens** promoted into the default audit for any diff touching
  entitlements/auth/billing/RLS (currently a separate review mode).
