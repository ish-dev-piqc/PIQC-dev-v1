---
status: in-review
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
- src/context/**, other modes

## Scope amendment (during adversarial review)

The review found the WRITE path in the same component carrying the identical
lie inverted: create/update/upsert wrappers return null on RPC failure, the
handlers' `if (result)` skipped the reconcile, and the catch blocks never
ran (the wrappers don't throw) — so optimistic rows rendered as saved
forever. Fixed in-scope (VendorEnrichmentWorkspace only): all five handlers
revert on null/false and surface a mutation-error banner. The wrappers'
Result-ification itself stays on the opportunistic ledger. Also added: the
Stage-2 effect now hydrates protocolRisks (the mapping picker read them but
only Stage 1 fetched them — deep-linking to Stage 2 showed an empty picker
as "no tagged sections"); dead `fetchServiceMappings` (by-service-id, zero
callers, still error→[]) deleted per house rule 4 — removes one item from
PR-3's sweep list.

## Adversarial review outcomes (applied before PR)

Fixed: vacuous headline test (assertion order let the loading gate satisfy
the negative before any clearing happened — now waits out the gate first);
all-or-nothing load gate replaced with PER-READ error cards (a failed trust
read no longer locks the auditor out of two healthy sections — PR-1's own
per-axis rule); mappings cache write additionally requires the service read
healthy (the mappings query inner-joins vendor_service_objects, so ok-[]
under a failed service read may mean "join filtered", and writing it would
wipe a good cache that Stage 7 reads cache-only); Result error messages
surfaced on the cards (an RLS denial must read differently from a blip);
error card markup mirrors PR-1's for a mechanical PR-6 lift; retry no
longer resets open edit modes (mode resets moved to an audit-switch-only
effect); write-path fix + protocolRisks hydrate + dead-export deletion (see
amendment); no-op cache-write bailouts (unmemoized context value re-renders
~17 consumers per store change); mock-leak hygiene (Once overrides,
errorSpy restore, value-level updater assertions).

## Decision debt ledger (this PR)

- ScopeReview still renders vendor absence when a no-cache read flakes
  (sign-in landing directly on Stage 4): its advance gate reads the server
  stage readout and fails closed, so the exposure is informational context
  only. Trigger: user report of missing Stage-2 context at Stage 4.
- QuestionnaireReview keeps its `if (bundle)` truthiness (null legitimately
  means "not created yet"; no delete path makes staleness real).
- intakeApi's fetchProtocolRisksForAudit still returns a bare array
  (error→[]) — opportunistic Result rule's territory.
- The vendor entry forms don't draft-preserve typed content on a failed
  save (short structured fields; the banner names the loss) — PR-1-grade
  draft stashes are deliberate overkill here.
- The stage workspaces fetch in components via lib Api modules (pre-existing
  pattern repo-wide; the mechanical rule only forbids importing supabase
  directly). This PR adds a user-triggered refetch (Retry nonce) inside a
  component — noted so it isn't read as newly sanctioned architecture.

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
