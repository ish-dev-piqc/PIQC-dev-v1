---
owner: ki-dev-piqc
feature: participant-timeline
status: merged
merged: 2026-06-06
started: 2026-06-04
target_pr: #299
---

# Participant timeline — unified feed in profile drawer

## Context

`ParticipantProfileDrawer`'s "Visit history" section is a visit-only
list. Coordinators often need to see *the full picture* on a
participant: visits + decisions captured in chat that reference
them. This PR merges visits + chat decisions into a single
reverse-chronological timeline.

## Design

### Data sources

- **Visits** — already on the drawer via `useSiteData().visits`,
  scoped to the participant by `participantId === participant.id`.
- **Decisions** — `chat_decisions` whose `title` or `rationale`
  references the participant code (substring match
  `'%[participant:P-0023]%'`). Scoped to the participant's
  protocol channel plus the active org's #general channel — those
  are where participant-related decisions get captured.

Future: pull `[participant:CODE]` mentions from raw message bodies
too. For v1 just decisions, which are the curated subset that
coordinators care about.

### New API — `listDecisionsReferencingParticipant`

`{ participantCode, protocolId, orgId } → Promise<Result<ChatDecision[]>>`.
Two queries (protocol-channel + org-channel), each filtered by
`title.ilike OR rationale.ilike` on the bracketed token. Union'd
client-side, bounded at 200 rows total.

### New adapter — `participantTimelineAdapter.ts`

Pure module that merges a list of visits + a list of decisions into
an ordered `TimelineEvent[]`:

- `{ kind: 'visit'; date; visit }`
- `{ kind: 'decision'; date; decision }`

Sorted newest first; ties broken by id for stable render order.

### ChatNavigationContext extension

Add a third handler `navigateToOrgChat(channelKey, messageId?)`.
Implementation already lives in `App.tsx` as
`handleNavigateToOrgChat`; this PR just exposes it through the
context so the drawer can call it without prop drilling.

### UI — replace "Visit history" with "Timeline"

Same drawer section. Header now reads "Timeline (N events)". Visit
rows render as before. Decision rows are clickable — they navigate
to Organization → Chat → the source channel with deep-link to the
source message via `navigateToOrgChat`.

Empty state when both lists are empty: "No activity recorded for
this participant yet."

## Scope (files allowed)

### New

- `src/lib/site/participantTimelineAdapter.ts`
- `src/lib/site/__tests__/participantTimelineAdapter.test.ts`
- `plans/kiara/participant-timeline.md` — this file.

### Modified

- `src/lib/orgs/orgsApi.ts` —
  `listDecisionsReferencingParticipant` helper.
- `src/context/ChatNavigationContext.tsx` — add
  `navigateToOrgChat`.
- `src/App.tsx` — wire `handleNavigateToOrgChat` into the provider
  value.
- `src/components/dashboard/site/ParticipantProfileDrawer.tsx` —
  swap visit-history section for the merged timeline.

## Architecture layers touched

- [x] adapter (pure)
- [x] API (orgs extension)
- [x] context (extension)
- [x] component

## Mock data plan

None.

## Approved-by

Self — touched files are all in domains Kiara owns
(`src/lib/orgs/`, `src/context/`, Site Mode components).

## Verification

- `npx tsc --noEmit --skipLibCheck -p tsconfig.app.json` → 0 errors
- Sibling test passes (adapter merge order + empty input).
- Manual:
  - Participant with 3 visits + 1 decision referencing their code →
    Timeline shows 4 rows reverse-chronologically.
  - Click decision row → switches to Organization → Chat → the
    decision's channel, scrolls to and highlights the source
    message.
  - Participant with no visits, no decisions → empty-state copy.
