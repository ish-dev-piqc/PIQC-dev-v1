---
owner: sixonelabs-piqc
feature: F-003 — embed the SOTR protocol worksheet in Audit Mode Stage 4
status: active
started: 2026-08-26
target_pr:
---

# SOTR protocol-worksheet embed in Audit Mode

## Context

`docs/sotr/follow-ups.md` F-003 tracked wiring the SOTR (Source of Truth Reviewer) protocol worksheet into Audit Mode as still-undone. `audits.protocol_id` is a direct `NOT NULL` FK to `protocols(id)` — the same id space SOTR's `studyId` uses — and was already surfaced on `AuditContext.AuditWithContext` (added independently for auditee/site display work; unrelated to SOTR). This PR embeds the existing `WorksheetItemsList` component (owned by SOTR/Ishika, already shipped and stable in Site Mode) into Stage 4 (`ScopeReviewWorkspace`, VENDOR_AUDIT workflow only) as a read-only reference panel — the protocol parse becomes visible as the audit's first piece of source evidence, ahead of the evidence-intake and grounded-generation work planned next.

**Auth stays owner-scoped, deliberately.** SOTR's RLS is `documents.user_id = auth.uid()` — no team/shared-access concept exists yet. In the current single-account-per-deployment reality the auditor's account is the protocol uploader, so the embed is fully functional today. A future multi-user deployment where the auditor ≠ the uploader would see an empty worksheet (RLS hides rows without an error, by design — a client can't distinguish "none exist" from "hidden"), which is why the empty-state copy here is explicit about the ownership rule rather than silent. Named as follow-up debt below.

## Scope (files allowed)

- src/components/sotr/WorksheetItemsList.tsx
- src/components/sotr/__tests__/WorksheetItemsList.test.tsx
- src/components/dashboard/audit/stages/ScopeReviewWorkspace.tsx
- src/components/dashboard/audit/stages/__tests__/ScopeReviewWorkspace.test.tsx
- docs/sotr/follow-ups.md
- plan.md (two SOTR-status touches only: the Site/Audit-Mode-wiring rows in the "what ships" table, and the S-002 open-question row marked resolved)
- plans/sixonelabs-piqc/sotr-audit-embed.md

## Out of scope (files forbidden)

- Any SOTR RLS policy, RPC, or the storage bucket — auth model is unchanged; see "auditor read access" follow-up below.
- `src/context/AuditContext.tsx` — `protocol_id` already exists on `AuditWithContext`/`AuditRow`/the select string/`flatten()`; no change needed.
- SOTR naming policy: no "approve/approved/approval", "sign/signed/signature", "certify/certified", "GxP", "Part 11" introduced into `src/components/sotr` or `src/lib/sotr` — this PR's new Section title ("Protocol worksheet — draft extracted items") and empty-state copy were written to comply; swept with `grep -rniE "approve|signed|certif|gxp|part 11" src/components/sotr src/lib/sotr` before commit.
- ISA (`INVESTIGATOR_SITE_AUDIT`) workflow — `ScopeReviewWorkspace` mounts only under `workflow_type === 'VENDOR_AUDIT'` in `AuditWorkspaceShell`'s dispatch table; ISA audits are unaffected by this change.

## Architecture layers touched

- [x] component (embed + prop addition)
- [x] test
- [ ] migration / RPC / adapter / context — none

## Mock data plan

none

## Approved-by

- @karl-dev-piqc — owns `src/components/dashboard/audit/` (`ScopeReviewWorkspace.tsx`).
- @ish-dev-piqc — owns SOTR (`WorksheetItemsList.tsx` prop addition, `docs/sotr/follow-ups.md`). Note: `docs/CODEOWNERS.md` literally lists `/src/components/dashboard/sotr/`, but the real path is `/src/components/sotr/` (no `dashboard/` segment) — a stale-path bug in the CODEOWNERS file itself, flagged separately; tagging Ishika here by evident intent, not by a matching rule.
- @ish-dev-piqc, @ki-dev-piqc, @karl-dev-piqc — `plan.md` requires all 3 per the "Shared infra" CODEOWNERS rule; this PR's touch is a 2-line table/row update.

## Verification

- `npm run typecheck && npm run test` clean (not run in this environment — no Node runtime available here; run on the dev machine before merge).
- `WorksheetItemsList.test.tsx`: new `emptyStateMessage` override test; existing default-copy test doubles as the Site Mode regression check (byte-identical default copy, untouched).
- `ScopeReviewWorkspace.test.tsx`: embed receives `studyId={protocol_id}` (never the audit id) and the ownership-aware empty-state copy.
- Manual QA (dev machine): Stage 4 shows worksheet items for the protocol-uploading account; row click opens `SourceTruthDrawer` correctly layered over the 3-pane audit shell; switch to an account that didn't upload the protocol PDF and confirm the ownership-aware empty copy (not the generic Site Mode copy) renders; Site Mode's own worksheet view is visually unchanged.

## Follow-up (named, not hidden)

- **Auditor read access to SOTR (owner-scoped auth debt).** Deferred: a `SECURITY DEFINER` RPC authorized by audit assignment (`audits.lead_auditor_id = auth.uid() AND audits.protocol_id = p_study_id`) so a non-uploader auditor can see worksheet items and export the packet. Acceptable now because the current deployment is single-account. Risk if deferred too long: in a multi-user deployment, auditors silently see an empty worksheet and `DownloadDraftPacketButton` fails loudly with `42501`. Trigger to revisit: first deployment where any auditor account ≠ the protocol-uploading account. (Documented in `docs/sotr/follow-ups.md` as F-011.)
