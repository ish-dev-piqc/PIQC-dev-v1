---
owner: ki-dev-piqc
feature: confirm-leave-guard
status: merged
merged: 2026-06-13
started: 2026-06-04
target_pr: #331
---

# Confirm-leave guard (PR 1b — workspace-first safety net)

## Context

PR 1 added the LeftRail with rail-icon mode switches. Today,
switching modes mid-edit silently discards work — chat composer
drafts, inline-editable visit notes, participant notes. This PR
adds an app-level dirty-state registry + a confirm-leave modal
that intercepts mode-switch actions when any registered surface
is dirty.

Chat-overlay toggle is intentionally NOT guarded — overlay content
is transient and the toggle frequency is high. Mode switches,
workspace home, and the sponsor coming-soon are guarded.

## Design

### Registry

`src/context/DirtyStateContext.tsx` — module-level `Set<string>`
of dirty-labels. Components opt in via the `useDirty(label,
isDirty)` hook: when `isDirty` flips true the label is added to
the Set; on unmount or when `isDirty` flips back to false, it's
removed. App-level subscribers (the guarded-navigate handler) read
`isAnyDirty()` synchronously when a navigation attempt fires.

### Guarded navigation

App.tsx exposes `pendingAction` state + a `guardedNavigate(action,
description?)` helper. The LeftRail and the Navbar's mobile
workspace nav call it instead of executing nav directly. The
helper:

- If no labels registered: runs `action()` immediately.
- Otherwise: stores the action in `pendingAction`. Renders
  `<ConfirmLeaveModal>` with the dirty-labels list (so the user
  knows what'll be lost).
  - "Stay here" → clear `pendingAction`. No nav.
  - "Discard and leave" → run the action, clear pending. (Dirty
    components unmount on nav; their `useDirty` cleanup empties
    the registry naturally.)

### Hook usage in v1

Instrument the highest-risk surfaces:

- `ChatTab` — main composer (text + pending mentions + attachments).
- `ChatTab` — inline message edit textarea.
- `ChatOverlayPanel` — composer text.
- `InlineEditableText` — its draft while editing with non-empty
  diff against the saved value.

Sponsor form, Documents upload, and the audit-mode surfaces stay
unguarded for v1. Easy to add later by sprinkling `useDirty`
calls.

## Scope (files allowed)

### New

- `src/context/DirtyStateContext.tsx`
- `src/components/dashboard/ConfirmLeaveModal.tsx`
- `plans/kiara/confirm-leave-guard.md` — this file.

### Modified

- `src/App.tsx` — mounts `DirtyStateProvider` + `ConfirmLeaveModal`;
  defines `guardedNavigate`; rewires Navbar mobile workspace nav
  through it.
- `src/components/dashboard/LeftRail.tsx` — accept
  `onGuardedNavigate` prop; route mode / workspace / sponsor
  clicks through it. Chat icon unchanged (no guard).
- `src/components/dashboard/organization/ChatTab.tsx` — `useDirty`
  for composer + inline edit.
- `src/components/dashboard/chat-overlay/ChatOverlayPanel.tsx` —
  `useDirty` for composer.
- `src/components/dashboard/site/InlineEditableText.tsx` —
  `useDirty` while in edit mode with a non-empty draft.

## Architecture layers touched

- [x] context (DirtyStateContext)
- [x] component

## Mock data plan

None.

## Approved-by

Self.

## Verification

- `npx tsc --noEmit --skipLibCheck -p tsconfig.app.json` → 0 errors
- Manual:
  - Type into chat composer → click Site rail icon → confirm
    modal appears citing "chat composer". Choose Stay here → text
    preserved. Choose Discard and leave → text gone, switched to
    Site Mode.
  - Edit a chat message inline → switch modes → guard fires.
  - Edit a visit note inline (via InlineEditableText) → switch
    modes → guard fires.
  - No edits anywhere → switch modes → no modal, instant nav.
  - Click Chat rail icon mid-compose → overlay toggles WITHOUT
    confirm (intentional).
  - Mobile menu workspace nav routes through the same guard.
