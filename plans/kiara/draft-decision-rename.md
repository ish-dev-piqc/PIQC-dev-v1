---
owner: ki-dev-piqc
feature: draft-decision-rename
status: active
started: 2026-06-13
target_pr:
---

# Rename "Decision" → "Draft decision" in chat surface UI

## Context

Mirror of the "Activity log" → "Draft activity" rename that already
shipped on the Organization page. The chat surface still says
"Promote to decision" and the panel header says "Decisions" — both
read as if PIQClinical was certifying the call. It isn't:
PIQClinical observes and records what teams decided. Adding "Draft"
sets the right user expectation, same as on activity.

## Design

Pure copy change in user-facing strings. Internal type names
(`ChatDecision`, `chat_decisions` table, `decision_id` columns, the
`DecisionList` / `DecisionPromoteModal` filenames) stay as-is.

Changes:

- "Promote to decision" → "Promote to draft decision"
- "Decisions (N)" → "Draft decisions (N)"
- "Delete the decision X" → "Delete the draft decision X"
- "View decisions for this channel" → "View draft decisions for this channel"
- "N decision(s)" pill in chat header → "N draft decision(s)"
- Hub Today's "Decisions awaiting your ack" → "Draft decisions awaiting your ack"
- Help copy in the Promote modal gets a one-line clarification:
  > "Draft" because PIQClinical records what your team decided — it
  > doesn't certify the call.

## Scope (files allowed)

### New

- `plans/kiara/draft-decision-rename.md` — this file.

### Modified

- `src/components/dashboard/organization/chat/MessageActions.tsx`
- `src/components/dashboard/organization/chat/DecisionPromoteModal.tsx`
- `src/components/dashboard/organization/chat/DecisionList.tsx`
- `src/components/dashboard/organization/ChatTab.tsx`
- `src/components/dashboard/organization/HubTodayTab.tsx`

## Architecture layers touched

- [x] component (UI strings only)

## Mock data plan

None.

## Approved-by

Self (chat surface lives in `src/components/dashboard/organization/`
which is shared infrastructure — but this is a pure copy change with
zero behavior impact, no DB / RPC / adapter / API changes).

## Verification

- `npx tsc --noEmit --skipLibCheck -p tsconfig.app.json` → 0 errors
- Manual:
  - Hover a chat message → "Promote to draft decision".
  - Open the decisions panel → header "Draft decisions (N)".
  - Hub Today tab → "Draft decisions awaiting your ack".
  - Promote modal opens with the new title + help copy.

## Mechanical checks

- No `.channel(` outside `src/context/`.
- No `@supabase/supabase-js` in components.
- No `: any` in `src/lib/**`.
- Plan MD referenced in PR body (this file).
- Internal type / table names unchanged.
