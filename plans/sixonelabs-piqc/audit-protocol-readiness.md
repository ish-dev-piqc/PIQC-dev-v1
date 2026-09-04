---
owner: sixonelabs-piqc
feature: audit-protocol-readiness
status: active
started: 2026-09-04
target_pr:
---

# Audit Mode: honest parse status and a guarded upload at Stage 1

## Context

Inside an audit nothing shows whether the protocol's PDF was ever parsed. The
new-audit drawer's upload tab kicks off the parse and nobody polls, so the
document can sit `pending` or `failed` forever; a `ready` document can carry zero
worksheet items; and a parsed document is simply never surfaced at Stage 1 — the
owner's 2026-09-03 walkthrough ("I chose the protocol but it didn't upload the
parsed info", same-login upload) was one of those four states with no way to
tell which. ISA Stage 5 sends the auditor to "the library", a surface Audit Mode
doesn't have; the drawer says "Uploading and parsing…" when `/ingest` returned
202 in seconds. PR-3 of the approved protocol → risks → scope plan
(`~/.claude/plans/cryptic-whistling-ullman.md`); PR-1 (#605) and PR-2 (#607)
landed first.

## Scope (files allowed)

- supabase/migrations/20260913000000_audit_mode_protocol_document_status.sql
- src/types/audit/enums.ts
- src/types/audit/objects.ts
- src/lib/audit/protocolReadinessApi.ts
- src/lib/audit/auditCreationApi.ts
- src/lib/audit/__tests__/protocolReadinessApi.test.ts
- src/lib/audit/__tests__/auditCreationApi.test.ts
- src/components/dashboard/audit/protocolSourceDrawerContext.ts
- src/components/dashboard/audit/AuditWorkspaceShell.tsx
- src/components/dashboard/audit/stages/ProtocolReadinessCard.tsx
- src/components/dashboard/audit/stages/__tests__/ProtocolReadinessCard.test.tsx
- src/components/dashboard/audit/stages/IntakeWorkspace.tsx
- src/components/dashboard/audit/stages/investigator/SiteIntakeWorkspace.tsx
- src/components/dashboard/audit/stages/investigator/IsaConductWorkspace.tsx
- src/components/dashboard/audit/stages/ScopeReviewWorkspace.tsx
- src/components/dashboard/audit/stages/__tests__/ScopeReviewWorkspace.test.tsx
- src/components/dashboard/audit/stages/__tests__/IsaConductWorkspace.test.tsx
- src/components/dashboard/audit/onboarding/NewAuditDrawer.tsx (two copy strings only)
- plans/sixonelabs-piqc/audit-protocol-readiness.md

## Out of scope (files forbidden)

- src/context/** — no context change (2-reviewer gate); the card is a stage-local read model
- supabase/functions/** — no edge-function change; /ingest and /ingest-status are consumed as-is
- src/components/dashboard/KnowledgeBase.tsx — its poll loop is ported, not imported (mode isolation)
- src/components/dashboard/audit/StageNav.tsx, MobileStagePicker.tsx — no deep link to Stage 1 (viewedStage stays shell-local)
- supabase/migrations/20260727000000_audit_mode_isa_protocol_bridge.sql — the ISA bridge RPC stays (additive rule; still consumed by IsaConductWorkspace)
- src/lib/sotr/**, src/components/sotr/** — untouched

## Architecture layers touched

- [x] migration (`supabase/migrations/`)
- [x] RPC (`supabase/functions/` or `.sql`)
- [ ] adapter (`src/lib/*/*Adapter.ts`)
- [ ] context (`src/context/`)
- [x] component (`src/components/`)
- [x] test (`src/**/__tests__/`)

## Mock data plan

none

## Approved-by

- @karl-dev-piqc — for src/lib/audit/**, src/types/audit/**, src/components/dashboard/audit/**
- supabase/ is owned by @rv61 (this PR's author)

## Decisions

- One new read RPC, `audit_mode_protocol_document_status(uuid) RETURNS jsonb`,
  SECURITY DEFINER with the lead-auditor gate (skeleton:
  `audit_mode_isa_protocol_bridge_status`, minus its workflow guard). Counts
  span every PROTOCOL document of the protocol; `own_*` fields are the
  caller's. The ISA bridge RPC is left in place (additive rule).
- `PGRST202` (RPC not applied yet) is a first-class API outcome,
  `{ available: false }`, rendered as "Parse status isn't available in this
  environment yet." — never "no protocol", never an error banner. First PGRST202
  discrimination in the repo.
- State precedence (pure, table-tested `deriveProtocolReadiness`): own pending
  upload → parsing; any ready with visible items → ready(N); any ready → ready
  without items; any pending elsewhere → parsing elsewhere; own failed → failed;
  else none. A failure is shown from the RPC only when nothing ready exists —
  otherwise the ready state's own remedy applies. A failure observed LIVE by the
  card's poll is kept on screen (`liveFailure`) until the next upload, so a
  parse that fails while the auditor watches is never hidden by the refetch.
- Upload CTA only in none / failed / ready-without-items, behind a confirm that
  names the protocol and states that parsing regenerates the protocol's
  extracted schedule data (cohorts, visit templates — Site Mode data). Never
  over a good parse.
- Dedupe: `/ingest` returns the EXISTING document (same bytes, same user) with
  its original pin. Pin ≠ this protocol, or no pin → notice, no polling
  (unpinned case ledgered: no client-side link path). Same pin + ready → refetch;
  same pin + pending → poll it.
- Poll: 10 s interval with an in-flight guard (ingest-status runs the 60–120 s
  completion while still answering "pending"), stop after 3 consecutive
  failures ("Couldn't check parse status" + Retry), 15-minute cap ("Still
  parsing — taking longer than usual" + Check again; server-side recovery is
  the webhook or the 5-minute ingest-recover cron). Cleared on unmount, stage
  change and audit switch. The KnowledgeBase loop is ported, not imported.
- `own_pending_document_id` lets the card resume polling a parse started by
  the new-audit drawer or left mid-way. Because the same login owns that
  document, ingest-status is permitted and will itself complete a parse the
  webhook/cron left stuck.
- "Open protocol source" reaches the shell-owned Records ▸ Protocol source
  drawer through a dedicated context (copy of evidenceDrawerContext.ts), the
  hoist the shell's dispatch comment prescribes. No header button.
- SiteIntakeWorkspace keeps its read-only "Protocol under audit" rows and
  mounts the card beneath them, so the card stays prop-less and identical in
  both workflows (plan said "replace"; same intent, less coupling).
- `uploadProtocolPdf` gains an optional `protocolId` (adds `protocol_id` to the
  ingest body) and its result gains `status` / `deduped`, both already returned
  by /ingest. Its throw contract is pre-existing — ledgered.
- Drawer: two copy strings ("Uploading protocol PDF…"; parsing continues in the
  background, Stage 1 shows its status). No logic change.

## Verification

Static review only on this machine (no Node): CI's tsc + vitest is the first
execution of the new tests. Owner walk on the deployed app:

Before `db push` (RPC missing):
- [ ] Stage 1 (both workflows) shows the "Parsed protocol" card with "Parse status
      isn't available in this environment yet." — no counts, no upload control.
- [ ] New-audit drawer's upload tab reads "Uploading protocol PDF…", then the
      background-parse note.
- [ ] ISA Stage 5 nudge and vendor Stage 4 empty state point at Stage 1.
- [ ] Anon probe of `audit_mode_protocol_document_status` → PGRST202 (missing).

After `db push` (20260912 + 20260913 apply in order):
- [ ] **The audit from the 2026-09-03 walkthrough first:** Stage 1 card resolves
      to Parsing / Parse failed / Parsed without items / Parsed · N. Parsing →
      leave the stage open; the poll completes it (Network: POST ingest-status
      every 10 s, never overlapping). Failed → Upload again. No items → Upload a
      different (text-based) PDF. Parsed · N → Open protocol source shows the
      items. Record which state it was here.
- [ ] Library-created audit with no parsed PDF → "No protocol PDF has been
      parsed…" → Upload → confirm names the protocol → Parsing… → Parsed · N →
      Open protocol source.
- [ ] New audit via the drawer's upload tab → Stage 1 opens already Parsing and
      completes without leaving the stage; leave mid-parse, return after 3 min →
      resolved.
- [ ] Non-PDF renamed .pdf → "Parse failed: …" stays on screen + Upload again.
      Same bytes twice → dedupe notice or refetch, no second parse.
- [ ] Anon probe → 42501 (exists, revoked).
- [ ] Tests green in CI: protocolReadinessApi (derive table, PGRST202, ingest
      status), auditCreationApi (protocol_id in body, status/deduped),
      ProtocolReadinessCard (states, poll, unmount), IsaConductWorkspace
      (new nudge copy), ScopeReviewWorkspace (new empty-state copy).
