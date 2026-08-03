---
owner: ki-dev-piqc
feature: visit-prep-ui-cleanup-and-cra-sponsor-merge
status: merged
merged: 2026-08-03
started: 2026-08-02
target_pr: #533
---

# Visit Prep UI cleanup + CRA/Sponsor merge

## Context

Pre-demo UI cleanup pass over Site Mode's Visit Prep surface, plus a
structural merge of CRA Mode and Sponsor Mode. The two modes were already
the same system underneath (one `deliverable_engine` entitlement, one
`DeliverablePanel`, one deliverable engine) — differing only in which
artifact types were offered, accent color, and copy — so they're now one
"Protocol Intelligence" workspace with two internal tabs (Workspace /
Portfolio) instead of two separate rail icons/modes. Nothing from either
surface was dropped: CRA's 2-artifact picker widened to the full 5-type set,
and Sponsor's cross-site Portfolio view moved in as a second internal tab.

Also folds "The Visit, in order" (read-only timeline) into "Work the visit"
(the acting checklist) — the two were "two presentations of the same rows,
deliberately" per the original design comment, but that split no longer
served a clear purpose once both read from the same workspace items; the
checklist rows now carry the reading's verbatim source-quote depth so
nothing was lost.

## Scope (files allowed)

**Site Mode (own):**
- `src/components/dashboard/site/ProtocolTab.tsx` — "View PDF" button
  (signs + opens the parsed protocol PDF); SOTR `WorksheetItemsList` hidden
  (commented, not deleted)
- `src/lib/site/protocolPdfApi.ts` (NEW) — signed-URL fetch, calls the
  existing `sotr_get_protocol_pdf_storage_path` RPC directly rather than
  importing SOTR's own `protocolPdfApi.ts` cross-mode (that import isn't on
  the piqc-discipline `ALLOWED_CROSS_MODE` allowlist)
- `src/components/dashboard/Dashboard.tsx` — Today/Participants/Visits/
  Reports tabs hidden (commented in `SITE_TABS`, not deleted); `'sponsor'`
  DashboardTab removed

**Visit Execution Workspace (Ishika's):**
- `src/components/dashboard/visit-execution/VisitExecutionTab.tsx` — role
  lens (`RoleFilterBar`) hidden pending demo (Add Requirement kept); merged
  "The visit, in order" + "Work the visit" into one section ("The visit")
- `src/components/dashboard/visit-execution/FootnotesDrawer.tsx` — fixed
  text-wrap bug (raw PDF line breaks rendered via `whitespace-pre-wrap` read
  as fragmented prose; now normalized, paragraph breaks preserved)
- `src/components/dashboard/visit-execution/ExecutionChecklist.tsx` — added
  the verbatim source-quote block (carried over from the retired
  `VisitSequenceBlock`) + a generic (not row-specific — no footnote↔item
  data link exists) "open Footnotes" affordance per row
- `src/components/dashboard/visit-execution/VisitSequenceBlock.tsx`
  (DELETED) — superseded by the above merge

**CRA + Sponsor merge (Fable's `cra`/`sponsor` dirs):**
- `src/components/dashboard/cra/CraWorkspaceShell.tsx` — upgraded to the
  full 5-artifact picker + protocol-grounded Ask panel + internal
  Workspace/Portfolio tabs; renamed "Protocol Intelligence"
- `src/components/dashboard/cra/craDeliverables.ts` +
  `__tests__/craDeliverables.test.ts` — `CRA_ARTIFACT_ORDER` widened to all
  5 types
- `src/components/dashboard/sponsor/SponsorPortfolio.tsx` (NEW) — extracted
  from the old `SponsorPage.tsx`, unchanged logic
- `src/components/dashboard/sponsor/SponsorPage.tsx` (DELETED) — superseded
- `src/components/dashboard/sponsor/deliverables/ProtocolIntelligenceTab.tsx`
  (DELETED) — superseded by the upgraded `CraWorkspaceShell`

**Shared infra (2 reviewers required):**
- `src/lib/entitlements.ts` + `src/lib/__tests__/entitlements.test.ts` —
  `canUseSponsorMode` + `canUseCraMode` collapsed into one
  `canUseProtocolIntelligence` (identical logic; two functions were kept
  separate "in case pricing diverges" — no such divergence has happened)

**No CODEOWNERS entry (flagging for general review, not a specific owner):**
- `src/App.tsx` — `VALID_DASHBOARD_TABS` + mobile-nav switch: drop `'sponsor'`
- `src/components/Navbar.tsx` — mobile menu: Sponsor entry → Protocol
  Intelligence (previously missing a CRA mobile entry entirely)
- `src/components/dashboard/LeftRail.tsx` — Sponsor rail icon removed;
  surviving `cra` icon relabeled "Protocol Intelligence"
- `src/components/dashboard/organization/HubTodayTab.tsx` — hub mode tile:
  Sponsor → Protocol Intelligence (`cra` mode), no longer "Coming soon"
- `src/components/dashboard/organization/OrganizationPage.tsx` — comment only

## Out of scope (files forbidden)

- Footnote↔procedure data linkage (new field on `VisitExecutionItem`,
  ingest-pipeline change, migration) — no such field/RPC exists today; real
  backend project, not a UI cleanup item. Today's footnote affordance is
  intentionally generic (opens the drawer, doesn't scroll to a specific
  letter).
- `supabase/migrations/**`, `supabase/functions/**` — no schema/RPC changes;
  reuses the existing `sotr_get_protocol_pdf_storage_path` RPC and
  `org_has_entitlement` RPC as-is.
- `src/lib/deliverables/**`, `src/components/deliverables/**` — the shared
  deliverable engine itself is untouched; only its CRA/Sponsor consumers
  changed.

## Architecture layers touched

- [ ] migration (`supabase/migrations/`)
- [ ] RPC (`supabase/functions/` or `.sql`)
- [x] adapter/api (`src/lib/site/protocolPdfApi.ts` — new, `Result<T>`)
- [ ] context (`src/context/`)
- [x] component (`src/components/` — see Scope above)
- [x] test (`src/lib/__tests__/entitlements.test.ts`,
      `src/components/dashboard/cra/__tests__/craDeliverables.test.ts` —
      updated to match; no new test scaffolding added elsewhere)

## Mock data plan

None — display-only changes (hide/show, copy, one new signed-URL fetch
against real Supabase RPCs/storage, one component merge).

## Approved-by

- @ish-dev-piqc — for `src/components/dashboard/visit-execution/**`
  (Visit Execution Workspace ownership) and as a required 2nd reviewer on
  `src/lib/entitlements.ts`. **Not yet obtained** — flagging on the PR.
- @fable-dev-piqc — for `src/components/dashboard/cra/**` and
  `src/components/dashboard/sponsor/**` (built these surfaces per
  `plans/fable/cra-mode-plumbing.md`, `cra-mode-workspace.md`,
  `sponsor-ask.md`). **Not yet obtained** — flagging on the PR.
- Note: `src/App.tsx`, `src/components/Navbar.tsx`,
  `src/components/dashboard/organization/**` have no CODEOWNERS entry at
  all — general review requested, no specific owner to tag.

## Known active-branch overlap

`origin/fix/site-mode-ux-gaps` (Ishika, status in-review, 1 commit unmerged
as of 2026-08-02) touches `src/components/dashboard/site/ProtocolTab.tsx`
and `src/components/dashboard/visit-execution/VisitExecutionTab.tsx` (adds
parsing-status copy/pills). Proceeding per Kiara's call — expect a merge
conflict on those two files whichever of the two PRs lands second.

## Separately: enabling CRA/Protocol Intelligence for a user test

Not a code change — `canUseProtocolIntelligence` gates on the real
`org_entitlements.deliverable_engine` row (ships empty/deny-all by design,
see `supabase/migrations/20260720000300_org_entitlements.sql`). To turn it
on for a test org:

```sql
INSERT INTO org_entitlements (org_id, capability, granted_by, note)
VALUES ('<your-org-id>', 'deliverable_engine', '<your-admin-user-id>', 'user test 2026-08-02')
ON CONFLICT (org_id, capability) DO NOTHING;
```

Run this in the Supabase SQL editor (or hand to Roger — `supabase/` is his).
Find `<your-org-id>` via `select id, name from orgs;`.

## Verification

- [ ] Site Mode tab bar shows only "Visit Prep"; Today/Participants/Visits/
      Reports unreachable but restorable by uncommenting `SITE_TABS`.
- [ ] Visit Prep → Footnotes drawer text reads as normal prose, no
      mid-sentence line breaks.
- [ ] Visit Prep → Protocol drawer shows "View PDF" (opens the parsed PDF in
      a new tab) and no longer shows the SOTR worksheet list.
- [ ] Visit Prep → "The visit" section: role lens chips gone, Add
      Requirement still present; single list shows checkboxes + verbatim
      source quotes + a footnotes icon per row (opens the drawer).
- [ ] Rail shows one "Protocol Intelligence" icon (no separate Sponsor
      icon); clicking it lands on the merged workspace with Workspace/
      Portfolio internal tabs, all 5 deliverable types selectable.
- [ ] Mobile nav menu shows the same Protocol Intelligence entry.
- [ ] Org hub's mode tile routes to Protocol Intelligence, no "Coming soon".
- [ ] `npm run typecheck` and `npm run lint` clean; targeted vitest files
      (`entitlements.test.ts`, `craDeliverables.test.ts`) pass.
- [ ] Run the `org_entitlements` INSERT above against a real test org to
      confirm the gate opens end-to-end (not just via a code review).
