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

- `supabase/migrations/20260601000000_protocol_messages_table.sql` (NEW)
- `supabase/migrations/20260601000100_protocol_files_table.sql` (NEW)
- `supabase/migrations/20260601000200_protocol_file_audit_log.sql` (NEW)
- `supabase/migrations/20260601000300_protocol_files_storage_bucket.sql` (NEW — creates the `protocol-files` Supabase Storage bucket with policy bound to `user_can_access_protocol`)
- `supabase/migrations/20260601000400_collaborate_rls.sql` (NEW — RLS for messages, files, audit log)

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

- `src/components/dashboard/collaborate/CollaborateTab.tsx` (NEW — top-level tab content)
- `src/components/dashboard/collaborate/MessageList.tsx` (NEW)
- `src/components/dashboard/collaborate/MessageComposer.tsx` (NEW)
- `src/components/dashboard/collaborate/FileUploadDropzone.tsx` (NEW)
- `src/components/dashboard/collaborate/FileCard.tsx` (NEW — renders fingerprint warning badge)
- `src/components/dashboard/collaborate/ContaminationWarningBanner.tsx` (NEW)
- `src/components/dashboard/collaborate/RemoveFileConfirmModal.tsx` (NEW — coordinator-only soft-delete)

### Routing

- The single file that wires the protocol-level route layout — confirm path during implementation; likely `src/App.tsx` or a `src/routes/protocol/*` index. Add `/protocol/:id/collaborate` and the tab nav entry. Flag for review: this is the only file outside `dashboard/collaborate/` we expect to touch.

### Ownership

- `docs/CODEOWNERS.md` — add `/src/lib/collaborate/`, `/src/components/dashboard/collaborate/`, `/src/types/collaborate/` → `@ki-dev-piqc`. Add `/src/lib/parser-utils/` as 2-reviewer because it's shared across modes.
- `plans/kiara/protocol-collaboration.md` (this file)

## Out of scope (files forbidden)

- `src/components/dashboard/site/**`, `src/components/dashboard/audit/**`, `src/components/dashboard/sotr/**`, `src/components/dashboard/visit-execution/**` — mode isolation
- `src/lib/sotr/**` — we extract a *new* `parser-utils/protocolFingerprint.ts` rather than importing from `src/lib/sotr/` (mode isolation rule). The extraction is a pure refactor; SOTR continues to import the utility from its new home.
- Top-level `/collaborate` route or org-level "all conversations" inbox — future enhancement; this PR is per-protocol only
- Notifications, email digests, push — future
- Threading deeper than one level (replies-as-quote pattern is sufficient for v1)
- Reactions / emoji / mentions — future
- File preview rendering for non-PDF types — v1 shows filename + download link; PDF preview only if cheap to add
- Anything in `src/lib/orgs/**` — that's `plans/kiara/org-workspaces.md`

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
