# Per-dev plan MDs

Every non-trivial change in PIQC gets a plan MD here. The plan declares Scope (files this feature may touch) and is the source of truth that `scope-check` and `piqc-review` enforce against.

## Structure

```text
plans/
├── README.md
├── _template.md       — template for new plans (Claude uses this, not you)
├── ishika/
│   ├── <active-feature>.md
│   └── _archive/<merged-feature>.md
├── kiara/
├── karl/
└── roger/
```

## How plans are created

You don't write plan MDs yourself. When you tell Claude "let's build X" / "add Y" / "wire up Z", the `feature-intake` skill:

1. Figures out which files will be touched.
2. Looks up codeowners for each.
3. Scans active plans across all devs for Scope overlaps.
4. Posts a summary and waits for your "yes".
5. Writes the plan MD into your folder.

Then build proceeds.

## How cross-dev visibility works

Plan MDs live on feature branches, not just main. `feature-intake` runs `git fetch --all` and scans every unmerged branch's `plans/` folder for active or in-review plans. **The skill commits and pushes your plan MD to a fresh feature branch immediately after writing it** — that push is what makes your Scope visible to other devs' overlap detection. If a plan never gets pushed, no one else's Claude can see it.

## Lifecycle

1. `status: active` — fresh from `feature-intake`; you're coding. Counts toward overlap detection.
2. `status: in-review` — flipped by `piqc-review` when you're opening a PR. Still counts toward overlap detection; scope is locked.
3. After merge — `/archive-plan` moves the file to `plans/<your-name>/_archive/<feature>.md` and sets `status: merged`. No longer counted.

(`status: blocked` is also valid for plans you've paused — not counted by overlap detection.)

## Conflict resolution

If your feature's Scope overlaps another dev's active or in-review plan, `feature-intake` blocks and surfaces the conflict. Options:

1. Wait for the other plan to merge.
2. Coordinate — split the scope so no file appears in both plans.
3. Take over the file with the other dev's approval; note it under "Approved-by" in your plan and tag the codeowner on the PR.

## After merge

Run `/archive-plan`. It verifies the PR is merged, moves the file to `_archive/`, sets `status: merged`, and commits. Don't manually delete — the archive is the forensic record of who touched what and when. If you genuinely want to delete a plan (e.g. abandoned work), just `git rm` it.
