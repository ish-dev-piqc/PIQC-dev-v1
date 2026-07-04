---
owner: ki-dev-piqc
feature: ask-tab-demo-polish
status: merged
merged: 2026-06-03
started: 2026-06-03
target_pr: #249
---

# Ask tab demo polish

## Context

Site demo on Google Meet today. The Ask tab is shown via `AskRail` (380px right-docked panel mounted globally in `Dashboard.tsx`) and runs in demo mode through `DemoAskPanel`. The plumbing works but the panel has UX rough edges that read poorly on a screen-shared demo: suggestion cards vanish after the first answer, no icons on cards (inconsistent with live mode), a confusing "input disabled" footer with no visible input affordance, 2-col grid collapses awkwardly in the narrow rail, and citations are too quiet given they're our key differentiator vs. ChatGPT.

This is a UI-only polish pass — no fixture, schema, RPC, or live-LLM changes.

## Scope (files allowed)

- `src/components/dashboard/site/DemoAskPanel.tsx`
- `src/components/dashboard/site/AskTab.tsx`
- `src/components/dashboard/site/AskBubble.tsx` (new — replaces AskRail)
- `src/components/dashboard/site/AskRail.tsx` (deleted / re-export stub)
- `src/components/dashboard/Dashboard.tsx` — import + mount-site swap only
- `src/components/dashboard/DashboardChat.tsx` — only if a tiny prop default needs adjusting; any new prop must default to current behavior so Audit Mode usage is unchanged. (Not actually touched in this pass.)

## Out of scope (files forbidden)

- `src/lib/demo/fixtures/askResponses.ts` (answer content stays as-is)
- `src/lib/site/useAskThread.ts`, `src/lib/site/askPrompts.ts` (no logic changes)
- `src/components/dashboard/visit-execution/**` (Ishika's domain)
- `src/components/dashboard/audit/**` (Karl's domain)
- Any context / supabase / migration files

## Architecture layers touched

- [ ] migration
- [ ] RPC
- [ ] adapter
- [ ] context
- [x] component
- [ ] test (visual-only changes; no new tests needed)

## Mock data plan

None. `DemoAskPanel` already consumes `DEMO_ASK_RESPONSES` from `src/lib/demo/fixtures/askResponses.ts`. We're not adding new mock surfaces.

## Approved-by

- `src/components/dashboard/DashboardChat.tsx` is not in any explicit CODEOWNERS rule but is used by both Site and Audit modes. Any change here will keep all current props' defaults intact so Audit's call site is unaffected. If a non-trivial change is needed I'll flag Karl on the PR.

## Fixes in this pass

Initial polish pass (six items):

1. Keep suggestion cards visible after the first answer (so the demo has natural next-clicks instead of hunting for "Start over").
2. Add icons to the demo suggestion cards to match live-mode visual consistency.
3. Replace the "chat input disabled" footer with a visibly-disabled input field so the affordance is obvious, not broken-looking.
4. Force single-column suggestion layout under the narrow panel width.
5. Stronger citation chip — slightly more visual weight on document title and page so the differentiator lands.
6. Tighter empty-state copy reinforcing the "grounded in this protocol" value prop.

Follow-up per Ishika review (2026-06-03):

7. **Convert AskRail → AskBubble.** Replace the right-docked 380px rail with a floating bubble anchored bottom-right (collapsed = 56px circular FAB, expanded = 420px-wide × min(720px, 80vh) tall floating panel via fixed positioning). This is the familiar Intercom/HubSpot pattern and frees the dashboard main pane from sharing horizontal space.
8. **More vertical space.** Expanded panel uses min(720px, 100vh − 7rem) so it claims the bulk of the viewport.
9. **Chat dominates over chrome.** Compress the AskTab protocol context strip from a 3-line stack to a single compact row, and shrink the DemoAskPanel empty-state suggestion cards into compact one-line chips so the "chat area waiting" feel comes through.

## Verification

- [ ] Run `npm run dev` and open Site Mode with demo mode on
- [ ] Confirm the bubble FAB appears in the bottom-right corner (collapsed state)
- [ ] Click to expand; confirm the panel anchors bottom-right with tall vertical extent
- [ ] In the expanded panel: confirm protocol context strip is a slim single row, not a tall stack
- [ ] Empty state: starter chips are compact (not full-card), chat area visually dominates
- [ ] Click a starter; confirm answer + stronger citation chips appear AND remaining starters stay visible as a "Try another question" strip
- [ ] Confirm the disabled input is visibly present (not hidden) with placeholder explaining demo mode
- [ ] Switch off demo mode; confirm live `DashboardChat` still works inside the bubble (no audit-mode regression — audit doesn't use AskBubble)
- [ ] `npm run lint && npm run typecheck` — both clean
- [ ] Take screenshots before/after for the demo
