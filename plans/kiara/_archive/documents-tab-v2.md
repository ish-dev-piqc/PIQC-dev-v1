---
owner: ki-dev-piqc
feature: documents-tab-v2
status: merged
merged: 2026-06-13
started: 2026-06-13
target_pr: #335
---

# Documents tab v2 — drag-drop, search, preview, sort

## Context

Documents tab v1 (PR 5) shipped the unified doc list (Reducto + uploads +
chat attachments) with a pinned board, scope pills, upload button, and
gated delete. Four polish items remain to make it feel like a real
file browser:

- Drag-drop upload zone
- Search input (substring on filename)
- Preview pane (right slide-in for PDFs / images / metadata)
- Sort dropdown (Name / Newest / Largest)

Out of scope: bulk select, version history, in-place rename, full-text
search inside docs (would need pg_trgm or a vector index — separate PR).

## Design

### Drag-drop upload

A full-tab drop overlay activates when a `dragenter` event arrives with
`dataTransfer.types` including `Files`. Dropping calls the existing
`uploadProtocolDocument` RPC with the same scope rules as the file-picker
button (protocol scope → protocol_id; org scope → org_id). The Upload
button stays as the fallback for keyboard users.

Single-file uploads only — multi-file is a polish follow-up because we
don't yet have a progress UI for parallel uploads.

### Search

Single text input at the top of the tab, debounced 150ms. Case-insensitive
substring match against `row.name`. Empty input shows everything. Matching
happens after scope filtering — pinned board respects the search filter
too (a search that hides every pinned row hides the board entirely).

### Preview pane

Clicking a row opens a right-side slide-in pane (~480px on desktop,
full-width drawer on mobile). Content depends on family:

- `pdf` — `<iframe src={signedUrl}#toolbar=0>` inline
- `image` — `<img src={signedUrl}>` contained
- everything else — metadata block (name, size, uploaded by, date, source
  pill) + "Open in new tab" button using the signed URL

Close on `Esc`, backdrop click, or X button. Reused signed-URL helpers
(`signProtocolDocumentUrl`, `signChatAttachmentUrl`) — Reducto docs get
their existing URL field.

### Sort

Dropdown next to the search input. Three options:

- Newest (default) — `created_at` desc
- Name — `name` asc, case-insensitive
- Largest — `size_bytes` desc, nulls last

Applies after search filtering. The pinned board uses the same sort so
ordering is consistent between regions.

## Scope (files allowed)

### New

- `plans/kiara/documents-tab-v2.md` — this file.
- `src/components/dashboard/organization/DocumentPreviewPane.tsx` — new
  preview pane component.

### Modified

- `src/components/dashboard/organization/HubDocumentsTab.tsx` — search +
  sort + drop overlay wiring + open-preview action on row click.

## Architecture layers touched

- [x] component

No new RPCs, no adapters, no migrations. All work is client-side over the
existing data model.

## Mock data plan

None.

## Approved-by

Self (kiara — Site Mode / hub).

## Verification

- `npx tsc --noEmit --skipLibCheck -p tsconfig.app.json` → 0 errors
- Manual:
  - Drag a file from Finder onto the Documents tab → drop overlay shows
    "Drop to upload to <scope>" → release → file appears in the list.
  - Type into the search box → list narrows on substring of filename.
    Pinned board respects the search.
  - Sort dropdown — pick Name → alphabetical; Largest → biggest first;
    Newest (default) → most recent first.
  - Click a PDF row → preview pane slides in with embedded PDF. Click an
    image row → image preview. Click an unknown type → metadata + Open in
    new tab.
  - Esc / X / backdrop close the pane.
  - Mobile: pane covers full screen, drag-drop disabled (browsers don't
    fire dragenter for file inputs there — fall through to file picker).
