---
status: active
owner: sixonelabs-piqc
feature: audit-load-path-honesty
target_pr: TBD
---

# Audit load-path honesty — absence is not failure

PR-2 of the pre-D4 quality-hardening train (quality review 2026-08-31).
Same disease as PR-1 (#571), one layer down: the Stage 1–3 load paths.

## Problem

The vendor-enrichment fetch trio collapses "DB error" and "legitimately
empty" into the same null/[], so (a) a failed read renders create-mode forms
that invite retyping and upserting over an existing row, and (b) the
workspace's truthiness guards (`if (service)`, `if (mappings.length > 0)`)
never clear a stale cache when server state legitimately became empty —
absence is indistinguishable from failure in both directions. ScopeReview's
unconditional cache writes have the inverse bug: an errored fetch clobbers a
known-good cache with null. Two load effects (QuestionnaireReview, Intake)
lack the cancellation latch their siblings carry, and Intake's header
comment still describes a mock architecture that no longer exists.

## Fix (code-only; no migrations; no edge-fn changes; deploy-safe)

- vendorEnrichmentApi fetch trio (`fetchVendorService`,
  `fetchServiceMappingsByAudit`, `fetchTrustAssessment`) returns `Result<T>`
  (imported from auditCreationApi, as evidenceApi already does — no 6th
  Result definition). Empty is `{ ok: true, data: null | [] }`; error carries
  the message.
- VendorEnrichmentWorkspace: per-audit load state (loading / ok / failed —
  keyed by audit, per PR-1's cross-audit lesson) with cancellation. On ok,
  caches set UNCONDITIONALLY (a legitimate empty clears staleness); on any
  failure the three section cards are replaced by an honest load-error card
  with Retry — pending/create forms must not render over unknown server
  state (writing from one risks a duplicate-row upsert or shown-as-saved
  optimistic rows).
- ScopeReviewWorkspace absorbs the Result shape: ok → set cache (including
  null/[] — server truth); error → keep the known cache instead of
  clobbering it with null.
- lineageApi absorbs mechanically (`r.ok ? r.data : null` — the drawer's
  silent-omission behavior is pre-existing and ledgered in PR-1).
- Cancellation latches for the QuestionnaireReview and Intake load effects;
  Intake's stale mock-era header comment corrected.

## Scope

- src/lib/audit/vendorEnrichmentApi.ts
- src/lib/audit/lineageApi.ts (absorber)
- src/components/dashboard/audit/stages/VendorEnrichmentWorkspace.tsx
- src/components/dashboard/audit/stages/ScopeReviewWorkspace.tsx (absorber only)
- src/components/dashboard/audit/stages/QuestionnaireReviewWorkspace.tsx (latch only)
- src/components/dashboard/audit/stages/IntakeWorkspace.tsx (latch + comment)
- src/lib/audit/__tests__/vendorEnrichmentApi.test.ts (new)
- src/lib/audit/__tests__/lineageApi.test.ts
- src/components/dashboard/audit/stages/__tests__/VendorEnrichmentWorkspace.test.tsx
- src/components/dashboard/audit/stages/__tests__/ScopeReviewWorkspace.test.tsx
- plans/sixonelabs-piqc/audit-load-path-honesty.md

## Out of scope

- supabase/** (no migrations, no edge functions)
- src/lib/audit/preAuditApi.ts and PR-1's surfaces
- Result-ification of the remaining null-convention API files (opportunistic
  rule: convert when a caller needs error state — this PR converts exactly
  the trio whose callers do)
- The write-path handlers' optimistic/revert flows (VendorEnrichment save
  handlers keep their existing shape; write-side Result-ification is
  ledgered with PR-1's upsert-seam item)
- src/context/**, other modes

## Architecture layers touched

component, API (Result-ification of three reads), test

## Mock data plan

None. Test mocks in __tests__/ only.

## Approved-by

@karl-dev-piqc (audit components + lib/audit)

## Verification

- CI: typecheck + vitest green (first execution — no local Node).
- New tests pin: trio Result mapping (row → ok/data, empty → ok/null-or-[],
  error → ok:false + logged); VendorEnrichment renders the load-error card
  (not create forms) on a failed read, Retry recovers; a legitimately-empty
  server response CLEARS a stale cache entry (the old truthiness bug);
  ScopeReview keeps its cache on an errored fetch instead of clobbering.
- E2E (user, deployed): Stage 2 with DB reachable → unchanged; simulate a
  failed read (offline) → error card + Retry instead of empty entry forms;
  Stage 4 scope context survives a transient vendor-fetch error.
