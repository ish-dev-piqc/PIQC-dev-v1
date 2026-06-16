---
owner: ish-dev-piqc
feature: strip-vendor-name-ui
status: active
started: 2026-06-16
target_pr:
---

# Strip vendor name ("Reducto") from user-facing website copy

## Context

User-facing UI copy names our document-parsing vendor by brand ("Reducto") in
seven places across the upload / onboarding / Ask / Protocol surfaces. We never
want to expose the parser vendor or any implementation "secret sauce" in shipped
website text. This change is pure copy: swap brand mentions for generic
first-person / "automatic" phrasing. No logic, data flow, or types touched.
Internal code (type names like `ReductoDocument`, code comments, `*.mjs`
scripts, plan MDs) is out of scope — none of it renders to users.

## Scope (files allowed)

- src/components/dashboard/KnowledgeBase.tsx
- src/components/dashboard/site/ProtocolOnboarding.tsx
- src/components/dashboard/site/AskTab.tsx
- src/components/dashboard/site/ProtocolUploadModal.tsx
- src/components/dashboard/site/ProtocolTab.tsx

## Out of scope (files forbidden)

- src/types/sotr/index.ts
- src/types/orgs/index.ts
- src/lib/sotr/sourceEvidenceAdapter.ts
- src/lib/orgs/orgsApi.ts
- src/components/dashboard/organization/HubDocumentsTab.tsx
- src/components/dashboard/organization/DocumentPreviewPane.tsx
- supabase/**
- fetch-reducto.mjs, verify-parser.mjs, parse-docs.mjs, deepextract.mjs, reparse.mjs

## Architecture layers touched

- [ ] migration (`supabase/migrations/`)
- [ ] RPC (`supabase/functions/` or `.sql`)
- [ ] adapter (`src/lib/*/*Adapter.ts`)
- [ ] context (`src/context/`)
- [x] component (`src/components/`)
- [ ] test (`src/**/__tests__/`)

## Mock data plan

none

## Approved-by

- @ki-dev-piqc — for the four Site Mode files (ProtocolOnboarding.tsx, AskTab.tsx, ProtocolUploadModal.tsx, ProtocolTab.tsx)

## Verification

- [ ] `grep -rni reducto src/components` returns zero hits in rendered JSX/string literals (comments excluded)
- [ ] Upload flow toast reads "Uploading PDF for parsing..."; dropzone reads "Parsed automatically — ..."
- [ ] Site onboarding step 2 reads "We parse it"; troubleshooting OCR line reads "our parser handles OCR..."
- [ ] Ask empty state, Protocol upload modal, and no-schedule empty state read with first-person phrasing, no vendor name
