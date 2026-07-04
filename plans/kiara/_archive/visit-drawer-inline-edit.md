---
owner: ki-dev-piqc
feature: visit-drawer-inline-edit
status: merged
merged: 2026-06-06
started: 2026-06-04
target_pr: #297
---

# Visit drawer + participant drawer — inline-edit polish

## Context

Two free-text fields are read-only in their current drawers:

- `SiteVisit.priorNote` and `SiteVisit.deviationReason` in
  `VisitDetailDrawer`.
- `SiteParticipant.notes` in `ParticipantProfileDrawer`.

To change them coordinators have to fall back to a separate edit
form (or the DB). This PR adds inline click-to-edit on the existing
text so the obvious workflow ("I see a typo / want to clarify a
deviation reason → click it and type") just works.

## Design

### New component — `InlineEditableText.tsx`

Reusable. Displays the current text; clicking it (or the
optional pencil icon when text is empty) swaps the view for a
`<textarea>`. Save with Cmd/Ctrl+Enter or click Save; cancel with
Esc or click Cancel. Auto-focus on enter. Trim on save; empty
saves as `null`.

```ts
interface InlineEditableTextProps {
  value: string | null;
  placeholder?: string;       // shown when value is null/empty
  emptyLabel?: string;        // CTA before first edit ("Add a note…")
  onSave: (next: string | null) => Promise<void>;
  rows?: number;
  disabled?: boolean;         // for non-author / non-admin views
}
```

Component is presentation + minimal state; persistence happens via
`onSave`. Failed save surfaces a small inline error and keeps the
textarea open so the user doesn't lose typed text.

### Wiring

- `VisitDetailDrawer` — replace the two read-only paragraphs:
  - `priorNote` block at line 390 → `<InlineEditableText
    value={visit.priorNote} onSave={(next) => updateVisit(visit.id,
    { prior_note: next })} ... />`. Always editable.
  - `deviationReason` block at line 264 → same pattern with
    `deviation_reason`. Only editable when `visit.status ===
    'deviation'` (otherwise hide).
- `ParticipantProfileDrawer` — wrap the existing notes paragraph
  in the editable component, persisting via `updateParticipant(
    participant.uuid, { notes: next })`. Always editable.

### Permissions

Open question — for v1 the drawer doesn't gate any of these by
role, and coordinators already write directly to the visit table
via the existing "Mark completed" button. Inline-edit follows the
same loose model. If we later want PI / admin-only gating, an
`isReadonly` prop on the drawer flows down to
InlineEditableText's `disabled`.

## Scope (files allowed)

### New

- `src/components/dashboard/site/InlineEditableText.tsx`
- `plans/kiara/visit-drawer-inline-edit.md` — this file.

### Modified

- `src/components/dashboard/site/VisitDetailDrawer.tsx`
- `src/components/dashboard/site/ParticipantProfileDrawer.tsx`

## Architecture layers touched

- [x] component

## Mock data plan

None.

## Approved-by

Self-only — Site Mode files.

## Verification

- `npx tsc --noEmit --skipLibCheck -p tsconfig.app.json` → 0 errors
- Manual:
  - Open a visit drawer → click the priorNote text → textarea
    opens → type → Save → text updates inline, drawer stays open.
  - Same for deviationReason on a deviation visit.
  - Open a participant drawer → notes → click → edit → save.
  - Esc cancels without saving.
  - Empty save → field becomes null → re-renders the "Add a
    note…" placeholder.
