---
owner: sixonelabs-piqc
feature: site-ask-orphan-guard
status: active
started: 2026-07-07
target_pr:
---

# Site Ask — orphaned "Stopped…" bubble guard on New-chat-mid-stream

## Context

Clicking "New chat" in the Site Mode Ask bubble while an assistant response is
still streaming leaves a dangling `{role:'assistant', error:'Stopped before a
response was received.'}` bubble as the sole message of the freshly cleared
thread. Mechanics: `handleNewChat` calls `clearThread()` and bumps the epoch
key, remounting the keyed chat; DashboardChat's `abortOnUnmount` cleanup aborts
the fetch, and the aborted send's `finally` pushes its stopped-branch message
through the still-valid same-protocol setter into the now-empty thread
(`useAskThread`'s pid guard only drops cross-protocol writes). The bubble's
Retry no-ops (no preceding user turn). Found in the Sponsor Ask adversarial
review; the sponsor twin was fixed in PR #464 (`guardedSetMessages` in
`SponsorAskPanel.tsx`, commit 2e83f83) — this plan ports that guard to the
site-side original, keeping the two surfaces mirrored at the same layer.

## Scope (files allowed)

- `src/components/dashboard/site/AskBubble.tsx`
  Wrap the setter passed to AskTab in `guardedSetMessages` (verbatim port of the sponsor guard): drop a functional update that lands on an empty thread and produces messages with no user turn but an assistant error — a legitimate thread always starts with the user's turn, so that state can only be the aborted straggler.
- `src/components/dashboard/site/__tests__/AskBubble.test.tsx`
  New regression test (mock contexts + AskTab, drive the New-chat-mid-stream straggler write, assert it's dropped and legitimate writes still land).

## Out of scope (files forbidden)

- `src/components/dashboard/DashboardChat.tsx` — the shared-engine fix (guard the stopped-branch push itself) was considered and rejected here: Audit consumes DashboardChat with `abortOnUnmount=false`; touching it needs @karl-dev-piqc coordination and is not required to fix the site surface.
- `src/lib/site/useAskThread.ts` — the hook's pid-guard semantics are unchanged; the orphan guard lives at the bubble layer to mirror the sponsor placement.
- `src/components/dashboard/site/AskTab.tsx`, `DemoAskPanel.tsx` — untouched pass-through.
- `src/components/dashboard/sponsor/**` — sponsor twin already fixed (PR #464).

## Architecture layers touched

- [ ] migration (`supabase/migrations/`)
- [ ] RPC (`supabase/functions/` or `.sql`)
- [ ] adapter (`src/lib/*/*Adapter.ts`)
- [ ] context (`src/context/`)
- [x] component (`src/components/`)
- [x] test (`src/**/__tests__/`)

## Mock data plan

none

## Approved-by

- @ki-dev-piqc — for `src/components/dashboard/site/AskBubble.tsx` and `src/components/dashboard/site/__tests__/AskBubble.test.tsx` (Site Mode owner)

## Verification

- [x] `AskBubble.test.tsx` — straggler write (assistant-error-only update onto a cleared thread) is dropped; New chat stays disabled after the drop. Red-green verified: this case fails against the unguarded component, passes with the guard.
- [x] `AskBubble.test.tsx` — legitimate first send (user turn + streaming placeholder) passes the guard; normal Stop-mid-stream with a preceding user turn is NOT dropped. Both pass with AND without the guard (behavior-preservation controls).
- [x] `tsc --noEmit -p tsconfig.app.json` clean; full vitest suite green (102 files / 1362 tests)
- [ ] Manual (dev with a live protocol): send a question, click New chat mid-stream → thread is empty, no orphaned "Stopped…" bubble
