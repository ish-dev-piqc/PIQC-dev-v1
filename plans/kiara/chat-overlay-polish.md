---
owner: ki-dev-piqc
feature: chat-overlay-polish
status: active
started: 2026-06-13
target_pr:
---

# Chat overlay polish — drag-to-dismiss + mark-all-mentions-read

## Context

PR 4 shipped the chat overlay with a mobile bottom-sheet variant and a
Mentions filter. Two follow-ups remain:

- **Drag-to-dismiss** on the mobile bottom-sheet. PR 4 left a static
  drag handle with the comment "touch-drag-to-dismiss can land in a
  polish follow-up." This is that follow-up.
- **Mark all mentions read**. The existing `mark_chat_mentions_read`
  RPC is per-channel only. The Mentions filter is cross-channel, so
  there's no way to clear the inbox without opening every channel one
  by one. We add a new RPC + sweep button.

Out of scope: realtime inside overlay (CLAUDE.md mandates `.channel(`
lives in `src/context/`, and pulling it through a context for an overlay-
only feature is overengineering — the current refetch-on-open behavior
is fine).

## Design

### Drag-to-dismiss (mobile only)

The sheet wrapper gets `onTouchStart` / `onTouchMove` / `onTouchEnd`
handlers wired only to the drag handle and the header (so list-scroll
gestures don't get hijacked). Track `startY`, current `deltaY`; render
the sheet with `transform: translateY(<deltaY>px)` and an `opacity` on
the backdrop that scales from 1 → 0.6 as the user drags. On release:

- `deltaY >= 30% of viewport height` OR `velocity > 0.6 px/ms` → close
- otherwise → snap back via CSS transition

`md:` breakpoint disables all of this — desktop is a side panel, no
drag.

### Mark all mentions read

Migration `20260704000800_mark_all_mentions_read.sql` adds:

```sql
CREATE OR REPLACE FUNCTION public.mark_all_chat_mentions_read()
RETURNS VOID
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  UPDATE public.chat_mentions
  SET read_at = NOW()
  WHERE mentioned_user_id = auth.uid()
    AND read_at IS NULL;
END;
$$;
```

`orgsApi.markAllChatMentionsRead()` wraps it as `Result<void>`.

UI: when the active channel is `mentions` and `mentions.length > 0`, a
"Mark all read" link appears in the body section above the list. On
click → call RPC → optimistically clear local `mentions` state (the
list source already filters to unread). Footer link to the full inbox
stays as it is.

## Scope (files allowed)

### New

- `plans/kiara/chat-overlay-polish.md` — this file.
- `supabase/migrations/20260704000800_mark_all_mentions_read.sql` —
  new RPC.

### Modified

- `src/lib/orgs/orgsApi.ts` — add `markAllChatMentionsRead()`.
- `src/types/orgs/` — no type changes (RPC returns void).
- `src/components/dashboard/chat-overlay/ChatOverlayPanel.tsx` —
  touch handlers + sweep button.

## Architecture layers touched

- [x] migration
- [x] RPC
- [x] API layer
- [x] component

## Mock data plan

None.

## Approved-by

Roger (`supabase/migrations/*`).

## Verification

- `npx tsc --noEmit --skipLibCheck -p tsconfig.app.json` → 0 errors
- Manual:
  - Mobile: drag the top of the sheet down — sheet follows the finger,
    backdrop fades. Release < threshold → snaps back. Release >
    threshold → closes.
  - Mobile: drag handle is the only draggable surface other than the
    header — scrolling the message list does not drag the sheet.
  - Desktop: no drag-dismiss behavior.
  - Click Mentions filter → if any unread, "Mark all read" button
    appears. Click → list goes empty → close + reopen → still empty.
  - Open hub Chat tab — the navbar bell badge drops to zero too
    (same source of truth).

## Mechanical checks

- No new `.channel(` in components — none added.
- No `@supabase/supabase-js` import in components — none added.
- No `: any` in `src/lib/**`.
- Migration is append-only (new file, new SHA).
- Plan MD referenced in PR body.
