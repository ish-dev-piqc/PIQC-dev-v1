# PIQC-dev-v1 codeowners

> **Why this lives at `docs/CODEOWNERS.md` instead of `.github/CODEOWNERS`:**
> GitHub only treats the magic paths (`.github/CODEOWNERS`, `/CODEOWNERS`, `docs/CODEOWNERS`)
> as active rules that trigger auto-review-requests. We deliberately moved this file to
> `docs/CODEOWNERS.md` (note the `.md` extension) so GitHub stops auto-pinging owners on
> every PR while we keep the file as the source of truth for ownership lookups by
> [`feature-intake`](../.claude/skills/feature-intake/SKILL.md),
> [`piqc-review`](../.claude/skills/piqc-review/SKILL.md), and humans.
>
> Merge gating is unchanged: branch protection on `main` still requires 1 approving review.
> Owners listed below are still the de-facto reviewers — the PR author requests them
> manually now instead of GitHub auto-assigning.

## Ownership rules

```text
# SOTR — Ishika
/src/lib/sotr/                    @ish-dev-piqc
/src/components/dashboard/sotr/   @ish-dev-piqc
/src/types/sotr/                  @ish-dev-piqc

# Visit Execution Workspace — Ishika
/src/lib/visit-execution/                          @ish-dev-piqc
/src/components/dashboard/visit-execution/         @ish-dev-piqc
/src/types/visit-execution/                        @ish-dev-piqc

# Site Mode — Kiara
/src/lib/site/                    @ki-dev-piqc
/src/components/dashboard/site/   @ki-dev-piqc

# Org workspaces — Kiara
# Note: takes ownership of pre-existing /src/lib/orgs/orgApi.ts (Ishika's PR #95).
# Ishika can opt out by adding a narrower override above this line.
/src/lib/orgs/                    @ki-dev-piqc
/src/components/dashboard/orgs/   @ki-dev-piqc
/src/types/orgs/                  @ki-dev-piqc

# Sponsor Mode placeholder — 2 reviewers (cross-mode forward-compat)
/src/types/sponsor/               @ki-dev-piqc @ish-dev-piqc

# Audit Mode — Karl
/src/lib/audit/                   @karl-dev-piqc
/src/components/dashboard/audit/  @karl-dev-piqc
/src/types/audit/                 @karl-dev-piqc

# Protocol Deliverable Engine — Fable
# Shared, non-mode "parse once, generate many" layer + its Sponsor mount.
# Handle is a placeholder until Fable's GitHub account exists — update
# together with plans/fable/monitoring-prep-checklist.md when confirmed.
/src/lib/deliverables/                             @fable-dev-piqc
/src/types/deliverables/                           @fable-dev-piqc
/src/components/deliverables/                      @fable-dev-piqc
/src/components/dashboard/sponsor/deliverables/    @fable-dev-piqc

# Backend / ingest — Roger
/supabase/                        @rv61
/src/lib/supabase.ts              @rv61

# Shared infra — 2 reviewers required
/src/context/                     @ish-dev-piqc @ki-dev-piqc
/src/components/auth/             @ish-dev-piqc @ki-dev-piqc
/src/components/billing/          @ish-dev-piqc @ki-dev-piqc
/src/lib/entitlements.ts          @ish-dev-piqc @ki-dev-piqc
/plan.md                          @ish-dev-piqc @ki-dev-piqc @karl-dev-piqc

# Discipline package
/CLAUDE.md                        @ish-dev-piqc
/docs/CODEOWNERS.md               @ish-dev-piqc
/.github/pull_request_template.md @ish-dev-piqc
/.claude/                         @ish-dev-piqc
/plans/README.md                  @ish-dev-piqc
/plans/_template.md               @ish-dev-piqc
```
