---
owner: fable-dev-piqc
feature: sponsor-ask
status: in-review
started: 2026-07-07
target_pr:
---

# Sponsor Ask — protocol assistant in the Sponsor surface

## Context (from the cross-mode Ask review, 2026-07-07)

"Ask" is a protocol Q&A assistant. Its **core is already shared** and mode-agnostic:
- `src/components/dashboard/DashboardChat.tsx` — the chat UI, with a built-in
  **protocol-scoped "Ask" mode** (`protocolId` prop → server scopes retrieval to
  that protocol's docs, hides the doc selector; `hideHeader` / `emptyHeading` /
  `emptySubtext` / `customSuggestions` / `abortOnUnmount` knobs).
- `src/lib/supabase.ts` — `streamDashboardChat` + `ExtendedMessage` / `RagStatus`.
- `supabase/functions/dashboard-chat` — streaming RAG over protocol documents
  (hybrid search + rerank + structured DOCUMENT FACTS; section/page citations).

Each mode is a thin wrapper on that core:
- **Site** ✅ — `AskBubble` → `AskTab` → `<DashboardChat protocolId=… />` +
  `useAskThread` (per-protocol sessionStorage thread). Owner: Kiara.
- **Audit** ✅ *(already exists)* — `PiqcDock` + `AuditChatPanel` → its own
  `audit-mode-chat` edge fn (audit-scoped, stage-biased). Owner: Karl. **No work
  needed here** — the review confirmed Audit already ships "Ask PIQC".
- **Sponsor** ❌ — nothing. **This plan fills that gap.**

Because the core is shared and already supports protocol-scoped Ask, the build
is a thin Fable-owned wrapper with **no new backend and no new chat component**.

## Design

> **CRITICAL — which "Ask" this is.** There are TWO `DashboardChat` mounts, and
> this plan targets ONLY the protocol-grounded one:
> - ✅ **TARGET — the protocol Ask** (`src/components/dashboard/site/AskTab.tsx:169`):
>   `<DashboardChat protocolId={activeProtocol.id} emptyHeading="Ask about {code}"
>   emptySubtext="Grounded in N documents for {code}…" … />`. Passing `protocolId`
>   makes the `dashboard-chat` edge fn scope retrieval to **that protocol's parsed
>   documents** (doc selector hidden). This is the button the sponsor needs —
>   answers pulled from the parsed protocol.
> - ❌ **NOT this — the org-tab chat** (`src/components/dashboard/Dashboard.tsx:745`,
>   `case 'chat'`): `<DashboardChat selectedDocIds={…} setSelectedDocIds={…} />`
>   with **no `protocolId`** — a manual, org-wide document picker with NO protocol
>   scope. The Sponsor Ask must NOT reuse this pattern.
>
> Build rule of thumb: if `protocolId` isn't set on the `DashboardChat` you
> render, it's the wrong one.

- **Mount:** an "Ask about this protocol" surface inside the **Sponsor Protocol
  Intelligence tab** (`src/components/dashboard/sponsor/deliverables/`,
  Fable-owned), scoped to the tab's already-selected protocol
  (`selectedProtocol`). Rendering it in the tab means it inherits the tab's
  enterprise gate (`canUseSponsorMode`) and its protocol selection for free — no
  shell/`Dashboard.tsx` changes, no Kiara coordination.
- **What it renders:** the shared `<DashboardChat protocolId={selectedProtocol.id}
  hideHeader abortOnUnmount emptyHeading=… emptySubtext=… customSuggestions=… />`
  in protocol-scoped Ask mode — identical capability to Site's Ask (streaming,
  citations, DOCUMENT FACTS), reusing `streamDashboardChat` and the
  `dashboard-chat` edge fn unchanged.
- **Surface shape:** a `SponsorAskPanel.tsx` (Fable-owned) — either a collapsible
  "Ask about this protocol" section in the Intelligence tab, or a floating bubble
  mirroring `AskBubble` (recommend the inline collapsible panel: it lives in the
  Fable-owned tab, no shell mount, and reads as "ask about what you're looking
  at"). Sponsor framing lives in the empty-state props + suggestion chips
  ("Summarize this protocol", "What are the primary endpoints?", "What changed in
  the latest amendment?") — NOT a forked component.
- **Thread state:** a per-protocol thread (persist across reload + swap on
  protocol switch). `useAskThread` already does exactly this but lives in
  `src/lib/site/` (Kiara's). Two options:
  - **v1 (recommended):** a small Fable-owned `useSponsorAskThread` (the same
    generic per-protocol sessionStorage pattern, ~130 lines) — zero cross-owner
    coupling, ships immediately. Distinct storage key namespace.
  - **Follow-up:** promote `useAskThread` to a non-mode home (e.g.
    `src/lib/chat/useProtocolChatThread.ts`) consumed by BOTH Site's AskTab and
    Sponsor — the "second-consumer graduates the shared bit" pattern (as
    DeliverablePanel did). Needs Kiara's `Approved-by` (her file moves) — defer
    to a consolidation PR so v1 isn't blocked on coordination.

## Scope (files allowed)

- `plans/fable/sponsor-ask.md` — this file.
- `src/components/dashboard/sponsor/deliverables/SponsorAskPanel.tsx` — NEW wrapper.
- `src/components/dashboard/sponsor/deliverables/ProtocolIntelligenceTab.tsx` — mount the panel (scoped to selectedProtocol).
- `src/lib/deliverables/useSponsorAskThread.ts` (or `sponsor/deliverables/`) — NEW per-protocol thread hook (v1).
- Tests: the thread hook (pure-ish, sessionStorage) + a light render/gating check where the repo precedent supports it.

## Out of scope (files forbidden)

- `src/components/dashboard/DashboardChat.tsx` + `src/lib/supabase.ts` +
  `supabase/functions/dashboard-chat/**` — REUSED unchanged (shared/Roger's). No
  new edge function.
- `src/components/dashboard/site/**` + `src/lib/site/**` (Kiara) and
  `src/components/dashboard/audit/**` (Karl) — untouched. Audit already has Ask.
- A sponsor-TAILORED assistant that answers over deliverables/portfolio data
  (e.g. "which protocol has the biggest review backlog?") — that needs a new
  edge fn / tool-calling and is a **Phase 2** on the backend lane. v1 is
  protocol-document Q&A, identical to Site.
- Cross-mode Ask UX unification (Site bubble vs Audit dock) — a separate
  cross-owner concern, not this slice.

## Architecture layers touched

- [ ] migration / RPC / adapter / context
- [x] component (SponsorAskPanel + tab mount)
- [x] lib (thread hook)
- [x] test (thread hook)
- [ ] edge function (REUSED, not changed)

## Mock data plan

None (the site Ask has a demo panel behind a demo-mode toggle; sponsor v1 does
not need one — real `dashboard-chat` or nothing).

## Approved-by

- No non-Fable approval for v1: the mount + wrapper + thread hook are all in
  Fable-owned dirs; `DashboardChat` / `streamDashboardChat` / `dashboard-chat`
  are consumed unchanged.
- The consolidation follow-up (promoting `useAskThread`) would need Kiara
  (`@ki-dev-piqc`) — explicitly deferred out of v1.

## Verification

- [x] typecheck / build green; 11 thread-hook tests pass (incl. the
  namespace-isolation case vs the Site Ask key); full suite **1359 passed / 0
  failed** (the old 19-failure env baseline was fixed on main by the
  build-health work — fully green).
- [x] Discipline sweep: no Site context/lib import in the sponsor files
  (AskTab's useSiteData document gate deliberately NOT copied — the edge fn's
  own no-context rule covers the no-docs case); no raw grays; no `any`.
- [x] Built exactly the protocol-grounded Ask: `<DashboardChat protocolId=…/>`
  keyed `${protocol.id}:${epoch}` with abortOnUnmount (AskBubble remount trick),
  NOT the org chat's unscoped selectedDocIds mode.
- [ ] Manual (enterprise sponsor, a protocol with ingested docs — needs the
  backend live, same gate as the deliverables): open Protocol Intelligence →
  Ask about this protocol → a question returns a streamed, cited answer scoped
  to that protocol's documents; switching protocols swaps the thread; reload
  preserves the settled thread; collapsing/unmounting aborts an in-flight stream.
- [ ] Non-enterprise sub cannot reach it (inherits the tab gate).
- [ ] `/piqc-review` clean (no cross-mode import of site/audit; reuses the shared
  chat core; no new `any`; semantic tokens).

## Decisions encoded

1. **Reuse the shared chat core** — `DashboardChat`'s protocol-scoped Ask mode +
   `dashboard-chat`; no new backend, no forked chat UI. "Parse once, generate
   many" applied to Ask.
2. **Mount in the Fable-owned Intelligence tab** — inherits the enterprise gate +
   protocol selection; no shell change, no Kiara/Karl coordination.
3. **Audit is already done** — the review confirmed "Ask PIQC" exists; this slice
   is Sponsor-only.
4. **v1 = protocol-document Q&A** (identical to Site). A sponsor-tailored
   assistant over deliverables/portfolio data is a Phase-2 backend item.
5. **Thread hook Fable-owned in v1**, with a noted consolidation follow-up to a
   shared `useProtocolChatThread` once there are two proven consumers.
