---
owner: sixonelabs-piqc
feature: isa-document-request
status: in-review
started: 2026-09-06
target_pr:
---

# ISA: Audit prep — document request and sampling approach → request letter

## Context

Stage 4 of a site audit (`ISA_PREP`, "Audit prep") is the pipeline's last
placeholder. Stage 3 now records the risk-based site audit scope (#625);
nothing downstream reads it. This PR turns the scope into the list of
documents the auditor asks the site to have ready for the visit — a
baseline every site audit requests plus the standard document set of each
module in the scope — lets the auditor shape it (include, exclude, annotate,
add), records the sampling approach the visit will apply, latches it with
the house approval, and exports it as the request letter that leaves PIQC.

**SME rule that shaped the stage (owner, 2026-09-06):** subjects are not
identified before the audit. The auditor selects them during Audit conduct
from the site's screening and enrollment log; the selected subject numbers
surface in the report or the CAPA plan. So there is no pre-visit subject
sample: subject-level request lines read "for the subjects selected during
the audit (subject numbers only)", the letter carries one fixed selection
paragraph, and the stage's second half is a free-text sampling approach
statement. The stage description changes from "plan the subject sample" to
"set the sampling approach".

**Decision:** the request is the 9th kind on the generic deliverable pair
(`audit_mode_upsert_deliverable` / `audit_mode_approve_deliverable`,
20260906000100 + 20260907000100), exactly the `site_scope` recipe: kind
`document_request`, table `document_request_objects`, tracked type
`DOCUMENT_REQUEST_OBJECT`, `o_basis NULL`. No new RPCs.

## Scope (files allowed)

- supabase/migrations/20260920000000_audit_mode_document_request_schema.sql
- supabase/migrations/20260920000100_audit_mode_document_request_rpcs.sql
- src/types/audit/enums.ts
- src/types/audit/objects.ts
- src/lib/audit/labels.ts
- src/lib/audit/documentRequestVocabulary.ts
- src/lib/audit/documentRequest.ts
- src/lib/audit/documentRequestApi.ts
- src/lib/audit/documentRequestLetter.ts
- src/lib/audit/documentRequestDocx.ts
- src/lib/audit/__tests__/documentRequest.test.ts
- src/lib/audit/__tests__/documentRequestApi.test.ts
- src/lib/audit/__tests__/documentRequestLetter.test.ts
- src/components/dashboard/audit/stages/investigator/IsaPrepWorkspace.tsx
- src/components/dashboard/audit/AuditWorkspaceShell.tsx
- src/components/dashboard/audit/stages/__tests__/IsaPrepWorkspace.test.tsx
- src/components/dashboard/audit/stages/__tests__/IsaStagePlaceholder.test.tsx
- plans/sixonelabs-piqc/isa-document-request.md

Touch notes: labels.ts changes one string (the ISA_PREP stage description);
AuditWorkspaceShell.tsx gains one import and one dispatch line (the
precedent every ISA stage used); IsaStagePlaceholder.test.tsx updates the
one assertion on that description.

## Out of scope (files forbidden)

- src/context/** — read through `useAudit` / `useAuth` / `useTheme` only
  (2-reviewer gate)
- src/components/dashboard/audit/StageNav.tsx
- src/components/dashboard/audit/stages/investigator/IsaStagePlaceholder.tsx
  — untouched; it stays the shell's fallback for any unmapped stage (after
  this PR no ISA stage reaches it — ledgered)
- src/components/dashboard/audit/StagePreviewNotice.tsx,
  stages/StageTransitionCard.tsx, HistoryDrawer.tsx, deliverables/**
  (StatusBadge, useDeliverablePersistence, useDeliverableResync) — consumed
- src/lib/audit/siteScope.ts, siteScopeApi.ts, preAuditApi.ts,
  dateWindow.ts, isaReportModel.ts, isaReportDocx.ts, isaReportClipboard.ts,
  stages/investigator/isaReportDelivery.ts — consumed; their private
  helpers are copied, not exported
- every other ISA workspace (SiteIntake, IsaRiskAssessment, IsaScopeBuilder,
  IsaConduct, IsaReport, IsaExport) — no change
- supabase/migrations/20260906000100_*, 20260907000100_*, 20260918000100_*
  and every earlier migration — the delta viewer and the kind config are
  CREATE OR REPLACEd in the NEW file with every earlier branch/arm verbatim
- supabase/functions/** — no edge function, no model call

## Architecture layers touched

- [x] migration (`supabase/migrations/`)
- [x] RPC (`supabase/functions/` or `.sql`) — kind-config arm + delta-viewer
      branch, no new function
- [ ] adapter (`src/lib/*/*Adapter.ts`)
- [ ] context (`src/context/`)
- [x] component (`src/components/`)
- [x] test (`src/**/__tests__/`)

Types (`src/types/audit/`) are in the diff: the tracked object type and the
request content shape — the schema → type mirror is satisfied.

## Mock data plan

none

## Approved-by

- @karl-dev-piqc — for src/lib/audit/** (including the one label string),
  src/types/audit/** and src/components/dashboard/audit/** (including the
  one-line AuditWorkspaceShell dispatch entry, precedented by every ISA
  stage)
- @rv61 (self) — supabase/migrations/

## Decisions (owner Q&A 2026-09-06 folded in)

- **9th kind, `o_basis NULL`, two migrations (house split).** Schema file:
  the `DOCUMENT_REQUEST_OBJECT` tracked type and `document_request_objects`
  (one row per audit: content JSONB + the standard approval columns). RPC
  file: `audit_mode_can_view_tracked_object` (branch added, every earlier
  branch verbatim from 20260918000100) and
  `audit_mode_deliverable_kind_config` (9th arm, every earlier arm verbatim).
  Contracts unchanged; grants preserved by CREATE OR REPLACE.
- **Deterministic derivation, closed-world vocabulary, no model.**
  `buildDocumentRequestContent(scope, now)` = the 9-line baseline (every
  site audit) + the standard set of each module in the scope, in the scope's
  own order (criticality, then domain order). Every line carries its basis
  (baseline / module + pinned criticality / auditor). Dedupe rule: baseline
  wins. The vocabulary was reviewed by the owner.
- **Subjects are selected during the audit.** Subject-level lines read "for
  the subjects selected during the audit (subject numbers only)"; the letter
  carries a fixed selection paragraph (all enrolled subjects' records
  accessible, subject numbers only, the identification code list stays at
  the site). No line and no field ever holds a subject identifier.
- **Sampling approach is content**, prefilled at build with the owner's
  default (all subjects with an SAE or a protocol deviation plus a
  representative sample of the rest), editable, carried across rebuilds,
  stated in the letter after the selection paragraph. Free text — a
  structured rule is ledgered until a conduct helper needs one.
- **Drift is by (domain, criticality) pairs**, recorded in
  `built_from.scope_modules` — not the scope row's `updated_at`, whose touch
  trigger moves on the scope's approve.
- **Merge-on-rebuild by stable key.** `included` and `note` survive for the
  same key; auditor-added lines are never dropped; standard lines no longer
  derivable are dropped; rebuild always demotes (built_at is content), said
  on the control.
- **Explicit Save with a dirty flag.** One Save = one delta = one demotion
  (an approved request says so on the button). Rebuild and Approve are
  blocked while dirty; Approve is also blocked while the scope drifted
  (approving a stale request would only lead to "rebuild and approve
  again"); Rebuild is blocked when the scope row is gone. Every block says
  why in the control's title. Dirty is a flag, never a JSON comparison.
- **The site never sees the criticality.** Letter headings are domain labels
  only; criticality shows only inside PIQC (workspace chips). Pinned by test.
- **Everything is available at the site on the audit dates.** No due date,
  no per-line "send in advance" flag; delivery instructions cover
  exceptions. Addressee block = site, site number, PI, country from the
  audit record; contacts are added in the mail client.
- **Approve first, then export** (approval = readiness to export), from the
  SAVED row, only while APPROVED ∧ not drifted ∧ not dirty ∧ no save error.
  APPROVED banner ("reviewed and approved by <name> on <date>"), not the
  report's DRAFT banner — no model is involved and nothing exports before
  approval. Signatory = the signed-in profile's name.
- **Preview** (`!hasReachedStage`): StagePreviewNotice, inputs rendered
  disabled, no Build / Rebuild / Approve / Save / Add / Remove / export.
- **Transition ISA_PREP → ISA_CONDUCT stays ungated** (7th
  StageTransitionCard caller); the "prep deliverables approved" gate slot in
  20260916000000 stays ledgered.
- **Nothing works before db push.** Either table missing (PGRST205 / 42P01)
  → "Audit prep isn’t available in this environment yet." and no actions.
  Vendor audits untouched.

## Decision-debt ledger

- **Subject selection recorded at Audit conduct** (the selected subject
  numbers → report / CAPA). Trigger: next isa-conduct touch.
- **Structured sampling rule** (rule + percent). Trigger: a conduct helper
  computing the sample from the enrollment log.
- **Receipt tracking / documents received.** Must never demote the approved
  request (a separate row or column, never `content`). Trigger: first site
  returning documents.
- **Conduct consumption of the request.** Trigger: next isa-conduct touch.
- **ISA_PREP → ISA_CONDUCT gate "prep deliverables approved".** Trigger:
  first auditor advancing with an unapproved request.
- **Due date / send-by items.** Trigger: first auditor asking for dated
  in-advance delivery.
- **Site contact / address block.** Trigger: first letter emailed from PIQC.
- **`IsaStagePlaceholder` has no live ISA caller** (shell fallback only).
  Trigger: next shell touch.
- **Build from an unapproved scope** (no gate, no hint). Trigger: first
  request sent from a Draft scope.
- **Vocabulary version pin** (edits to the standard set after a build are
  not drift). Trigger: first vocabulary change PR.
- **Server-side scope pin** (`o_basis 'SCOPE_VERSION'`). Trigger: same as
  the scope builder's MAPPING_SET debt.
- **docx / clipboard helpers ×2** (isaReportDocx / isaReportClipboard
  privates copied). Trigger: the third caller.

## Verification

Static review only on this machine (no Node): CI's tsc + vitest is the
first execution; `db push` is the first execution of the SQL.

Before `db push` (frontend live on merge; the two migrations join the
unapplied queue):
- [ ] ISA audit at Audit prep (and previewed one ahead from Scope builder):
      "Audit prep isn’t available in this environment yet." — no Build, no
      export; the preview shows the notice and the card's ahead line; the
      transition card's click fails honestly in its alert (20260916
      unapplied). Stage chips read "Request documents and set the sampling
      approach."
- [ ] Vendor audits: no change.
- [ ] Anon probes with the publishable key:
      `GET /rest/v1/document_request_objects?select=id&limit=1` → 404
      (PGRST205); `audit_mode_deliverable_kind_config({"p_kind":
      "document_request"})` → 401/42501 either way.

After `db push`:
- [ ] `document_request_objects` probe → 200 `[]`. SQL editor as the lead
      auditor: `select * from audit_mode_deliverable_kind_config(
      'document_request')` → the 9th arm; `audit_mode_approve_deliverable(
      'document_request', <id>, null, <updated_at>, 'x')` → 22023.
- [ ] Stage 3 with a built scope (e.g. Informed consent · Critical,
      Investigational product · High, Source data verification · High) →
      Advance → Stage 4: "No request built yet. 3 modules in scope." →
      Build request → 9 baseline + 6 + 4 + 5 lines in four groups with
      criticality chips, Draft, the sampling approach prefilled.
- [ ] Untick a line; add a note; add a custom document under a module not
      in scope (own group); edit the sampling statement; type delivery
      instructions → "Unsaved changes" → Save changes → Draft; History
      shows "Document request built…" then "Document request edited".
- [ ] Approve request → "Approved · today · you". Download request letter
      .docx → `<code>_document_request_<date>.docx` opens in Word: APPROVED
      banner, addressee table with the audit dates, purpose paragraph,
      delivery instructions, domain-headed tables with no criticality
      wording, the unticked line absent, notes in the Notes column, the
      subject-selection paragraph followed by the sampling statement,
      signature. Copy for Word / Docs pastes formatted.
- [ ] Map a new risk under a new module on Stage 2 → Stage 4 shows the drift
      notice (with the Draft-revert warning while approved); export
      disabled with the drift reason; Rebuild → the new group appears, the
      untick / note / custom line / sampling text survive, Draft; approve
      again; export again.
- [ ] Two tabs: edit + save in A, approve in B → stale notice, latest shown.
- [ ] Step back to Scope builder, preview Stage 4 → read-only list, disabled
      inputs, no buttons, card disabled. At stage: "Advance to Audit
      conduct" works.
