---
owner: ki-dev-piqc
feature: protocol-collaboration
status: active
started: 2026-05-29
target_pr:
---

# Protocol collaboration — per-protocol chat, file sharing, contamination-safe uploads

## Context

Teams collaborating on a protocol need a single place to talk, upload reference documents (parsed PDFs, SAP excerpts, monitoring letters), and record decisions — without that conversation leaking into other protocols. Today that conversation happens in Slack or email, decoupled from the protocol record.

This PR adds a **Collaborate** tab inside the protocol view (`/protocol/:id/collaborate`). Scope and access are inherited from `protocol_members` (introduced in `plans/kiara/org-workspaces.md`). Uploaded files are scoped to the protocol by URL — there is no protocol picker on the upload surface, which eliminates the single largest class of cross-protocol contamination at the design level.

**Hard dependency:** the org-workspaces plan must land first. The `user_can_access_protocol(uid, pid)` function it introduces is the basis for all RLS in this PR. If org-workspaces is mid-flight, this PR sits behind it on the branch graph; do not merge out of order.

## Scope (files allowed)

### Migrations

Timestamps assume this plan ships AFTER org-workspaces (latest `20260618000700`). Update on rebase.

- `supabase/migrations/2026XXX0000_protocol_messages_table.sql` (NEW — includes decision capture columns + message_kind/system_event_* columns + acknowledgment_requested_from)
- `supabase/migrations/2026XXX0100_protocol_files_table.sql` (NEW)
- `supabase/migrations/2026XXX0200_protocol_file_audit_log.sql` (NEW)
- `supabase/migrations/2026XXX0300_protocol_files_storage_bucket.sql` (NEW — creates the `protocol-files` Supabase Storage bucket with policy bound to `user_can_access_protocol`)
- `supabase/migrations/2026XXX0400_protocol_message_refs.sql` (NEW — cross-mode reference chips)
- `supabase/migrations/2026XXX0500_protocol_message_acknowledgments.sql` (NEW — read-confirmation table)
- `supabase/migrations/2026XXX0600_post_system_event_helper.sql` (NEW — SECURITY DEFINER helper that other modes' triggers call to drop auto-import events into chat)
- `supabase/migrations/2026XXX0700_seed_system_user.sql` (NEW — seeds the `auth.users` row that owns system messages)
- `supabase/migrations/2026XXX0800_collaborate_rls.sql` (NEW — RLS for messages, files, audit log, refs, acknowledgments)
- `supabase/migrations/2026XXX0900_example_system_event_triggers.sql` (NEW — ONE or TWO example triggers proving the pattern; other modes add their own in their PRs)

### Types

- `src/types/collaborate/index.ts` (NEW)

### Lib

- `src/lib/collaborate/collaborateApi.ts` (NEW — `Result<T>`)
- `src/lib/collaborate/messagesAdapter.ts` (NEW — pure mapper)
- `src/lib/collaborate/filesAdapter.ts` (NEW — pure mapper)
- `src/lib/collaborate/fingerprintAdapter.ts` (NEW — wraps the SOTR protocol-fingerprint parser; see Approved-by)
- `src/lib/parser-utils/protocolFingerprint.ts` (NEW — extracted from SOTR; pure utility, no mode-isolation violation)

### Context

- `src/context/CollaborationContext.tsx` (NEW — realtime channel on `protocol_messages` + `protocol_files` for the active protocol)

### Components

- `src/components/dashboard/collaborate/CollaborateTab.tsx` (NEW — top-level tab content, holds two sub-tabs: "Chat" and "Decisions")
- `src/components/dashboard/collaborate/MessageList.tsx` (NEW — renders user + system messages with ref chips, ack banners, decision banners)
- `src/components/dashboard/collaborate/MessageComposer.tsx` (NEW — includes @-trigger for cross-mode ref search, optional "require acknowledgment from…" picker)
- `src/components/dashboard/collaborate/CrossModeRefPicker.tsx` (NEW — popover that searches across modes when @ is triggered)
- `src/components/dashboard/collaborate/RefChip.tsx` (NEW — renders a cross-mode ref pill, click-to-jump)
- `src/components/dashboard/collaborate/PromoteToDecisionModal.tsx` (NEW — coordinator-only)
- `src/components/dashboard/collaborate/DecisionsTab.tsx` (NEW — filtered list of decision-promoted messages)
- `src/components/dashboard/collaborate/AcknowledgmentBanner.tsx` (NEW — orange "X acknowledged" header on messages with requested ack)
- `src/components/dashboard/collaborate/SystemEventMessage.tsx` (NEW — distinct rendering for message_kind='system_event')
- `src/components/dashboard/collaborate/FileUploadDropzone.tsx` (NEW)
- `src/components/dashboard/collaborate/FileCard.tsx` (NEW — renders fingerprint warning badge)
- `src/components/dashboard/collaborate/ContaminationWarningBanner.tsx` (NEW)
- `src/components/dashboard/collaborate/RemoveFileConfirmModal.tsx` (NEW — coordinator-only soft-delete)

### Routing

- The single file that wires the protocol-level route layout — confirm path during implementation; likely `src/App.tsx` or a `src/routes/protocol/*` index. Add `/protocol/:id/collaborate` and the tab nav entry. Flag for review: this is the only file outside `dashboard/collaborate/` we expect to touch.

### Ownership

- `docs/CODEOWNERS.md` — add `/src/lib/collaborate/`, `/src/components/dashboard/collaborate/`, `/src/types/collaborate/` → `@ki-dev-piqc`. Add `/src/lib/parser-utils/` as 2-reviewer because it's shared across modes.
- `plans/kiara/protocol-collaboration.md` (this file)

## Trial-specific features (v1 scope)

What separates this from "Slack inside PIQC" is purpose-built coordination primitives. Four features are in v1 scope, each tied to schema additions in the migrations:

### 1. Decision capture

A coordinator can promote any message to "decision" status with a one-line summary. Decisions render in a dedicated "Decisions" tab inside the protocol view and form the audit trail of what was agreed when.

- Column additions to `protocol_messages`:
  - `decision_summary TEXT` (NULL when not a decision)
  - `decision_promoted_at TIMESTAMPTZ`
  - `decision_promoted_by UUID REFERENCES auth.users(id)`
- Filter view: `SELECT … WHERE decision_summary IS NOT NULL ORDER BY decision_promoted_at DESC`.
- UI: each message gets a "Promote to decision" action (coordinator-only); the modal captures the summary text. Decisions are visually marked in the message stream (gavel icon + summary banner).
- Decisions can be demoted (clears the three columns) but every promote/demote writes an audit log row.

### 2. Cross-mode references

A message can link to specific objects in Site, Audit, SOTR, or Visit Execution mode. Renders as an inline chip ("→ Visit 4 (Day 14)" or "→ Audit Finding #12") that jumps to the source on click. This is the feature that makes the chat *part of* the trial coordination, not adjacent to it.

- New table:
  ```sql
  protocol_message_refs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    message_id UUID NOT NULL REFERENCES protocol_messages(id) ON DELETE CASCADE,
    ref_kind TEXT NOT NULL CHECK (ref_kind IN (
      'site_visit', 'site_participant', 'site_deviation',
      'audit_finding', 'audit_signal',
      'sotr_item',
      'visit_signal'
    )),
    ref_id UUID NOT NULL,
    ref_label_snapshot TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  CREATE INDEX protocol_message_refs_message_idx ON protocol_message_refs(message_id);
  CREATE INDEX protocol_message_refs_ref_idx ON protocol_message_refs(ref_kind, ref_id);
  ```
- `ref_label_snapshot` caches the human-readable label ("Visit 4 — Day 14 ±3") so the chat doesn't have to re-fetch the source object on every render. Refreshes when the source changes via a trigger (out of scope; manual refresh affordance for v1).
- UI: composer detects `@` followed by a search trigger ("@visit", "@finding") and opens a cross-mode search popover. Selecting a result inserts a ref pill.
- RLS: `protocol_message_refs` SELECT scoped via the parent message's protocol_id through `user_can_access_protocol`. Writes only by message author.

### 3. Read confirmation for compliance

An author can mark a message as requiring explicit acknowledgment from specific recipients (e.g., a monitor's letter that needs each coordinator to confirm receipt). The UI surfaces an orange banner asking the named users to click "I acknowledge"; their acknowledgments are recorded with timestamp and optional signature text. This is the regulatory backbone — eventually it can extend to 21 CFR Part 11-style e-signatures.

- New table:
  ```sql
  protocol_message_acknowledgments (
    message_id UUID NOT NULL REFERENCES protocol_messages(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    acknowledged_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    signature_text TEXT,
    PRIMARY KEY (message_id, user_id)
  );
  ```
- Column addition to `protocol_messages`:
  - `acknowledgment_requested_from JSONB` — array of user IDs the author wants confirmation from. NULL = no acknowledgment requested.
- UI: when composing, an "Require acknowledgment from…" picker lets the author select members of the protocol. The resulting message renders with an orange "X out of Y acknowledged" header. Each unacknowledged named user sees the "I acknowledge" button.
- v1 ships without cryptographic signatures; `signature_text` is a free-text "Acknowledged by name+date" string captured client-side. 21 CFR Part 11-grade signing is a follow-up.
- Audit log entry on every acknowledgment.

### 4. Auto-import events

System events from other modes auto-post into the protocol's chat — for example, "Audit signal raised: missing source for Visit 4" appears as a system message that the team can react to inline. Turns chat from a parallel conversation channel into the single timeline of *everything that's happened on this protocol*.

- Column additions to `protocol_messages`:
  - `message_kind TEXT NOT NULL DEFAULT 'user' CHECK (message_kind IN ('user', 'system_event'))`
  - `system_event_type TEXT` (NULL for user messages; values like `'visit_deviation'`, `'audit_finding_raised'`, `'sotr_conflict_detected'`)
  - `system_event_payload JSONB`
- For `message_kind='system_event'`, `user_id` references a special system user (`auth.users` row seeded by migration) and `body` is the rendered prose summary; the `system_event_payload` carries structured data the UI uses to link back to the source.
- Server-side: one trigger per event type, defined in the mode that owns the source table:
  - Visit Execution: trigger on `visit_completeness_signals` INSERT
  - Audit: trigger on `audit_findings` INSERT (or stage-advance, TBD with Karl)
  - SOTR: trigger on `sotr_conflicts` flagged (TBD with Ishika)
  - Site: trigger on `site_visits.status='deviation'` UPDATE
- Each trigger calls a single SECURITY DEFINER helper `post_system_event(protocol_id, event_type, payload)` that inserts the system message.
- v1 scope: ship the helper + UI rendering + at most TWO event types (deviation + audit finding); add more iteratively. Other modes' owners (Karl, Ishika) need to add their triggers in their own PRs.
- UI: system messages render with a distinct icon + muted styling; they're reactable and can be promoted to decisions (which is the killer combo: an auto-flagged deviation can be promoted into a decision about how to handle it).

## Out of scope (files forbidden)

- `src/components/dashboard/site/**`, `src/components/dashboard/audit/**`, `src/components/dashboard/sotr/**`, `src/components/dashboard/visit-execution/**` — mode isolation. (Cross-mode refs jump to those views via routing; collaborate doesn't import their components.)
- `src/lib/sotr/**` — we extract a *new* `parser-utils/protocolFingerprint.ts` rather than importing from `src/lib/sotr/` (mode isolation rule). The extraction is a pure refactor; SOTR continues to import the utility from its new home.
- Other modes' system-event triggers — Visit Execution / Audit / SOTR triggers are owned by their codeowners and ship in their PRs. This plan defines the `post_system_event` helper + one or two example triggers to prove the pattern.
- Anything in `src/lib/orgs/**` — that's `plans/kiara/org-workspaces.md`.
- File preview rendering for non-PDF types — v1 shows filename + download link; PDF preview only if cheap to add.

## v1.5 follow-up scope (tracked, separate plan)

Per Kiara's call: all of the following are desired but split out so the v1 PR is reviewable. Each gets its own plan MD when scheduled.

### Bedrock chat features
- @mentions with notification dots
- Reactions (single emoji set)
- Pinned messages (per protocol)
- Markdown rendering (lists, links, code, bold/italic)
- Threading > 1 level deep

### Audit-grade edit history
- `protocol_message_versions` table — every edit creates a new version row with `edited_at`, `edited_by`, prior `body`. The current `protocol_messages.body` is always the latest. Regulatory-grade chain of custody for what a message said when.
- "Show edit history" affordance on edited messages.

### Quality of life
- In-chat search (full-text on `body` + ref labels)
- Local draft persistence (composer text survives tab close — `localStorage` keyed by protocol_id)
- Typing indicator (Supabase presence channel)
- Top-level "All conversations" inbox aggregator across protocols
- Notifications, email digests, push

### Compliance hardening
- Cryptographic e-signatures on acknowledgments (21 CFR Part 11)
- Tamper-evident audit log (append-only on hash chain)
- Per-protocol retention policy enforcement

## Architecture layers touched

- [x] migration (5 new files, includes Storage bucket)
- [x] RPC (RLS policies, content-hash dedup query)
- [x] adapter (`src/lib/collaborate/`)
- [x] context (`CollaborationContext`)
- [x] component (collaborate/*)
- [x] test

## Mock data plan

None. Realtime + Storage require real Supabase. No localStorage toggle.

## Approved-by

- @rv61 — `supabase/migrations/**` and Storage bucket policy
- @ish-dev-piqc — for the `src/lib/parser-utils/protocolFingerprint.ts` extraction from `src/lib/sotr/`. The intent is a pure refactor: SOTR's existing parser logic moves to a non-mode utility, and SOTR re-imports from the new location. No semantic change to SOTR. Needs Ishika's sign-off before the refactor PR.
- @ish-dev-piqc + @ki-dev-piqc — `src/context/` (shared infra 2-reviewer rule); `docs/CODEOWNERS.md` (discipline package)
- *Depends on org-workspaces landing* — coordinate merge order with the prior plan

## Design

### Schema

```sql
CREATE TABLE protocol_messages (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  protocol_id UUID NOT NULL REFERENCES protocols(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES auth.users(id),
  body        TEXT NOT NULL,
  parent_id   UUID REFERENCES protocol_messages(id) ON DELETE SET NULL, -- single-level reply
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  edited_at   TIMESTAMPTZ,
  deleted_at  TIMESTAMPTZ -- soft delete
);

CREATE TABLE protocol_files (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  protocol_id           UUID NOT NULL REFERENCES protocols(id) ON DELETE CASCADE,
  uploaded_by           UUID NOT NULL REFERENCES auth.users(id),
  storage_path          TEXT NOT NULL,
  filename              TEXT NOT NULL,
  byte_size             BIGINT NOT NULL,
  content_hash          TEXT NOT NULL, -- sha256
  mime_type             TEXT NOT NULL,
  fingerprint_status    TEXT NOT NULL CHECK (fingerprint_status IN ('pending', 'match', 'mismatch', 'unparseable', 'skipped')) DEFAULT 'pending',
  fingerprint_extracted JSONB, -- {detected_protocol_id, study_number, sponsor, parsed_at}
  is_duplicate          BOOLEAN NOT NULL DEFAULT FALSE,
  duplicate_of_file_id  UUID REFERENCES protocol_files(id),
  uploaded_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  soft_deleted_at       TIMESTAMPTZ,
  soft_deleted_by       UUID REFERENCES auth.users(id),
  hard_delete_after     TIMESTAMPTZ -- 30 days after soft delete
);

CREATE INDEX protocol_files_content_hash_idx ON protocol_files (content_hash);

CREATE TABLE protocol_file_audit_log (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  protocol_id     UUID NOT NULL,
  file_id         UUID NOT NULL,
  user_id         UUID NOT NULL,
  action          TEXT NOT NULL CHECK (action IN ('uploaded', 'flagged_mismatch', 'flagged_duplicate', 'soft_deleted', 'hard_deleted', 'fingerprint_resolved')),
  metadata        JSONB,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### RLS

All three tables: `USING (user_can_access_protocol(auth.uid(), protocol_id))` (the function from org-workspaces).

Writes additionally restricted:
- `protocol_messages` INSERT/UPDATE: only the message author can edit/delete their own
- `protocol_files` UPDATE for `soft_deleted_at`: only coordinators of the protocol
- `protocol_file_audit_log` is append-only — no UPDATE/DELETE policy

### Cross-protocol contamination defenses (in order of strength)

**1. No protocol picker on upload (architectural).** The dropzone lives only inside `CollaborateTab` and pulls `protocol_id` from `useParams()`. Server-side, the upload RPC takes `protocol_id` from the call's URL context, not from the request body — even a manually crafted request can't redirect a file to a different protocol without first navigating to that protocol's tab (which requires being a member there).

**2. Client-side filename heuristic pre-check.** Before opening the upload to Storage, scan filename for protocol-ID-shaped strings using a regex tuned to clinical naming conventions: `[A-Z]{2,5}[-_]?\d{2,5}`. If the captured string doesn't match the current protocol's `study_number`, show a soft confirm dialog: "This file's name looks like protocol XYZ-001, but you're in ABC-002. Continue?" User must confirm to proceed. Skippable for a known-false-positive list (kept client-side).

**3. Server-side content fingerprint via shared parser.** On upload completion, an Edge Function (or RLS trigger) calls `parser-utils/protocolFingerprint(storage_path)`, which extracts the protocol number / sponsor / study title from page 1. Writes the result into `fingerprint_extracted` and flips `fingerprint_status`:
- `match` if extracted protocol ID matches the current protocol's metadata
- `mismatch` if it confidently parses to a different protocol's identifier
- `unparseable` if page 1 doesn't yield a clear identifier
- `skipped` if not a PDF or > some size threshold

`mismatch` triggers a `ContaminationWarningBanner` in the chat and an `audit_log.action='flagged_mismatch'` row. The file is *not* removed — only flagged — because mismatches are sometimes intentional (e.g. referencing a related study). A coordinator can resolve the flag (action `fingerprint_resolved`) or soft-delete.

**4. Content-hash duplicate detection across protocols.** On upload, query `protocol_files WHERE content_hash = NEW.content_hash AND id != NEW.id`. If a row exists for a *different* `protocol_id`, mark both rows `is_duplicate = TRUE`, link via `duplicate_of_file_id`, and surface a "this file is also in another protocol" badge on both. (Same-protocol duplicates are just re-uploads — fine.)

**5. Full audit log.** Every state change writes a row to `protocol_file_audit_log`. Coordinators have an "Activity" panel that renders the log for their protocol. Survives soft-delete.

**6. Soft-delete with 30-day grace.** Removed files set `soft_deleted_at` and `hard_delete_after = NOW() + 30 days`. A scheduled job hard-deletes after the grace period (out of scope for this PR; tracked as TODO). There is **no "move file to another protocol" action** — a misplaced file is deleted from the wrong protocol and re-uploaded to the right one. This keeps the audit log clean and prevents weird ghost states.

### Realtime

`CollaborationContext` opens a single channel per active protocol on mount: `supabase.channel('collab:<protocol_id>')` with `.on('postgres_changes', { table: 'protocol_messages' | 'protocol_files' })`. Closes on unmount. No realtime in components — context only (per CLAUDE.md architecture rules).

### Storage bucket policy

`protocol-files` bucket, NOT public. Storage path scheme: `<protocol_id>/<file_id>.<ext>`. Bucket policy reads `user_can_access_protocol` from the path's protocol_id component. This means Storage URLs are usable only when the requester has membership — and the URL itself contains the protocol_id, so even if someone manages to leak a signed URL it expires and can't be transferred to another protocol.

## Pre-work (process steps, not design questions)

1. **Schedule parser-extraction pairing with @ish-dev-piqc** before this branch starts coding. Walk through `src/lib/sotr/`'s protocol-fingerprint logic, agree on the minimal API to expose, and decide what stays SOTR-specific. Output of the pairing: a one-paragraph design note on the shared utility's public surface, appended to this plan before refactor PRs open.

## Open questions

1. **Server-side fingerprinting compute path.** Edge Function vs. database trigger that calls an RPC vs. background job. Edge Function is most flexible; background job is cheapest if many files arrive in bursts. Decide during implementation.
2. **PDF preview in `FileCard`?** Nice-to-have; add only if it doesn't add > 1 day to scope. Otherwise filename + download is fine.
3. **Hard-delete sweep job.** Cron mechanism (Supabase `pg_cron` vs. GitHub Actions vs. external) is a Roger-domain question. Tracked here, not solved here.
4. **Guest write-access default.** Guests inherit `user_can_access_protocol` (clause b) so they can read + post messages + upload files by default. Confirm that's the desired behaviour for v1 or add a `protocol_guests.is_read_only` flag. Recommend default-full-access; tighten later if customers ask.

## Verification

### Access scoping

- [ ] Two users A and B are both `protocol_members` of P1 → both see all messages, both can post, both see all files
- [ ] User C is a member of P2 only → cannot read any P1 message or file via API; the `/protocol/P1/collaborate` URL renders an access-denied state
- [ ] Guest user invited to P1 (via org-workspaces guest flow) → sees and participates in P1's collab; sees nothing of P2
- [ ] User removed from `protocol_members` of P1 → realtime updates stop arriving, page navigation locks them out on next request

### Contamination defenses

- [ ] Upload a PDF named `XYZ-001_protocol_v2.pdf` while viewing protocol ABC-002 → client-side modal asks for confirmation before upload starts
- [ ] Skip the modal, upload anyway → server fingerprint runs → `fingerprint_status='mismatch'`, banner appears in chat, audit row written
- [ ] Coordinator clicks "Resolve" on the warning → status flipped to `match`, audit row written, banner disappears
- [ ] Upload the same file (identical content hash) to a *different* protocol — both rows flipped to `is_duplicate=TRUE`, badge appears on both file cards
- [ ] Soft-delete a file → disappears from chat, audit row written, `soft_deleted_at` set, `hard_delete_after` 30 days out, Storage object remains
- [ ] Coordinator's Activity panel renders the audit log in chronological order with action labels

### Realtime

- [ ] A posts a message → B sees it in < 1s without refresh (Supabase Realtime)
- [ ] A uploads a file → B sees the FileCard appear (status 'pending' first, then transitions to 'match'/'mismatch') without refresh
- [ ] B closes the tab → realtime channel closes; no leaked subscription

### Storage policy

- [ ] User C (not a member of P1) attempting a direct Storage URL to a P1 file → 403
- [ ] Member A's signed URL works for the file's full lifetime as expected; after A is removed from `protocol_members`, the URL stops working on next bucket-policy check

### Mode isolation

- [ ] `piqc-review` passes: no `collaborate/*` imports `site/*`, `audit/*`, `sotr/*`, or `visit-execution/*`
- [ ] SOTR's tests still pass after the `parser-utils/protocolFingerprint.ts` extraction
