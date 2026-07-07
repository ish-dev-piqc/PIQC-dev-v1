# Findings — candidate schema, severity, caps, verification rules

Reviewers emit candidates in this exact YAML shape and nothing else — no prose, no pasted code
blocks beyond `observed_fact` lines, no file summaries. Silence = approval; a surface with no
findings needs no filler.

## Candidate finding schema

```yaml
id: <run-id>-<seq>               # run-id already starts with FA- → e.g. FA-a1b2c3d-e4f5a6b-0f3c9d2e77aa-003
surface: audit|deliverables|sponsor|cra|shared
lens: design-ux|correctness|architecture|clinical-integrity|workflow   # workflow = macro
tier: T1|T2|T3                   # risk tier of the change under review
decision: candidate              # verifier sets confirmed|refuted|needs-human
severity: blocker|high|medium|low
confidence: high|medium|low
title: <one-line defect statement>
violated_rule_or_contract: <specific doctrine, invariant, type, entitlement, or consumer expectation>
evidence:
  - file: <repo-relative path>   # macro findings may use flow: <stage/route range> instead
    start_line: <n>
    end_line: <n>
    observed_fact: <factual, reproducible, no PHI/PII/secrets>
downstream_impact:
  affected_consumers:
    - <path — or "none found" (searched) — or "unresolved" (edge could not be resolved)>
  impact: <what breaks, misleads, leaks, or becomes unmaintainable>
  confidence: high|medium|low
mechanical_gate:
  status: covered|uncovered|failed|not-applicable
  gate: <gate name or null>
  reason: <why this is not a duplicate of deterministic coverage>
reproduction_or_validation:
  command: <existing command, test, or manual reproducible check>
  expected_result: <specific result>
smallest_safe_fix:
  summary: <one implementation-sized change>
  allowed_paths: [<path>, ...]
  excluded_paths: [<path>, ...]
owner: <exact handle from docs/CODEOWNERS.md — @karl-dev-piqc, @fable-dev-piqc, @ish-dev-piqc @ki-dev-piqc (2-reviewer), @rv61 (supabase)>
effort: xs|s|m|l
verification:                    # filled by the verifier, never the reviewer
  verifier_decision: confirmed|refuted|needs-human
  verifier_evidence: [<independent fact>, ...]
  verifier_notes: <short>
```

## Severity rubric

| Severity | Meaning |
|---|---|
| **blocker** | Potential PHI/PII exposure, unauthorized access, clinical misrepresentation, data corruption/loss, broken auditability/provenance, default-on mock data on a clinical surface, or a shared-contract failure with no safe path |
| **high** | Material workflow failure, incorrect generated deliverable, broken direct consumer, major accessibility barrier, or an architectural break likely to regress |
| **medium** | Real defect, maintainability hazard, or inconsistent behavior with bounded impact |
| **low** | Minor improvement with clear value; never blocks approval, never gets a verifier — reported only in the "Unverified low upgrades" section, never apply-eligible, never affects the decision |

## Caps & weighting

- **≤3 candidates per cell**; a 4th only if it is `blocker`. Keep the highest
  `severity × confidence`, drop the rest — a tight, trustworthy list beats an exhaustive one.
- Primary lenses (design-ux, correctness) carry the bulk of findings. Guardrail lenses
  (architecture, clinical-integrity) file **blocker/high only** — red-lines, not nits.
- Do not manufacture a finding to fill a quota. Zero findings is a valid, reportable outcome.

## Verification rules

1. The verifier receives the claim, evidence locations, manifest facts, and applicable gate output —
   **never** the reviewer's prose rationale.
2. The verifier seeks **disconfirming** evidence first.
3. `refuted` and mechanical-duplicate candidates are omitted from the report, retained in run
   telemetry (counts only).
4. `needs-human` only where repository evidence cannot settle a clinical, product-policy, or
   ownership question — max 3 per report, each naming the precise decision needed.
5. Only `confirmed` findings are apply-eligible.
6. A finding is not actionable unless `allowed_paths`, `owner`, and
   `reproduction_or_validation` are present.
7. Verifier agreement is an independent check, not a correctness guarantee — say "confirmed", never
   "guaranteed".
