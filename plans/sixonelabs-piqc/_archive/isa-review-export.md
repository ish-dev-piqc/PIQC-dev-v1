---
owner: sixonelabs-piqc
feature: isa-review-export
status: merged
merged: 2026-09-05
started: 2026-09-05
target_pr: #629
---

# ISA: Review & export (sign-off latch + verified export)

## Context

Stage 7 of a site audit (`ISA_EXPORT`, "Review & export") is the ISA
pipeline's last placeholder. Report drafting (Stage 6) already downloads a
draft .docx and copies the report for Word, gated on the site verdict — but
nothing records that a report was reviewed and signed off, nothing records
that it left PIQC, and nothing proves the exported file matches what the
auditor reviewed. The vendor lane closed exactly this in 20260730000000
(readiness fingerprint, sign-off latch, verify-then-mark export). This PR
ports the mechanism to the ISA report with NEW function names, gives Stage
7 a workspace whose layout follows the auditor's order of work (check
readiness → review what leaves → sign off → export), and adds the Report
drafting → Review & export card so the pipeline is walkable end to end.

## Scope (files allowed)

- supabase/migrations/20260919000000_audit_mode_isa_report_signoff_schema.sql
- supabase/migrations/20260919000100_audit_mode_isa_report_signoff_rpcs.sql
- src/types/audit/objects.ts
- src/lib/audit/isaReportApi.ts
- src/lib/audit/__tests__/isaReportApi.test.ts
- src/lib/audit/__tests__/isaReportModel.test.ts (fixture gains the four
  mirrored columns — type-check only)
- src/components/dashboard/audit/stages/investigator/isaReportDelivery.ts
  (new: `copyRich` + `downloadBlob` moved verbatim out of IsaReportWorkspace
  — the second caller arrived)
- src/components/dashboard/audit/stages/investigator/IsaExportWorkspace.tsx
- src/components/dashboard/audit/stages/investigator/IsaReportWorkspace.tsx
- src/components/dashboard/audit/AuditWorkspaceShell.tsx (one dispatch line
  + one import; the precedent every ISA stage used)
- src/components/dashboard/audit/stages/__tests__/IsaExportWorkspace.test.tsx
- src/components/dashboard/audit/stages/__tests__/IsaReportWorkspace.test.tsx
- plans/sixonelabs-piqc/isa-review-export.md

## Out of scope (files forbidden)

- src/context/** (2-reviewer gate)
- src/components/dashboard/audit/StageNav.tsx
- src/components/dashboard/audit/stages/StageTransitionCard.tsx,
  StagePreviewNotice.tsx, HistoryDrawer.tsx (consumed as-is)
- src/components/dashboard/audit/stages/investigator/IsaStagePlaceholder.tsx
  (still serves ISA_PREP; untouched)
- src/lib/audit/isaReportModel.ts, isaReportDocx.ts, isaReportClipboard.ts
  (the builders are reused unchanged — what Stage 7 exports is byte-for-byte
  what Stage 6 previews)
- supabase/migrations/20260725*, 20260728*, 20260916* (no CREATE OR REPLACE
  of any applied function — see Decisions)
- supabase/functions/**

## Architecture layers touched

- [x] migration (`supabase/migrations/`)
- [x] RPC (`supabase/functions/` or `.sql`)
- [ ] adapter (`src/lib/*/*Adapter.ts`)
- [ ] context (`src/context/`)
- [x] component (`src/components/`)
- [x] test (`src/**/__tests__/`)

Types in diff: `IsaReportDraftObject` mirrors the four new columns.

## Mock data plan

none

## Approved-by

- @karl-dev-piqc — for src/lib/audit, src/types/audit and
  src/components/dashboard/audit (incl. the shell dispatch line)
- @rv61 (self) — supabase/migrations

## Decisions

- **One latch, not two.** The vendor report approves at Stage 7 and signs
  off at Stage 8 because its classified entries live in another table. The
  ISA report's precondition is the site verdict — already a column, already
  the Stage 6 export gate — so sign-off at Review & export is the single
  latch. No `approval_status` on the ISA draft.
- **Sign-off asserts what was seen and seals what was reviewed.** It takes
  the `updated_at` the auditor saw (22023 `MISSING_EXPECTED_VERSION` /
  40001 `STALE_CONTENT`, the codes the generic approve uses, so the client
  copy is shared) and seals `readiness_fingerprint` = md5 over everything
  the export renders from stored state: the four prose columns, the verdict
  and its nuance, the response-clause parameters, a digest of every finding
  (title, domain, subcategory, severity, observation, evidence, reference,
  protocol refs, response owner) and a digest of the positive notes.
- **Re-sign on divergence instead of clear-on-edit.** A change to the draft,
  a finding or a positive note after sign-off shows as "changed since
  sign-off" and blocks export until the auditor signs off again (the RPC
  re-seals when the fingerprint differs, is idempotent when it doesn't, and
  clears `exported_at` on a re-seal so "Exported" never describes content
  that changed). This avoids replacing the applied upsert / finding / note
  RPCs — every function in 20260919000100 is new.
- **Export is verify → fresh read → mark → generate.** The vendor order, so
  a race between verify and mark still fails closed. The blob is built from
  the freshly read state, never from the pane's state. The three existing
  builders (report .docx, observation form .docx, Word/Docs clipboard) are
  reused unchanged; file names drop the `_draft` suffix Stage 6 uses.
- **Stage 6 keeps its draft exports.** They are labelled draft, they exist
  for prose editing in Word, and removing a working feature is out of this
  PR's scope. Stage 7's export is the recorded one.
- **Layout follows the order of work.** Readiness checklist (verdict set;
  signed off and current) → "What leaves PIQC" summary (auditee, protocol,
  window, verdict sentence, findings by severity, positive observations,
  response clause) → sign-off (two-click confirm) → export. The signed-off
  banner replaces the sign-off card once the seal is current.
- **Advance to Export stays ungated.** The server boundary that matters is
  the export itself (sign-off + verify + mark). A verdict gate on the stage
  advance is ledgered.
- **Nothing works before db push.** The workspace probes the verify RPC on
  mount; PGRST202 → "Review & export isn't available in this environment
  yet." with no actions. The Stage 6 card renders and, like the other ISA
  cards, its click fails honestly until 20260916000000 is applied.

## Decision-debt ledger

- **Verdict gate on the Stage 6 → 7 advance.** Trigger: an auditor lands on
  Review & export with no verdict more than once.
- **Export receipt** (which artefact, by whom, how many times). `exported_at`
  records the last export only; the delta reason names the artefact.
  Trigger: a sponsor asking for the export log.
- **Clear-on-edit** of the sign-off (H4 shape) if re-sign proves confusing.
  Trigger: auditors asking why export is blocked after a typo fix.
- **Audit prep workspace.** Still the only placeholder. Trigger:
  document-request / subject-sample design.
- **Findings edited on Stage 5 after sign-off** are caught by the
  fingerprint; there is no in-place notice on Stage 5. Trigger: first
  confusion report.

## Verification

Before `db push` (deployed on merge):

- [ ] ISA audit at Report drafting: the bottom of Stage 6 shows "Advance to
      Review & export" enabled; click → the card's inline alert with the
      not-applied error (20260916 unapplied).
- [ ] Stage 7 viewed one ahead: preview notice, then "Review & export isn’t
      available in this environment yet." — no Sign off, no export buttons.
- [ ] Vendor audits: no change.
- [ ] Anon probe with the publishable key:
      `audit_mode_verify_isa_export_readiness` → 42501 (not PGRST202).

After `db push` (20260916 + 20260919 applied):

- [ ] Stage 6 → Advance → view snaps to Review & export. With no verdict:
      checklist row 1 unticked with the pointer to Report drafting; Sign off
      disabled; exports disabled.
- [ ] Set the verdict on Stage 6, return: row 1 ticked with the verdict
      sentence; "What leaves PIQC" shows the findings by severity and the
      response clause; Sign off report → Confirm sign-off → banner "Report
      signed off · today · <you>"; History shows one "Site audit report
      signed off" delta.
- [ ] Download report .docx → file `<code>_site_audit_report_<date>.docx`
      (no `_draft`); "Last exported today" appears; History shows "Site
      audit report exported (report .docx)".
- [ ] Edit a prose section on Stage 6 (or a finding on Stage 5), return to
      Stage 7: row 2 reads "Changed since sign-off…", exports disabled,
      button reads "Sign off again"; sign off again → History shows "signed
      off again after changes"; the earlier "Last exported" line is gone.
- [ ] Two tabs: sign off in tab A; in tab B (stale pane) click Sign off →
      notice "The report changed since you reviewed it — the latest version
      is shown." and the banner appears without a second seal.
- [ ] SQL editor: `select audit_mode_mark_isa_report_exported('<id>',
      'report_docx')` on an un-signed draft → 42501 with hint
      GATE_ISA_REPORT_NOT_SIGNED_OFF; with `'pdf'` → 22023.
