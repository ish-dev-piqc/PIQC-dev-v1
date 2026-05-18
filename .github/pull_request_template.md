## Summary

<1-3 bullets>

## Plan MD

Implements: `plans/<your-name>/<feature>.md`

## Pre-merge checklist

- [ ] `/piqc-review` passes (scope, ownership, architecture, mocks, types, style, PHI, dead code, overengineering, tests, plan-MD hygiene)
- [ ] Any out-of-scope file touched is documented under "Approved-by" in the plan MD, and the codeowner is tagged on this PR
- [ ] DB schema changes have matching `src/types/<domain>/` updates (or "no type impact" noted in plan)
- [ ] No new mock data, or new mocks sit behind a `piq-*-v1` localStorage toggle (default off)
- [ ] Verification steps in the plan MD are checked off

## Test plan

<bulleted list from the plan MD's Verification section>

## Post-merge

- [ ] Move plan MD to `plans/<your-name>/_archive/<feature>.md`
