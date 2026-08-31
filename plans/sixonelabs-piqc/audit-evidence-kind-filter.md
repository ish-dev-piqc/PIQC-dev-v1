---
owner: sixonelabs-piqc
feature: Evidence register kind filter — listAuditEvidence parity with generation snapshots
status: active
started: 2026-08-30
target_pr:
---

# Evidence register kind filter (listAuditEvidence ↔ generation snapshot parity)

## Context

Pre-existing quirk ledgered in the PR-D3 plan's decision-debt section, spun out as its own
one-file+test change. `listAuditEvidence` (src/lib/audit/evidenceApi.ts) selects all
`audit_source_documents` rows joined to `documents(title, status)` with no `documents.kind`
filter, while the audit-deliverable-draft edge function drops any doc whose
`kind !== 'AUDIT_EVIDENCE'` from generation snapshots (index.ts:421). A document of another
kind attached to an audit (only reachable via a hand-crafted `audit_mode_attach_evidence`
RPC call — the normal ingest path always sends kind='AUDIT_EVIDENCE') therefore appears in
the client register but never in snapshots, so `computeDeliverableCurrency` permanently
flags it `newSinceGeneration` on every PIQC-drafted deliverable. Fix: inner-join the
embed and filter it to kind='AUDIT_EVIDENCE' so both registers agree. Deliberately NOT
adding a `status` filter — the client register must keep showing processing/failed
evidence; only generation is ready-only.

## Scope (files allowed)

- src/lib/audit/evidenceApi.ts (listAuditEvidence select → `documents!inner(title, status)` + `.eq('documents.kind', 'AUDIT_EVIDENCE')`)
- src/lib/audit/__tests__/evidenceApi.test.ts (mock chain gains a second `.eq`; new test locking the kind filter + inner join)
- plans/sixonelabs-piqc/audit-evidence-kind-filter.md (this file)

## Out of scope (files forbidden)

- supabase/functions/audit-deliverable-draft/** (snapshot side already filters — untouched)
- src/lib/audit/deliverableGenerationApi.ts (currency comparison logic unchanged)
- src/components/dashboard/audit/** (callers consume the same Result shape — no change)
- supabase/migrations/** (no schema change)
- src/types/audit/** (payload shape unchanged — kind is filtered on, not returned)

## Architecture layers touched

- [ ] migration (`supabase/migrations/`)
- [ ] RPC (`supabase/functions/` or `.sql`)
- [ ] adapter (`src/lib/*/*Adapter.ts`)
- [ ] context (`src/context/`)
- [ ] component (`src/components/`)
- [x] test (`src/**/__tests__/`)

(API layer: `src/lib/audit/evidenceApi.ts` — Result<T> contract unchanged.)

## Mock data plan

none

## Approved-by

- @karl-dev-piqc — for src/lib/audit/evidenceApi.ts and src/lib/audit/__tests__/evidenceApi.test.ts (owner of src/lib/audit/ per docs/CODEOWNERS.md)

## Verification

- [ ] `npx vitest run src/lib/audit/__tests__/evidenceApi.test.ts` passes (CI — no Node on the authoring machine)
- [ ] New test asserts the select embeds `documents!inner(title, status)` and `.eq('documents.kind', 'AUDIT_EVIDENCE')` is applied alongside the audit_id filter
- [ ] Existing listAuditEvidence tests (object/array join normalization, error passthrough) still pass unchanged
- [ ] Manual: evidence register in EvidenceDrawer still lists pasted evidence for a seeded audit (all normal-path rows are kind AUDIT_EVIDENCE, so no visible change expected)
