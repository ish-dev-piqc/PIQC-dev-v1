---
owner: sixonelabs-piqc
feature: deliverables-export-winansi-safe
status: active
started: 2026-07-19
target_pr:
---

# Deliverables export — winAnsiSafe guards data-driven text at the PDF boundary

## Context

PR #520 fixed the VEW worksheet exporter: jsPDF's built-in helvetica is WinAnsi (CP1252)-only, so protocol-derived strings containing ≤ ≥ µ × → − or symbols like ✓ silently print as mojibake. The deliverables exporters (`buildDeliverablePdf` + `buildSivDeck`) carry the identical exposure — packet title, protocol title/code, block `display_text`, speaker notes, and source sections reach `doc.text()` / autotable cells unsanitized. This ports the same fix and hoists `winAnsiSafe` to a shared non-mode home in `src/lib/` so the two export lanes stop duplicating the table (mode isolation forbids a cross-lane import). `src/lib/sotr/exportApi.ts` needs nothing — CSV, no jsPDF.

## Scope (files allowed)

- src/lib/winAnsiSafe.ts
- src/lib/__tests__/winAnsiSafe.test.ts
- src/lib/visit-execution/visitExecutionExportApi.ts
- src/lib/deliverables/deliverablesExportApi.ts
- src/lib/deliverables/exporters/buildSivDeck.ts
- src/lib/deliverables/__tests__/deliverablesExportApi.test.ts
- src/lib/deliverables/__tests__/buildSivDeck.test.ts
- plans/sixonelabs-piqc/deliverables-export-winansi-safe.md

What each file does (prose kept off the Scope bullets so scope-check's glob matching works):

- `src/lib/winAnsiSafe.ts` — NEW canonical home for the transliteration helper, moved verbatim from `visitExecutionExportApi.ts`
- `src/lib/__tests__/winAnsiSafe.test.ts` — NEW; mirrors PR #520's winAnsiSafe describe block against the shared module
- `src/lib/visit-execution/visitExecutionExportApi.ts` — local impl replaced with import + re-export; public surface and behavior unchanged, existing tests untouched
- `src/lib/deliverables/deliverablesExportApi.ts` — wrap packet-derived strings at the doc.text/autotable boundary
- `src/lib/deliverables/exporters/buildSivDeck.ts` — same, including the splitTextToSize measurement paths
- deliverables `__tests__` — boundary assertions (≤ → <=, ✓ → ?, CP1252 typography intact)

## Out of scope (files forbidden)

- src/lib/sotr/exportApi.ts — CSV export, no jsPDF, nothing to fix
- src/lib/visit-execution/__tests__/visitExecutionExportApi.test.ts — its existing winAnsiSafe describe block now guards the re-export; deliberately untouched
- src/lib/deliverables/deliverableExportConfig.ts — hardcoded labels, already CP1252-safe (pdf-safe-glyphs discipline)
- supabase/**
- src/components/**
- src/context/**

## Architecture layers touched

- [ ] migration (`supabase/migrations/`)
- [ ] RPC (`supabase/functions/` or `.sql`)
- [x] adapter — lib export-API layer (pure PDF builders; no supabase import added anywhere)
- [ ] context (`src/context/`)
- [ ] component (`src/components/`)
- [x] test (`src/**/__tests__/`)

No migration in diff → no type-mirror impact.

## Mock data plan

none

## Approved-by

- @fable-dev-piqc — src/lib/deliverables/** (Protocol Deliverable Engine)
- @ish-dev-piqc — src/lib/visit-execution/visitExecutionExportApi.ts (helper hoisted out; behavior identical, re-export keeps the module's public surface)

## Verification

- [ ] `npm run typecheck` (`tsc --noEmit -p tsconfig.app.json`) clean
- [ ] `vitest run` green on: src/lib/__tests__/winAnsiSafe.test.ts, src/lib/deliverables/__tests__/deliverablesExportApi.test.ts, src/lib/deliverables/__tests__/buildSivDeck.test.ts, and src/lib/visit-execution/__tests__/visitExecutionExportApi.test.ts (existing describe block passes against the re-export)
- [ ] New boundary tests prove: a packet containing `dose ≤ 50 µg × 3 → titrate ≥ 25` renders `dose <= 50 ug x 3 -> titrate >= 25` in BOTH builders; ✓/⚠ become `?`; CP1252 typography (— · § ± °) passes through untouched
