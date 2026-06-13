---
owner: ki-dev-piqc
feature: pin-from-chat
status: merged
merged: 2026-06-13
started: 2026-06-13
target_pr: #345
---

# Pin-from-chat — pin/unpin attachments inline in the chat surface

## Context

PR 5 (documents-tab-v1) shipped the Documents tab's Pinned board plus
the `setChatAttachmentPinned` RPC + per-row action menu to toggle pin
state — but only inside the Documents tab. From the chat surface
itself (Workspace → Chat tab), a user looking at a message with an
attachment has no way to pin it; they have to go find it in the
Documents tab first. That's a UX cliff.

This PR closes it: pin/unpin button lives inline in every chat
attachment render (image thumbnail corner + file row), wired to the
same RPC.

## Design

- `AttachmentRender` (the in-bubble attachment renderer) gets a new
  `onPinChanged` callback prop. When the user clicks the pin/unpin
  button, `setChatAttachmentPinned` fires; on success the new
  attachment row (with updated `pinned_at`) is handed back to the
  parent via `onPinChanged`.
- `ChatTab` (the only consumer of AttachmentRender) wires
  `onPinChanged` to a new `replaceLocal` helper on
  `useChannelAttachments`, which swaps the attachment in the
  channel-wide list by id.
- Pin button placement:
  - **Image attachment** — small icon top-left corner, opacity 0
    until hover (mirroring the existing delete-X top-right pattern).
  - **File attachment** — inline next to the existing Download
    button.
- Icon swaps between `Pin` (unpinned → pin) and `PinOff` (pinned →
  unpin). Pinned state stays visually marked even when not hovering
  via amber Pin icon at full opacity.

Anyone with channel access can pin (matches the original PR 5 spec
where pinning was open to all channel members, only delete was
restricted to admins/coordinators/uploader). Reducto docs don't go
through this code path — they live in the Documents tab only.

The hook's existing realtime sub watches INSERT + DELETE on
`chat_attachments`. Updates (the column flip) aren't picked up, so
remote users will see stale `pinned_at` until they re-enter the
channel. Adding an UPDATE listener is a polish follow-up.

## Scope (files allowed)

### New

- `plans/kiara/pin-from-chat.md` — this file.

### Modified

- `src/components/dashboard/organization/chat/AttachmentRender.tsx`
  — pin/unpin buttons + `onPinChanged` plumbing.
- `src/hooks/useChannelAttachments.ts` — `replaceLocal` helper.
- `src/components/dashboard/organization/ChatTab.tsx` — wire the new
  callback.

## Architecture layers touched

- [x] component
- [x] hook

No new migrations, no new RPCs (`setChatAttachmentPinned` already
exists). No new tests required — the API surface is unchanged.

## Mock data plan

None.

## Approved-by

Self (Site Mode / chat surface).

## Verification

- `npx tsc --noEmit --skipLibCheck -p tsconfig.app.json` → 0 errors
- Manual:
  - Open a chat channel with an attached file → hover the file row →
    pin button shows. Click → row marked pinned (icon flips to
    PinOff), pinned attachment appears in the Documents tab's
    Pinned board on next refresh.
  - Click PinOff → row unpins; Documents tab Pinned board drops it.
  - Same flow on an image attachment via the corner icon.
  - Multiple users in the channel: pinning user sees instant change;
    other users see it on next channel switch (realtime UPDATE
    follow-up acknowledged in scope notes above).

## Mechanical checks

- No new `.channel(` outside `src/context/` — N/A (existing in hook).
- No `@supabase/supabase-js` imports in components — none added.
- No `: any` in `src/lib/**` — no lib edits.
- Append-only migrations — N/A.
- Plan MD referenced in PR body.
- No new `*Api.ts` / `*Adapter.ts` files — no sibling tests required.
