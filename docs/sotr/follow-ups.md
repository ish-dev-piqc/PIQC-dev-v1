# Source of Truth Reviewer (SOTR) — Follow-ups

_Last updated: 2026-05-09 (PR-7 hardening pass)._

This document tracks deferred work that came out of the PR-1 → PR-7 build.
Items here are **intentionally not built** — flagged so they don't get
hidden in code TODOs and so the dev team can prioritize them as separate
PRs.

---

## High priority

### F-001 · Embedded PDF viewer + page jump + highlight overlay

**Status:** PR-4 originally planned to ship this; was scope-cut to
"PDF storage + secure access foundation" only. The user-visible behavior
today is `ViewCitedPageButton` → opens the signed URL in a new browser tab.

**What's needed:**
- Add `react-pdf` (or `pdfjs-dist` + a thin React wrapper). Configure the
  PDF.js worker for Vite — non-trivial; verify dev + build + test paths.
- Replace `window.open(url, '_blank')` in `ViewCitedPageButton` with an
  in-drawer viewer that loads the signed URL.
- Implement page jump on source select; update on prev/next navigation.
- Add coordinate translation helper (see F-002).
- Highlight overlay only when bbox is verified-valid.
- Friendly fallback when PDF fails to load: "Exact highlight unavailable.
  Showing cited page and quoted source text."
- Tests: viewer presence, page jumps on source switch, valid bbox →
  highlight, invalid → fallback, no raw URLs in DOM.

**Why deferred:** combining storage + viewer + coordinate verification in
one PR was high-risk; PR-4 split lets the foundation deploy independently.

---

### F-002 · Verify Reducto's coordinate system before rendering highlights

**Status:** PR-1 stored `bounding_boxes` as `JSONB` with shape
`[{page, x1, y1, x2, y2}]`. The user-facing spec uses `{page, x, y, width,
height}`. These are trivially convertible (`width = x2 - x1`), but a more
fundamental question is **unanswered**: does Reducto report PDF points
(top-left origin), PDF points (bottom-left origin), or normalized
coordinates?

**What's needed:**
- Upload a known protocol PDF, inspect the raw Reducto extract response,
  and confirm origin + units against the rendered viewer.
- Add a small isolated helper `convertReductoBboxToViewerBbox(bbox, page)`
  with unit tests covering each branch (origin flip, scale).
- If the coordinate system **cannot be verified safely**, ship the viewer
  without highlights and keep the "Exact highlight unavailable" copy.

**Why deferred:** can't be verified without sample data and a working
viewer. Pairs with F-001.

---

### F-003 · Audit Mode wiring

**Status:** SOTR is currently surfaced only in Site Mode (the Protocol
tab). Components in `src/components/sotr/` are mode-agnostic by design
— no Site Mode imports — so wiring into Audit Mode is purely additive.

**What's needed:**
- Decide where in the audit workspace shell SOTR fits (likely a per-stage
  side panel inside `AuditWorkspaceShell`, gated by stage).
- The active audit's `protocol_version_id` joins back to a protocol; pass
  the protocol's UUID as `studyId` to `<WorksheetItemsList>` /
  `<SourceTruthDrawer>`.
- Update `plan.md`'s Audit Mode table to reflect SOTR availability.

**Why deferred:** Site Mode was the natural first home (ProtocolTab had a
`documents-pending` placeholder ready to replace). Audit Mode wiring is
straightforward but each audit stage has its own UX context to consider.

---

## Medium priority

### F-004 · Backfill `documents.storage_path` for previously-ingested PDFs

**Status:** All documents seeded or ingested before PR-4 have
`storage_path = NULL`. Their original PDF bytes are gone — Reducto kept
them transiently, we never persisted them. The "View cited page in
protocol" button shows the friendly "No PDF stored for this document"
copy for those rows permanently.

**Options:**
1. **Accept the gap.** Only freshly-ingested PDFs are viewable. Document
   this in the user help.
2. **Re-ingest from source.** If the customer still has the PDFs, re-run
   the ingest flow with `upsert: true` on storage to populate paths.
3. **Bulk delete pre-PR-4 documents** in dev/staging environments to
   remove the friendly-error rows.

No code change required for option 1.

---

### F-005 · Review history display in the SOTR drawer

**Status:** `worksheet_review_events` rows are written for every action
(PR-5) and exported into the CSV (PR-6), but **never shown in the UI**.
The original Sprint 5 prompt allowed skipping this if it was too much
work; it was skipped.

**What's needed:**
- New RPC: `sotr_list_worksheet_review_events(study_id, item_id)` →
  paginated review-history list, study-scoped, RLS as elsewhere.
- New TS wrapper + hook.
- Add a collapsed "Review history" section to `SourceTruthPanel` with
  action / reviewer / timestamp / truncated note rows.

**Why deferred:** the events are durable in the DB and queryable through
the export; the read-side UI is a strict UX add, not a correctness gap.

---

### F-006 · Optimistic concurrency on edit_draft_item · **Closed**

**Closed 2026-05-14 (product decision).** PIQC Audit Mode is sold as a
single-auditor product — there are no concurrent-use scenarios planned.
The racing-edit window cannot meaningfully open. `worksheet_review_events`
already preserves a full per-action audit trail if any future scenario
exposes the race.

**Original status (kept for context):** `sotr_create_review_event` locks
the row `FOR UPDATE` so concurrent edits don't race the version bump,
but the client doesn't send a `worksheet_item_version` to assert against.
If two users were to open the same item in two tabs, the second edit
would silently overwrite the first (both events recorded, only the
second `current_text` surviving).

**Trigger to revisit:** if PIQC's pricing model ever supports multiple
auditors on a single audit, or if Site Mode adds team-collaboration on
the same study's worksheet items.

---

### F-007 · Bulk review mode

**Status:** explicitly listed in the Sprint 7 guardrails as **not** to
build. Captured here as a known feature request.

**Why deferred:** out of scope for the lean draft review aid. If users
end up reviewing hundreds of items per study, revisit.

---

## Low priority

### F-008 · `field_type` is a free-text TEXT column

**Status:** `protocol_extracted_items.field_type` is `TEXT` rather than
an enum. The adapter writes a fixed vocabulary (`endpoint`, `criterion`,
`visit`, `dosing`, `metadata`), but nothing enforces it.

**Trade-off:** keeping it free-text avoids a migration every time the
parser learns a new field category. Worth converting to enum if and
when the vocabulary stabilizes.

---

### F-009 · `protocol_extracted_items.created_at` and `updated_at` not
returned by the worksheet item RPCs

**Status:** the read RPCs (`sotr_get_worksheet_item_evidence`,
`..._batch`) don't surface `created_at` / `updated_at`. The TypeScript
type `ExtractedItemRecord` has them. This means a row's freshness can't
be shown in the SOTR drawer without a separate query.

**Fix:** additive — add the two timestamps to the RPC response. Low
priority; no current consumer needs them.

---

### F-010 · Export format alternatives (PDF/DOCX)

**Status:** PR-6 ships CSV only, matching the existing `ReportsTab`
pattern. The user-facing prompt allowed PDF/DOCX "if the app already
has that infrastructure." The audit-mode Stage 8 export uses `docx`
v9 — that infrastructure exists if a richer export is wanted.

**When to build:** if reviewers consistently say the CSV is hard to read
in Excel, or if they want a printable summary. The disclaimer-at-top
pattern would carry over directly to a `.docx` cover page.

---

## Closed (resolved during PR-7)

- **DRY: stringify `extracted_value`** — extracted into
  `_sotr_extracted_value_to_text` helper.
- **TS literal unions for `review_status`** — replaced with the
  `DraftReviewStatus` type alias.
- **Architecture documentation** — added `docs/sotr/architecture.md`.

---

## Out of scope (do not build without explicit product approval)

These would change PIQC's product positioning. Captured here so a future
contributor doesn't add them by accident.

- Electronic signature / final approval workflows
- Part 11 / GxP audit-trail features (PIQC's review history is a
  drafting aid, **not** a regulated audit trail)
- Protocol chat / AI Q&A inside the SOTR drawer
- Amendment diffing
- Analytics dashboards on review metrics
- Writing back annotations to the source PDF
- **Multi-auditor / co-auditor access models** (product decision
  2026-05-14): each PIQC audit has one auditor. The "lead auditor"
  title is a user-managed label, not a multi-user concept. PDF storage
  RLS (`auth.uid()::text = (storage.foldername(name))[1]`) and
  RPC ownership (`documents.user_id = auth.uid()`) correctly enforce
  single-user access.
- **Concurrent editing** of the same worksheet item by multiple
  users (same product decision 2026-05-14) — see F-006 above.
