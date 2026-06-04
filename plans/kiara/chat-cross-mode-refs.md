---
owner: ki-dev-piqc
feature: chat-cross-mode-refs
status: active
started: 2026-06-04
target_pr:
---

# Chat: cross-mode references

## Context

Third feature in the clinical-trial-distinctive sequence (file uploads
and decision acks are #1 and #2). Real trial chat conversations
constantly reference specific resources: "let's reschedule visit V5
for P-0023", "the deviation note on P-0014 should land before
PP06490's amendment closes". Today these are plain text that readers
have to resolve in their head.

This PR adds first-class references: typing `[` in the composer opens
a picker; selecting a protocol/visit/participant inserts a token like
`[protocol:PP06489]` or `[participant:P-0023]` or `[visit:<uuid>]`.
On render those tokens become clickable chips that link to (or
summarize) the referenced resource.

## Design

### Token format

Three reference kinds, stored verbatim in the message body:

```
[protocol:<study_number>]    e.g. [protocol:PP06489]
[participant:<participant_code>]   e.g. [participant:P-0023]
[visit:<uuid>]               e.g. [visit:abc-def-…]
```

Protocols and participants use their user-facing semantic ids
(`study_number`, `participant_code`) — those are unique within an org.
Visits have no canonical short code, so the UUID is used and the chip
renders the resolved display name (e.g. "Visit 5 · P-0023 · Day 5").

The token regex matches each kind cleanly:

```
\[(protocol):([A-Za-z0-9_-]+)\]
\[(participant):([A-Za-z0-9_-]+)\]
\[(visit):([0-9a-fA-F-]+)\]
```

### Composer flow

Same shape as `@`-mentions Phase A:

1. User types `[` somewhere word-boundary-eligible (start of text or
   after whitespace).
2. A reference picker opens above the textarea showing accessible
   protocols + active-protocol's loaded visits + active-protocol's
   loaded participants. Each row shows: category icon, display name,
   secondary id ("PP06489 · 5 visits", "Visit 5 · Day 5",
   "P-0023 · Active").
3. Filter chars after `[` narrow the list (matches across display
   text and id).
4. Pick → token inserted at the `[` position, picker closes. Caret
   lands after the closing `]` and a trailing space.
5. Escape / blur / typing whitespace before picking dismisses the
   picker (the literal `[…` stays as plain text).

Cross-protocol items aren't autocomplete-able in v1 (data isn't
loaded for non-active protocols). Users can type the syntax manually
to reference a different protocol's visit/participant; the renderer
will show "Not loaded" gracefully.

### Render flow

`renderMessageBody` already handles `<@<uuid>>` mention tokens.
Extend it to also parse the three reference token shapes and emit
`ReferenceChip` components for each. Plain text segments render as
today. Chip styling differentiates the three kinds with subtle
background colors.

### Click behavior

- **`[protocol:CODE]`** — `setActiveProtocol(matchedProtocol)` from
  `useProtocol`. The chat tab stays open; the rest of the app
  follows the new active protocol on next view. Quick and uncoupled.
- **`[visit:UUID]`** — opens a `ReferencePopover` inline showing the
  visit's display fields if available in `useSiteData().visits`
  (name, study day, participant code, scheduled date, status). If
  not in the current SiteData snapshot (e.g. user is in a different
  active protocol), the popover renders "Visit not loaded — switch
  to the right protocol to view details." A "Go to visit" button
  inside the popover is grey "coming soon" for v1; v2 wires cross-tab
  navigation.
- **`[participant:CODE]`** — same pattern as visit but for
  `useSiteData().participants`. Popover shows: code, status,
  enrolled date, current study day, next visit name+date,
  assigned coordinator.

### Cross-mode nav — out of scope

Full cross-tab navigation (clicking a visit chip → switches to
Site Mode → visit-execution tab → opens that visit's drawer) needs
either:
- An App-level router callback piped down to ChatTab, or
- A new shared NavigationContext

That's significant plumbing. v1 ships the references + summary
popovers; v2 wires the "Go to" buttons.

## Scope (files allowed)

### New

- `src/components/dashboard/organization/chat/ReferenceChip.tsx` —
  styled chip for a single reference; click opens the appropriate
  action (protocol switch or summary popover).
- `src/components/dashboard/organization/chat/ReferencePopover.tsx` —
  inline floating card showing the visit/participant summary.
- `plans/kiara/chat-cross-mode-refs.md` — this file.

### Modified

- `src/components/dashboard/organization/ChatTab.tsx`:
  - Composer popover for `[` — picker with category icon + display +
    secondary id rows; keyboard nav + filter
  - `renderMessageBody` extended to also parse and emit `ReferenceChip`
  - State: `referencePicker` (mirrors `mentionPicker`'s shape)

### Out of scope

- Cross-tab navigation. v2.
- @-style "you were referenced" notifications (e.g. notify the
  participant's assigned coordinator when their record is mentioned).
- Auto-suggest references based on the user's typing context
  ("you typed P-0023; want to make that a participant link?").
- Reference indexing tables (no `chat_references` table — references
  are inline in the body, like mentions, and resolved at render time).

## Architecture layers touched

- [ ] migration
- [ ] RPC
- [ ] adapter
- [ ] context (uses existing useSiteData + useProtocol)
- [x] component (chat only)
- [ ] test

## Mock data plan

None. Demo mode users get whatever their SiteData mock provides; the
popover gracefully shows "not loaded" if a reference resolves to
nothing.

## Approved-by

Self-only — all files in `src/components/dashboard/organization/chat/`.

## Verification

- `npx tsc --noEmit --skipLibCheck -p tsconfig.app.json` → 0 errors
- Manual:
  - Type `[` in composer → picker shows accessible protocols + active
    protocol's visits + active protocol's participants
  - Filter narrows by typed chars (case-insensitive, matches display
    + id)
  - Pick a protocol → composer text reads `[protocol:PP06489] `;
    on send, the message bubble shows a clickable chip
  - Click the protocol chip → active protocol switches; the protocol
    picker in navbar reflects the change
  - Pick a participant → composer reads `[participant:P-0023] `;
    chip clickable; click opens a popover with the participant
    summary
  - Pick a visit → composer reads `[visit:<uuid>] `; chip resolves
    to the visit's display name; click → popover with visit summary
  - Manually type `[participant:P-9999]` for a participant not in
    SiteData → chip renders with "Not loaded" styling; click → popover
    says "Participant not loaded"
  - Picker dismisses on Esc, on blur, on typing whitespace before
    selecting
  - References work in both `#general` and protocol channels
