---
owner: fable-dev-piqc
feature: amendment-refresh
status: in-review
started: 2026-07-05
target_pr:
---

# Amendment-Aware Refresh — change visibility after regenerate

## Context

Handover Phase 5 / §7.2 — the last unmet acceptance criterion: "supports
amendment-aware refresh without overwriting human edits." The engine's
regenerate already does the hard half (human edits preserved; touched
blocks whose source vanished are kept + flagged; rejected content never
resurrected). What's missing is **visibility**: after an amendment
re-ingest + regenerate, a reviewer cannot see what is NEW, what was
REMOVED, or why blocks got flagged — pristine deletions vanish silently
and new blocks look like old ones. This slice makes every regenerate
tell its change story, across all four existing deliverables at once.

## Design

### Data (migration `20260715000000_deliverable_amendment_refresh.sql`)

NOTE: `20260714*` slots were consumed by the visit-prep re-land (#421)
and its renumber fix (#423) — v6 starts at 20260715000000.

- `ALTER TABLE protocol_deliverables ADD COLUMN generation_seq INTEGER
  NOT NULL DEFAULT 1` — incremented by every generate.
- `ALTER TABLE protocol_deliverable_blocks ADD COLUMN generation_seq
  INTEGER NOT NULL DEFAULT 1` — stamped with the deliverable's NEW seq
  on insert; matched blocks keep the seq they were born with. A block is
  "new since the previous generation" iff its seq equals the
  deliverable's.
- NEW table `deliverable_generation_log` (append-only, RLS like edits):
  id, deliverable_id FK CASCADE, generation_seq, protocol_version,
  generated_by, generated_at, blocks_created, blocks_matched,
  blocks_kept_flagged, blocks_deleted, `removed_blocks JSONB` — snapshots
  `{section_key, block_type, derived_text}` of the pristine drafts the
  regenerate deleted (the ONLY record they existed; touched blocks are
  never deleted so nothing human is ever only-in-the-log).
- `deliverable_generate` v6: seq increment + stamping + log row +
  kept-flagged count. All four artifact branches BYTE-PRESERVED from v5
  (the changes live in the shared upsert/match/apply stages only).
- `deliverable_get_packet` v2: packet gains `generation_seq` (deliverable)
  and per-block `generation_seq`.
- NEW RPC `deliverable_get_change_summary(p_deliverable_id)` — INVOKER:
  the latest generation-log row + the lists a reviewer needs: new blocks
  (id/section/display_text), removed snapshots (from the log JSONB), and
  currently-flagged blocks (review_state = 'needs_review' — regenerate
  flags orphaned-touched blocks with exactly this state; reviewer flags
  land in the same queue by design, one list to work through).

### Client

- Types: packet fields, `DeliverableGenerationLog`, change-summary
  shapes. Adapter: tolerant additions (missing generation_seq degrades
  to 1 — old packets keep adapting). API: `fetchChangeSummary`.
- `DeliverableBlockRow`: quiet "New" chip when
  `block.generation_seq === packet.generation_seq` AND the deliverable
  has regenerated at least once (seq > 1) — first generation is not
  "change", it is birth.
- `DeliverablePanel`: after a regenerate (and on load when the latest
  log row has changes), a collapsible **"What changed"** banner: counts
  (new / removed / flagged) + expandable lists; removed snapshots render
  read-only with the section label. Reuses existing chrome; no new
  drawer.

### Dev-team tee-up (NOT in scope)

Source-level fact diffing at ingest (old vs new protocol text) is the
Reducto lane — appended to ACTIVATION.md as the named enrichment path.
This slice's change story is deliverable-side and stands alone.

## Scope (files allowed)

- `plans/fable/amendment-refresh.md` — this file.
- `src/types/deliverables/index.ts` — packet/log/summary shapes.
- `src/lib/deliverables/deliverablesAdapter.ts` + test — new fields.
- `src/lib/deliverables/deliverablesApi.ts` + test — fetchChangeSummary.
- `src/components/deliverables/DeliverableBlockRow.tsx` — "New" chip.
- `src/components/deliverables/DeliverableBlockList.tsx` — ONE optional
  prop (`latestGenerationSeq`) threaded to rows; the chip cannot know the
  packet's seq otherwise (scope amended during build — same
  exhaustive-threading class as the #414 copy-map lesson).
- `src/components/dashboard/sponsor/deliverables/DeliverablePanel.tsx` —
  what-changed banner.
- `supabase/migrations/*_deliverable_amendment_refresh.sql` (new).
- `docs/deliverables/ACTIVATION.md` — migration queue append + QA +
  ingest-diffing tee-up.

## Out of scope (files forbidden)

- All four selection specs — selection is untouched; this is
  generate/packet machinery.
- `deliverablesExportApi.ts` / exporters — exports render current state;
  change-story-in-PDF is future debt (named; trigger: sponsor asks for
  an amendment-impact packet).
- `src/lib/actions/**` — an 'amendment_changed' ActionCard is named debt
  (trigger: first real amendment regenerate on dev).
- Ingest pipeline, modes, contexts, entitlements; merged migrations.

## Architecture layers touched

- [x] migration (1 new: columns + log table + generate v6 + packet v2 +
  summary RPC)
- [x] RPC
- [x] adapter (tolerant field additions)
- [ ] context
- [x] component (row chip + panel banner)
- [x] test (adapter fields, api, summary shapes)

## Mock data plan

None.

## Approved-by

- Roger (`@rv61`) — `supabase/migrations/*`; ACTIVATION.md queue grows
  to eight and gains the ingest-diffing tee-up section for his lane.

## Verification

- [x] typecheck / build green; 789/789 src/lib (298 deliverables incl.
  15 new); zero new full-suite failures vs baseline.
- [x] Old-packet tolerance: adapter test proves packets WITHOUT
  generation_seq still adapt (dev DB not yet migrated ≠ broken UI).
- [x] Migration audit: exactly 8 hunks, all in shared stages; all four
  branch sections byte-identical to v5; pglast 18 statements + 3 bodies;
  RETURN contract unchanged.
- [ ] Manual (post db push): generate → no banner (seq 1); regenerate
  after re-ingest → banner shows new/removed/flagged with lists; "New"
  chips on inserted blocks; human-edited blocks never in removed list.
- [x] `piqc-review` clean (12 files in scope, 0 style/arch hits).

## Decisions encoded

1. **Deliverable-side change story only** — no invented source diffs;
   ingest-side fact diffing is the dev team's named enrichment.
2. **Removed-snapshot minimalism**: only pristine drafts can be deleted
   by regenerate, so the log snapshots {section, type, text} and nothing
   else — no shadow table of full block corpses.
3. **One flag queue**: regenerate-flagged and human-flagged blocks share
   'needs_review' deliberately — a reviewer works one list; the banner
   is the amendment-context lens over it.
4. **First generation is birth, not change** — no banner, no New chips
   at seq 1.
5. Export/actions integration deferred with named triggers (see Out of
   scope).
