# Source of Truth Reviewer (SOTR) — Architecture

_Last updated: 2026-05-09. Author: PR-7 hardening pass._

This document captures the layer boundaries and invariants of the SOTR
feature so future contributors can extend it without breaking the design.

---

## Product framing

**SOTR is a draft review aid.** It helps a user look at a parsed protocol
field, see where it came from in the original PDF, and accept / edit /
reject / flag it as part of preparing a draft worksheet.

PIQC is **not** a final approval system, an electronic signature system,
a Part 11 system, or a GxP system of record. Final approval, authentication,
signature, and controlled release happen outside PIQC. The codebase's
naming, UI copy, RPC enum names, and disclaimers all reflect this.

---

## Layer boundaries

```
                    ┌─────────────────────────────────────┐
   user uploads ──▶ │  Reducto (third-party PDF parser)   │
       PDF          └────────────────┬────────────────────┘
                                     │ structured fields
                                     │ + per-field citations
                                     ▼
                    ┌─────────────────────────────────────┐
                    │  ingest edge function               │
                    │  - persists PDF to protocol-pdfs    │
                    │  - calls Reducto Parse + Extract    │
                    │  - hands raw output to adapter      │
                    └────────────────┬────────────────────┘
                                     │ ReductoExtractWithCitations
                                     ▼
                    ┌─────────────────────────────────────┐
                    │  src/lib/sotr/sourceEvidenceAdapter │  PURE FUNCTION
                    │  ReductoExtract → AdapterOutput     │  no DB, no fetch
                    │  (items + evidence + links)         │  graceful on missing
                    └────────────────┬────────────────────┘
                                     │ persistAdapterOutput
                                     ▼
       ┌─────────────────────────────────────────────────────────────┐
       │  Postgres                                                   │
       │   protocol_extracted_items   ◀─┐                            │
       │   protocol_source_evidence     │                            │
       │   protocol_item_evidence_links │  many-to-many              │
       │   worksheet_review_events      │  draft review history      │
       │   storage.objects (protocol-pdfs bucket)                   │
       │                                                             │
       │   RPCs (SECURITY INVOKER, study-scoped):                   │
       │     sotr_get_worksheet_item_evidence                        │
       │     sotr_get_worksheet_items_evidence_batch (cap 100)       │
       │     sotr_get_protocol_pdf_storage_path                      │
       │     sotr_create_review_event                                │
       │     sotr_get_draft_confidence_packet                        │
       │   Helpers (SECURITY DEFINER):                               │
       │     _sotr_build_sources_json                                │
       │     _sotr_build_review_snapshot                             │
       │     _sotr_extracted_value_to_text                           │
       └────────────────┬────────────────────────────────────────────┘
                        │ supabase.rpc / supabase.storage
                        ▼
       ┌────────────────────────────────────────────────────────────┐
       │  src/lib/sotr/*Api.ts (TypeScript wrappers)                │
       │  sourceEvidenceApi  reviewApi  protocolPdfApi  exportApi   │
       │  - shape requests, normalize errors                        │
       │  - safe-log: counts + IDs only, NEVER bodies               │
       └────────────────┬───────────────────────────────────────────┘
                        │
                        ▼
       ┌────────────────────────────────────────────────────────────┐
       │  src/hooks/useWorksheetItemEvidence                        │
       │  idle → loading → success/error, manual retry + refresh    │
       └────────────────┬───────────────────────────────────────────┘
                        │
                        ▼
       ┌────────────────────────────────────────────────────────────┐
       │  src/components/sotr/*  (mode-agnostic, pure presentation) │
       │  WorksheetItemsList / WorksheetItemRow / SourceTruthDrawer │
       │  SourceTruthPanel / ReviewActionBar / FlagSourceButton     │
       │  ConfidenceBadge / ReviewStatusBadge / ViewCitedPageButton │
       │  DownloadDraftPacketButton                                 │
       └────────────────┬───────────────────────────────────────────┘
                        │
                        ▼
       ┌────────────────────────────────────────────────────────────┐
       │  Site Mode wiring                                          │
       │  src/components/dashboard/site/ProtocolTab.tsx             │
       │  (Audit Mode wiring deferred — components are mode-neutral)│
       └────────────────────────────────────────────────────────────┘
```

### Why these boundaries exist

| Boundary | What it protects |
|---|---|
| Parser ↔ Adapter | Lets Reducto change its response shape, or be swapped for another parser, without touching SOTR DB or UI. The adapter is the only place that knows Reducto's wire format. |
| Adapter ↔ Database | Adapter is a pure function — it's testable without a DB, and persistAdapterOutput is the only writer. |
| RPCs ↔ TS wrappers | All authorization (study membership, document ownership) lives server-side. The TS wrappers only validate request shape and normalize errors. |
| TS wrappers ↔ Hooks | Wrappers are stateless; hooks add React lifecycle (loading/error state, refresh). |
| Hooks ↔ Components | Components don't fetch directly. Tests can render components with mocked hooks/wrappers without standing up Supabase. |
| Mode-agnostic components | `src/components/sotr/` knows nothing about Site vs. Audit mode. Audit Mode wiring (PR-N+) only needs to import and pass `studyId`. |

---

## Authorization model

**Every SOTR RPC enforces the same gate, server-side:**

```sql
-- Caller is authenticated AND owns the document AND the document
-- belongs to the requested study (protocol).
WHERE d.user_id     = auth.uid()
  AND d.protocol_id = p_study_id
```

This is layered on top of RLS on `protocol_extracted_items`, `protocol_source_evidence`, and `worksheet_review_events`. The explicit checks in RPC bodies provide:

- A single non-leaking error message regardless of which check fails (no existence-of-id leak).
- Defense in depth if RLS policies are ever altered.

For the PDF storage bucket, RLS on `storage.objects` checks that `auth.uid()::text` matches the leading folder of the object name (`{user_id}/{document_id}.pdf`). The signed URL is created client-side via the user's JWT — the server never returns the URL, only the path.

---

## Privacy invariants

These rules apply to all SOTR code. The test suite includes safe-log
assertions for the most sensitive paths.

| Field | Stored? | Returned to authorized caller? | Logged? |
|---|---|---|---|
| `quoted_source_text` (protocol passages) | ✓ | ✓ | **Never** |
| `reviewer_note` | ✓ | ✓ | **Never** |
| `new_item_text` (edit content) | ✓ | ✓ | **Never** |
| Signed PDF URLs | n/a (ephemeral) | ✓ | **Never** |
| Storage paths | ✓ | ✓ (via RPC, not raw) | **Never** |
| `studyId`, `worksheetItemId`, lengths, counts | ✓ | ✓ | ✓ (these only) |

The `console.info('[sotr] …')` calls in every wrapper emit only the
right-column fields. Tests in
`src/lib/sotr/__tests__/{reviewApi,exportApi,protocolPdfApi}.test.ts`
explicitly assert sensitive bodies never appear.

---

## Naming policy

Code, comments, UI labels, RPC enum values, and exported file content all
use **draft / review** language. The build never introduces:

- "approve", "approved", "approval"
- "sign", "signed", "signature"
- "certify", "certified"
- "GxP", "Part 11"
- "validated approval", "regulatory signoff"

The only acceptable usage is a negative reference ("PIQC is **not** a
signature system") or unrelated technical concepts (a "signed URL" is a
storage auth concept, not a compliance signature).

The export's draft disclaimer in `DRAFT_DISCLAIMER` makes the boundary
explicit to the user.

---

## File map

| Path | Role |
|---|---|
| `supabase/migrations/2026050800XXXX_*.sql` | SOTR schema + RPCs |
| `supabase/migrations/2026050900XXXX_sotr_pr7_cleanup.sql` | DRY refactor of inline SQL |
| `supabase/functions/ingest/index.ts` | Reducto pipeline + PDF storage upload |
| `src/types/sotr/index.ts` | All SOTR TypeScript types in one file |
| `src/lib/sotr/sourceEvidenceAdapter.ts` | Reducto → SOTR pure mapper |
| `src/lib/sotr/sourceEvidenceApi.ts` | Read-side RPC wrappers |
| `src/lib/sotr/reviewApi.ts` | Draft review action wrapper |
| `src/lib/sotr/protocolPdfApi.ts` | Signed-URL fetch |
| `src/lib/sotr/exportApi.ts` | CSV builder + download orchestrator |
| `src/hooks/useWorksheetItemEvidence.ts` | Fetch state hook |
| `src/components/sotr/*.tsx` | Mode-agnostic UI |
| `src/components/dashboard/site/ProtocolTab.tsx` | Site Mode wiring |
| `scripts/smoke-rpcs.sh` T13–T40 | DB integration tests |

---

## See also

- [`docs/sotr/follow-ups.md`](follow-ups.md) — deferred work and known gaps.
- `plan.md` — overall PIQC build plan and status.
