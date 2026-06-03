---
owner: ki-dev-piqc
feature: ask-bubble-header-consolidation
status: merged
merged: 2026-06-03
started: 2026-06-03
target_pr: #253
---

# Ask bubble — header consolidation + AskRail cleanup

## Context

Tiny follow-up to PR #249 (ask-tab-demo-polish). During live-demo prep the
bubble was showing three stacked title rows: the bubble header ("Ask · {code}"),
the AskTab protocol strip ("{code} · {sponsor} · {phase}"), and DashboardChat's
own "Protocol Assistant / Clinical knowledge at your fingertips" header.
Ishika asked for two rows instead. This PR collapses to two.

It also lands the AskRail.tsx deletion that PR #249 intended but missed —
the original `git rm` failed during the manual recovery, so a deprecation
re-export stub got merged into main instead of the file being removed.
Nothing imports it anymore, so it's dead code.

## Scope (files allowed)

- `src/components/dashboard/DashboardChat.tsx` — additive `hideHeader?: boolean` prop, defaults to `false` so the Audit Mode call site is unchanged.
- `src/components/dashboard/site/AskBubble.tsx` — bubble header shows bolded "Protocol Assistant" (no protocol code; that lives in the strip below).
- `src/components/dashboard/site/AskTab.tsx` — strip drops the Sparkles icon (bubble header has one); keeps `{code} · {sponsor} · {phase}`. Passes `hideHeader` to DashboardChat.
- `src/components/dashboard/site/AskRail.tsx` — deleted. Was the transitional re-export stub merged in PR #249.

## Out of scope (files forbidden)

- All `visit-execution/`, `audit/`, `sotr/`, `supabase/` directories
- `DemoAskPanel.tsx`, `Dashboard.tsx` — covered by PR #249, untouched here
- `plans/kiara/ask-tab-demo-polish.md` (or its `_archive/` mirror) — that plan belongs to PR #249

## Architecture layers touched

- [ ] migration
- [ ] RPC
- [ ] adapter
- [ ] context
- [x] component
- [ ] test

## Mock data plan

None.

## Approved-by

`DashboardChat.tsx` is shared with Audit Mode but the change is purely additive
(new optional prop, default `false`) — Audit's call site is unaffected.
Tag @karl-dev-piqc on the PR for awareness; no approval blocker expected.

## Verification

- [ ] Bubble in demo mode shows exactly two header rows: bolded "Protocol Assistant" + "{code} · {sponsor} · {phase}"
- [ ] `AskRail.tsx` is removed from the repo
- [ ] `grep -rn "from.*AskRail" src/` returns nothing
- [ ] `npm run lint && npx tsc --noEmit -p tsconfig.app.json` clean
- [ ] Audit Mode chat surface visually unchanged (DashboardChat still renders its own header when consumed outside the bubble)
