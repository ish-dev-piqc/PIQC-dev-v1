---
status: active
owner: sixonelabs-piqc
feature: audit-dead-code-and-type-ruling
target_pr: TBD
---

# Audit dead code + type-hierarchy ruling

PR-3 of the pre-D4 quality-hardening train (quality review 2026-08-31).

## Problem

`src/types/audit/objects.ts` carries a parallel "domain object" layer that is
entirely dead — every deliverable/vendor/workspace-entry shell there is
referenced only in comments, while the live row shapes (which carry the real
columns, generation provenance included) live in `src/lib/audit/mock*.ts`.
D1 and D3 extended the live side and left the dead side unmirrored, so the
"DB schema change → TS type mirror" rule is being honored in the wrong
directory's name. Several API modules also carry verified-dead exports and
two back-compat aliases (house rule 4/5 violations), and the evidence
register's client rows don't carry `documents.kind` — the engine filters by
kind in JS while the client trusts a PostgREST embed filter alone, and the
`DocumentKind` type sits dead while the literal is hardcoded twice.

## Ruling (recorded here + in the live files' headers)

Canonical home for real-Supabase row/display shapes = `src/lib/audit/`
domain modules. `src/types/audit/` keeps what it genuinely owns: enums (DB
enum mirrors), cross-cutting primitives (generation refs/snapshots, evidence
rows, state-history, IssueObject/CapaObject, ISA types). The dead shells are
DELETED, not completed. No bulk `Mock*` rename (~380 occurrences of pure
churn): the prefix and `mock*` filenames are legacy-frozen; a module is
renamed only when a PR is already rewriting it; new domains use real names
in properly-named modules — D4's `FindingsReport` first.

## Changes

1. Delete dead types in `src/types/audit/objects.ts` (each re-verified
   zero-non-comment-refs on current main): ProtocolRiskObject,
   SuggestionProvenance, VendorServiceObject, TrustAssessmentObject,
   VendorRiskSummaryObject, VendorRiskSummaryProtocolRiskRef,
   QuestionnaireTemplate, QuestionnaireTemplateVersion,
   QuestionnaireQuestion, QuestionnaireResponseObject,
   AuditWorkspaceEntryObject, EvidenceAttachment, EvidenceOnWorkspaceEntry,
   EvidenceOnQuestionnaireResponse, AmendmentAlert, and the deliverable
   shells + content types (ConfirmationLetter/Agenda/Checklist Object +
   Content + AgendaItem/ChecklistItem). Live types in the same file stay
   (IssueObject, CapaObject, evidence rows, snapshots, ISA, ChangedFields).
   Enums stay untouched (they are the mirror layer types/ owns).
2. Dead-export sweep (verified zero refs incl. tests):
   riskSummaryApi revokeRiskSummaryApproval / linkProtocolRiskToSummary /
   unlinkProtocolRiskFromSummary; vendorEnrichmentApi deleteVendorService +
   updateTrustAssessment alias; questionnaireApi fetchQuestionnaireInstance
   alias; workspaceEntriesApi confirmWorkspaceEntryRiskContext (client
   wrapper only — the RPC stays for the Phase-2 amendment flow);
   stateHistory diffFields. (fetchServiceMappings already fell in PR-2.)
   Plus the two dead label maps RESPONSE_STATUS_LABELS /
   RESPONSE_SOURCE_LABELS in labels.ts.
3. Evidence-kind parity (client half): `listAuditEvidence` selects
   `documents.kind`, `AuditEvidenceListRow` carries `kind: DocumentKind`,
   the two hardcoded 'AUDIT_EVIDENCE' literals go through the type, and the
   mapper adds a defensive same-language kind filter mirroring the engine's
   normalizeRegister — a PostgREST embed-behavior change can no longer
   silently break the invariant client-side. Test extended.
4. Ruling header comments in mockPreAudit.ts and mockWorkspaceEntries.ts.

## Scope

- src/types/audit/objects.ts
- src/types/audit/enums.ts (only if a dead-type deletion strands an import)
- src/lib/audit/evidenceApi.ts
- src/lib/audit/riskSummaryApi.ts
- src/lib/audit/vendorEnrichmentApi.ts
- src/lib/audit/questionnaireApi.ts
- src/lib/audit/workspaceEntriesApi.ts
- src/lib/audit/stateHistory.ts
- src/lib/audit/labels.ts
- src/lib/audit/mockPreAudit.ts (header comment only)
- src/lib/audit/mockWorkspaceEntries.ts (header comment only)
- src/lib/audit/__tests__/evidenceApi.test.ts
- src/lib/audit/__tests__/deliverableGenerationApi.test.ts (evidenceRow
  fixture gains the now-required kind field)
- plans/sixonelabs-piqc/audit-dead-code-and-type-ruling.md

## Out of scope

- supabase/** (the RPC behind the deleted client wrapper stays)
- Any rename of live identifiers (Mock* prefix legacy-frozen per ruling)
- src/types/audit/state-history.ts's FieldDelta/StateHistoryDelta (dead but
  outside the declared sweep — ledgered)
- AuditDataContext stale comments (2-reviewer), ProtocolTab.tsx dead import
  (Ishika's file — in the team notification)
- Other modes

## Adversarial verification outcomes (applied before PR)

The verifier found two CI-blocking typecheck breaks (both invisible to
vitest — the required `kind` field was missing from ingestAuditEvidence's
return literal and from deliverableGenerationApi.test's evidenceRow
fixture) and one false claim: the mapper's null-embed fallback coerced an
UNKNOWN row into the very kind the filter admits — the opposite of the
engine's `if (!doc || doc.kind !== ...) drop`. All fixed: the mapper now
drops null-embed rows (true same-language parity), the ingest path states
the kind it mints, fixtures updated, and the orphaned comments the sweep
left behind (empty section banner, stale type names in prose) cleaned in
the in-scope files. Stale prose mentions of deleted type names in
out-of-scope files (mockVendorEnrichment, heatmap, RiskSummaryPanel,
AuditConduct, the vendor-enrichment forms) are harmless DB-concept prose —
left for their owners' next edits.

## Architecture layers touched

type, API (deletions + one additive field), test

## Mock data plan

None. Test mocks in __tests__/ only.

## Approved-by

@karl-dev-piqc (audit lib + types)

## Verification

- CI: typecheck + vitest green (first execution — tsc is the zero-refs
  proof: any missed caller fails compilation).
- Post-delete grep: every deleted symbol name appears nowhere in src/
  outside comments.
- evidenceApi tests: rows carry typed kind; a foreign-kind row surviving
  the join is dropped by the mapper (engine-parity pin).
- E2E (user, deployed): evidence register lists identically; deliverable
  generation currency unchanged.
