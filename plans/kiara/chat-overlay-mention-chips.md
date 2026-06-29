---
owner: ki-dev-piqc
feature: chat-overlay-mention-chips
status: active
started: 2026-06-13
target_pr:
---

# Chat overlay — render @-mention chips

## Context

The chat overlay (`ChatOverlayPanel.tsx`) was rendering message
bodies as plain text. Messages with `<@<uuid>>` mention tokens
showed the raw token to the user — visible in mobile/split-screen
where the overlay is the only chat surface.

ChatTab's `renderMessageBody` handles this correctly with full
mention + cross-mode reference parsing, but the overlay never
adopted the renderer.

## Design

Add a stripped-down `renderOverlayMessageBody(body, nameByUserId,
currentUserId, isSelfMessage, isLight)` helper inside the overlay
file. Walk the message body for `<@uuid>` matches, swap each for a
styled chip showing "@FirstName" using the existing `nameByUserId`
map. Self-mentions get the same amber highlight as ChatTab.

Reference chips (`[protocol:CODE]` / `[visit:UUID]` /
`[participant:CODE]`) are intentionally out of scope — those need
navigation handlers the overlay doesn't have. They'd render as raw
text in the overlay, which is acceptable for now since the user can
always open the full Chat tab for richer interactions.

## Scope (files allowed)

### New

- `plans/kiara/chat-overlay-mention-chips.md` — this file.

### Modified

- `src/components/dashboard/chat-overlay/ChatOverlayPanel.tsx` —
  `MENTION_TOKEN_REGEX` constant, `renderOverlayMessageBody` helper,
  swap `m.body` to call the helper in the message render.

## Architecture layers touched

- [x] component

## Mock data plan

None.

## Approved-by

Self.

## Verification

- `npx tsc --noEmit --skipLibCheck -p tsconfig.app.json` → 0 errors
- Manual:
  - Open chat overlay on mobile/split-screen.
  - Compose a message with `@<someone>` → send.
  - Receiver/sender sees the message body as "@FirstName" chip, not
    the raw `<@uuid>` token.
  - Self-mention (mention yourself) → amber-highlighted chip.

## Mechanical checks

- No new color classes.
- No `: any` in `src/lib/**`.
- Plan MD referenced above.
