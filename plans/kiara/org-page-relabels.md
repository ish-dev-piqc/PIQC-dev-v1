---
owner: ki-dev-piqc
feature: org-page-relabels
status: active
started: 2026-06-04
target_pr:
---

# Organization page — Members → Organization, Activity → Draft activity

## Context

Review feedback on the org page surfaces flagged two labels:

1. **"Members"** is ambiguous against team / protocol membership.
2. **"Activity log"** overpromises a formal audit trail. The data
   is trigger-driven and can have silent gaps; the label and copy
   should reflect that it's a working log, not a definitive record.

## Scope

### Modified

- `src/components/dashboard/organization/OrganizationPage.tsx` —
  `OrgTab` union (`'members'` → `'organization'`), `VALID_ORG_TABS`
  set, `readStoredOrgTab` legacy migration (`'members'` →
  `'organization'`), default initial tab, tab labels.
- `src/components/dashboard/organization/ActivityTab.tsx` — section
  heading "Activity log" → "Draft activity"; description copy
  rewritten to call out the not-a-formal-audit caveat.

## Out of scope

- Renaming the underlying `org_members` table or its API surface
  (`listOrgMembersWithProfile`, etc.) — these stay as-is. The
  change is label-only.
- Promoting Draft activity into a real audit trail. That's a
  separate work item: append-only chain hashes, periodic
  reconciliation against source tables, etc.

## Architecture layers touched

- [x] component

## Mock data plan

None.

## Verification

- `npx tsc --noEmit --skipLibCheck -p tsconfig.app.json` → 0 errors
- Manual:
  - First org-page tab now reads **Organization**, not Members.
  - Admin tab between Chat and Manage now reads **Draft activity**,
    not Activity.
  - Tab description on Draft activity calls out the
    not-a-formal-audit caveat.
  - With legacy `'members'` already in localStorage from before the
    rename, refresh lands on Organization (no fallback bounce).
