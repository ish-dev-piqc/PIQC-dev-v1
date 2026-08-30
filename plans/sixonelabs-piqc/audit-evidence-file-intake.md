---
owner: sixonelabs-piqc
feature: Evidence file intake (PR-B2) — .docx/.xlsx extraction into the paste flow
status: in-review
started: 2026-08-30
target_pr:
---

# Evidence file intake (PR-B2)

## Context

Evidence arrives as emailed Word/Excel files (workflow Q&A round 1); v1 made the auditor copy-paste. PR-B2 removes that friction with the smallest honest mechanism: a new stateless `evidence-extract` edge function (JWT-gated, rate-limited, NO database access, no service role) takes `{filename, file_base64}`, extracts text — `.docx` via `npm:mammoth`, `.xlsx` via `npm:xlsx` (already the house spreadsheet lib client-side) — and returns `{text, warnings}`. The drawer's add form gains a file picker that lands the extracted text **in the existing textarea for the auditor to review before attaching**: extraction preview, then the exact shipped paste flow (checkbox normalization → `/ingest` text path → attach RPC). `/ingest` and `ingestPipeline.ts` untouched.

**Mechanism decision (was TBD):** server-side, because client-side `.docx` parsing needs a new npm dependency and `package-lock.json` cannot be regenerated on the authoring machine (no Node); Deno functions carry no lockfile — `npm:` specifiers resolve at deploy. Extraction failure degrades honestly: "couldn't read the file — paste the text instead."

## Scope (files allowed)

- supabase/functions/evidence-extract/index.ts (new — stateless transform, no DB)
- src/lib/audit/evidenceApi.ts (add extractEvidenceFile: Result<{text, warnings}>)
- src/lib/audit/__tests__/evidenceApi.test.ts (extend)
- src/components/dashboard/audit/EvidenceDrawer.tsx (file picker in the add form; extracted text → textarea; warnings line; copy updated — "attach is coming" arrived)
- src/components/dashboard/audit/__tests__/EvidenceDrawer.test.tsx (extend: extract-fills-form, extraction-failure remediation)
- plans/sixonelabs-piqc/audit-evidence-file-intake.md (this file)
- plans/sixonelabs-piqc/_archive/audit-export-currency-flag.md (step-0 archive)

## Out of scope (files forbidden)

- supabase/functions/ingest/**, _shared/ingestPipeline.ts (text path consumed as-is)
- PDF evidence (PR-B3+; Reducto path stays deferred)
- package.json / package-lock.json (no npm deps — the mechanism decision exists to avoid them)
- Auto-attach on extraction (the auditor reviews the extracted text first — deliberate)
- src/context/**

## Architecture layers touched

- [ ] migration (`supabase/migrations/`)
- [x] RPC (`supabase/functions/`) — new stateless edge function
- [ ] adapter (`src/lib/*/*Adapter.ts`)
- [ ] context (`src/context/`)
- [x] component (`src/components/`)
- [x] test (`src/**/__tests__/`)

## Mock data plan

none

## Approved-by

- @karl-dev-piqc — for src/lib/audit/**, src/components/dashboard/audit/**
- @rv61 (self) — supabase/**

## Verification

CI-first: no Node/npm/tsc/vitest on the authoring machine — CI is where typecheck and tests first execute. The edge function's mammoth/xlsx behavior is NOT CI-covered (Deno-only) — staging smoke test is the first real run.

- [ ] CI green (typecheck + vitest incl. extended suites)
- [ ] Staging: deploy evidence-extract → attach a real checkbox-bearing .docx questionnaire → text appears in textarea, glyphs normalize on attach, row ready
- [ ] Staging: attach an .xlsx (multi-sheet) → per-sheet sections in textarea
- [ ] Staging: corrupt/renamed file → remediation error, paste path still works
- [ ] Staging: >10MB file → clear size error
