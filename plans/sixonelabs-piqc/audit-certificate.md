---
status: active
feature: audit-certificate
owner: sixonelabs-piqc
branch: sixonelabs-piqc/audit-certificate
target_pr: TBD
---

# PR-D6 — Audit Certificate: the terminal deliverable, chained to the approved report

The 7th deliverable kind (`audit_certificate`), per the nine-deliverables queue (source of truth: HANDOVER-audit-nine-deliverables.md v3, §PR-D6) and v8's `audit_certificate` contract. The certificate is the terminal artifact of the audit: a descriptive record that the audit happened — audit object, vendor service context, scope covered, dates, standard — that **never states a result**. `[Outcome: to be determined by QA]` and the blank certificate date line are code-owned template lines (D4's QA-placeholder pattern); the model never writes them and the sponsor's QA fills them outside PIQC. In-PIQC approval is a readiness latch, never a GxP attestation.

This PR is where the deliverable-to-deliverable prerequisite machinery from D4 completes: v8's rule "audit_certificate requires an accepted final_audit_report", translated to PIQC's latch language as a **second basis token** on the generic approve RPC. Approving the certificate CAS-pins the approved Stage-7 report version the reviewer saw (`REPORT_VERSION` basis), sealed into `basis_digest` — an approval that cannot name which report it certifies is the dishonest latch this machinery exists to prevent. Generation is likewise sequence-gated server-side: the engine refuses to draft a certificate for an audit whose report is not approved (v8 doctrine: creation ungated, generation gated).

## Scope

- plans/sixonelabs-piqc/audit-certificate.md
- supabase/migrations/20260907000000_audit_certificate_schema.sql (new)
- supabase/migrations/20260907000100_audit_certificate_rpcs.sql (new)
- supabase/functions/audit-deliverable-draft/index.ts
- supabase/functions/audit-deliverable-draft/prompts.ts
- src/types/audit/enums.ts
- src/types/audit/objects.ts
- src/lib/audit/auditCertificate.ts (new)
- src/lib/audit/deliverableGenerationApi.ts
- src/lib/audit/lineageAdapter.ts
- src/lib/audit/lineageApi.ts
- src/components/dashboard/audit/TraceabilityDrawer.tsx
- src/components/dashboard/audit/deliverables/useDeliverablePersistence.ts
- src/components/dashboard/audit/deliverables/DeliverableGenerationPanel.tsx
- src/components/dashboard/audit/stages/AuditCertificateSection.tsx (new)
- src/components/dashboard/audit/stages/FinalReviewExportWorkspace.tsx
- src/lib/audit/__tests__/auditCertificate.test.ts (new)
- src/lib/audit/__tests__/deliverableGenerationApi.test.ts
- src/lib/audit/__tests__/lineageAdapter.test.ts
- src/lib/audit/__tests__/lineageApi.test.ts
- src/components/dashboard/audit/stages/__tests__/AuditCertificateSection.test.tsx (new)
- src/components/dashboard/audit/stages/__tests__/FinalReviewExportWorkspace.test.tsx

## Out of scope

- The five legacy per-kind RPC sets and their clients (migrating them onto the generic pair = partner's-return rework, unchanged from D4).
- Stage-7 report machinery (`report_draft_objects`, its approve/sign-off RPCs, ReportDraftingWorkspace, FindingsReportSection) — read-only consumers only; the report-version digest function reads it, nothing writes it.
- D2 deliverable-plan awareness (held for partner). The certificate lands always-in-scope like the other kinds.
- Merged migrations (append-only; the D4 generic functions are extended via CREATE OR REPLACE in the new migration — they are unapplied in prod, so prod receives only the final 7-kind version).
- src/context/** (no realtime for deliverables yet — AuditDataContext inversion is its own ledgered plan).
- mockPreAudit.ts, PreAuditDraftingWorkspace and its tests (certificate is not a Stage-5 tab).

## Architecture layers touched

migration, RPC, adapter (pure client module), component, test. No context changes.

## Mock data plan

None. Real Supabase or honest-degraded banners (identical posture to D4: until the migration pair is applied in prod, the Stage-8 section renders its load-failure banner with retry, and approve stays blocked because no basis digest can be fetched).

## Approved-by

- @karl-dev-piqc (src/lib/audit, src/components/dashboard/audit, src/types/audit)
- @rv61 (supabase/** — self, per CODEOWNERS)

## Decision record

1. **Letter-family content, no fourth engine shape.** Certificate content = `{body_text, scope}` — exactly the letter shape. Engine gets a 7th `DELIVERABLES` config entry (`shape: 'letter'`, `blobRefId: 'certificate'`, revisionHeading `CURRENT CERTIFICATE`) + `AUDIT_CERTIFICATE_PROMPT`. The prompt forbids outcome statements, adequacy verdicts, signature/sign-off fields, and severity language; body is descriptive only.
2. **Code-owned template lines.** `[Outcome: to be determined by QA]` and `Certificate date: ____` are rendered by `AuditCertificateSection` (and any future export), never stored in content, never sent to or received from the model.
3. **Second basis token `REPORT_VERSION`, no new digest function.** The report row already carries its version identity: `readiness_fingerprint` — md5(executive_summary | conclusions | entry-set digest), server-sealed by `audit_mode_approve_report_draft` (20260730000000:515), nulled on text edit. That IS v8's `versionIdReviewed` ("the version a HUMAN signed off is the correct answer"). `audit_mode_deliverable_kind_config` and `audit_mode_approve_deliverable` are CREATE-OR-REPLACEd (they are unapplied in prod — prod receives only the 7-kind version) with the token's paired verification + seal arms, extending exactly the places D4's comment prescribes; the upsert's basis clear is already kind-agnostic and is not replaced. The verification arm reads the live digest inline (`CASE WHEN approval_status = 'APPROVED' THEN readiness_fingerprint END` — single caller, no helper per house rule): unapproved/absent/legacy-unfingerprinted report → live NULL → STALE_BASIS against any pin; report re-approved with new content → digest differs → STALE_BASIS. A report demoted between verification and seal falls to the client divergence re-check, D4's documented doctrine.
4. **Generation sequence-gated server-side.** For certificate requests the engine reads the report row: read error → 503 (fail-closed posture from D4); absent or unapproved → 409 REPORT_NOT_APPROVED (409 precedent: wrong workflow type). The client hides the generation CTA on the same predicate (button state = enforcement), but the server check is the gate. The report's executive summary/conclusions are deliberately NOT sent to the model — the certificate describes the audit, never its outcome, and withholding the conclusions is the mechanical form of that rule.
5. **Section = D4's pattern at Stage 8, one row read for the basis.** `AuditCertificateSection` clones `FindingsReportSection`'s architecture: section-owned one-read-moment load (`Promise.all` of certificate row + report-basis read), `useDeliverablePersistence` instantiation, divergence banner when an approved certificate's sealed digest no longer matches the live report fingerprint, approve disabled while the live digest is null (report unapproved) or unknown (read failed). The report basis (approved?, approved_at, digest) comes from ONE `report_draft_objects` row read — digest and displayed report state cannot disagree, so D4's cross-read mismatch guard has no analog here by construction. Mounted in `FinalReviewExportWorkspace` after the Export card (terminal artifact), with the audit facts header (vendor, audit name, type, window, protocol) rendered code-owned from `AuditContext` — dates and vendor identity never round-trip through the model.
6. **Non-gating.** The certificate gates nothing (no stage-advance participation); the report gates IT.

## Deferral ledger

- **Prod debt grows to 8 unapplied migrations** (D1, D3, D4, D6 pairs) + `audit-deliverable-draft` now three revisions behind. Trigger: partner's return; surface stays honest-degraded until applied.
- **Certificate not yet in the Stage-8 export documents.** Same posture as the findings report: export wiring lands on the first export request for either, as one PR.
- **D2 plan-awareness** (descope/restore for the certificate) — lands with D2 when the partner returns.
- **Date-drift** (certificate generated before a reschedule may carry old dates) — pre-existing ledger item, unchanged.
- **Cross-mount draft stash** — pre-existing accepted gap; the certificate section inherits it. Trigger unchanged (user report of a lost draft).

## Verification

- CI green — first execution of typecheck + vitest (no local Node on this machine; everything below CI is statically reviewed only).
- New tests pin: client module RPC routing (`p_kind: 'audit_certificate'`, dual pins, hint extraction incl. REPORT_NOT_APPROVED / STALE_BASIS / STALE_CONTENT), absence-vs-failure fetch split, digest null-on-error; section behaviors (approve blocked without digest / with unapproved report, divergence banner, save-failure preservation, code-owned template lines rendered, generation CTA hidden when report unapproved); apply-arm content routing in deliverableGenerationApi; lineage threading.
- End-to-end (user, deployed, after migrations applied): generate blocked until Stage-7 report approved → approve report → generate certificate → body descriptive, outcome line reads `[Outcome: to be determined by QA]`, certificate date blank → edit demotes + clears seal → approve pins report version → re-approve the report (new version) → certificate shows divergence banner and STALE_BASIS on re-approve until re-reviewed.
