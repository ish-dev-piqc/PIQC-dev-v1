# Apply contract — approval record, validity, plan template

## Approval record

Location: `plans/fable/approval-<run-id>.md`. Created or explicitly approved by a human — never by
the audit itself.

```yaml
run_id: FA-<base7>-<head7>-<digest12>
base_sha: <full sha>
head_sha: <full sha>
manifest_digest: <sha256:12>
approved_finding_ids:
  - FA-...-001
  - FA-...-004
approved_by: <human identifier>
approved_at: <ISO-8601>
scope_exceptions: []        # explicit extra paths, each with a one-line reason; default empty
```

## Validity rules

| Check | On failure |
|---|---|
| Record exists + parses | Refuse; ask the human to create it from the audit report's apply set |
| run_id / base_sha / head_sha / manifest_digest all match the report | Refuse — wrong or tampered record |
| Current `HEAD` == `head_sha` | Refuse — **stale**; the tree moved since the audit; re-run `/fable-audit` |
| Finding is `confirmed` and apply-eligible | Refuse that ID; apply the rest only if the human approved partial application |
| Requested IDs ⊆ `approved_finding_ids` | Refuse the extras |
| Paths ⊆ union(`allowed_paths`) ∪ `scope_exceptions` | Stop at first violation; request an exception |

A scope exception is a human edit to the record adding the path + reason — never an inference.

## Apply-run plan MD template

`plans/fable/<run-id>-apply.md`:

```markdown
---
owner: fable
feature: <run-id>-apply
status: active
started: <date>
target_pr:
---

# Fable apply — <run-id>

## Context
Applies findings <ids> from audit run <run-id> per approval record approval-<run-id>.md.

## Scope (files allowed)
<union of allowed_paths, one per line>

## Out of scope (files forbidden)
- website/
- supabase/migrations/<merged files>   # merged migrations are append-only — never edit; a NEW migration is allowed only when listed in allowed_paths
- <every excluded_path from the findings>

## Architecture layers touched
<check per findings>

## Mock data plan
none

## Approved-by
<owner handles for each batch — @karl-dev-piqc (audit), @fable-dev-piqc (deliverables),
@ish-dev-piqc @ki-dev-piqc (entitlements/context, 2-reviewer), @rv61 (supabase)>

## Verification
- [ ] Per-finding validation command + expected result
- [ ] npm run typecheck · npm run lint · npm run test
- [ ] /piqc-review clean
```

## Retention

Commit the approval record and apply plan with the PR (forensic trail: who approved what, against
which SHAs). The audit report itself may live in the PR description.
