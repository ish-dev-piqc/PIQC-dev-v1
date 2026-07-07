---
owner: sixonelabs-piqc
feature: fable-bugfix-fb-af47638
status: merged
merged: 2026-07-07
started: 2026-07-06
target_pr: #458
---

# Fable bug-hunt apply — FB-af47638-d7231d0354a2

## Context

Applies 11 verified bugs from bug-hunt run FB-af47638 over the never-audited surfaces (Site / VEW /
SOTR / context). Each survived blind adversarial verification; approval record at
plans/fable/approval-fb-af47638-d7231d0354a2.md. Fixes lock current-behavior via new tests. No
product-feature changes — correctness only.

## Scope (files allowed)

- src/context/ProtocolChatContext.tsx
- src/context/OrgChatContext.tsx
- src/context/AuditContext.tsx
- src/context/SiteDataContext.tsx
- src/context/ProtocolContext.tsx
- src/components/dashboard/audit/** (advanceStage error render site only)
- src/components/dashboard/site/ParticipantProfileDrawer.tsx
- src/lib/site/dateUtils.ts
- src/lib/site/repos/** (demoSiteRepo, realSiteRepo, types)
- src/lib/demo/** (demo fixtures for confidenceState only)
- src/lib/visit-execution/parseRoleHint.ts
- src/components/sotr/WorksheetItemRow.tsx
- src/lib/sotr/visitNameNormalize.ts
- src/lib/sotr/sourceEvidenceApi.ts
- all sibling __tests__ for the above

## Out of scope (files forbidden)

- website/
- supabase/migrations/
- Any behavior change beyond the 11 findings (tests lock CURRENT behavior)

## Architecture layers touched

- [ ] migration / RPC
- [x] adapter (demoSiteRepo, sourceEvidenceApi)
- [x] context (ProtocolChat, Org, Audit, SiteData, Protocol)
- [x] component (ParticipantProfileDrawer, WorksheetItemRow, audit advance render)
- [x] test (locking tests per finding)

## Mock data plan

none (demo fixtures for confidenceState use the seeded demo set only)

## Approved-by

- @ki-dev-piqc — src/lib/site/**, src/components/dashboard/site/** (site bugs)
- @ish-dev-piqc — src/lib/visit-execution/**, src/lib/sotr/**, src/components/sotr/** (VEW+SOTR)
- @ish-dev-piqc @ki-dev-piqc — src/context/** (2-reviewer), audit advance render site (Karl if audit component)

## Verification

- [ ] tsc --noEmit clean (via scratchpad-node)
- [ ] full vitest suite green (new locking tests pass)
- [ ] /piqc-review clean
- [ ] SOT-301 either fixed-with-test or flagged-not-applied (recorded in approval record)
