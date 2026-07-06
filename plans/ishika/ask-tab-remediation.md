---
owner: ish-dev-piqc
feature: ask-tab-remediation
status: in-review
started: 2026-07-05
target_pr:
---

# Ask tab remediation

## Context

A gap audit of the Site Mode "Ask" chat (floating bubble → `AskTab` → shared
`DashboardChat` → `streamDashboardChat` → `dashboard-chat` edge function → OpenAI + `hybrid_search`
RAG) surfaced one correctness bug and a batch of missing recovery/UX affordances, plus
Ask-specific server weaknesses. This PR fixes **the Ask tab only**. Scope is deliberately
constrained to the Ask feature and its own edge function.

**Explicitly descoped (repo-wide, not Ask — separate Roger security PR):** the audit also
found (a) leftover anon `USING(true)` SELECT policies on `documents`/`chunks` from migration
`20260417223946` making the whole corpus readable with the publishable anon key, (b)
`dashboard-chat` reading with the service-role key (RLS bypass), and (c) no protocol/org RLS on
documents. These are corpus-wide access-model issues that must NOT be folded into an Ask-tab
change. They are flagged for Roger to fix in a dedicated security PR. This plan does protocol
scoping at the app layer inside the edge function (validated via the existing
`user_can_access_protocol` RPC) without touching the RLS/trust model.

## Scope (files allowed)

Server (Ask edge function only — Approved-by @rv61):
- `supabase/functions/dashboard-chat/index.ts` — accept optional `protocolId`; validate access via existing `user_can_access_protocol` RPC; scope the doc query to that protocol; redact OpenAI/RPC error text; add a relevance floor; strict history validation; env-overridable model names. No migrations, no RLS/trust-model change.

Client:
- `src/lib/supabase.ts` (Approved-by @rv61) — `streamDashboardChat` gains `protocolId`; unify the `ExtendedMessage`/`RagStatus` types here.
- `src/lib/site/useAskThread.ts` — protocol-bound guarded setter (kills cross-thread leak) + `clear()`; intentional persistence rule; suppress per-token writes.
- `src/components/dashboard/site/AskBubble.tsx` — New-chat button, unread dot, a11y (dialog/Escape/focus), remount-by-key on protocol/new-chat.
- `src/components/dashboard/site/AskTab.tsx` — pass `protocolId` + `abortOnUnmount`; drop dead doc-id override machinery.
- `src/components/dashboard/site/DemoAskPanel.tsx` — fix stale "AskRail" comment (comment-only).
- `src/components/dashboard/DashboardChat.tsx` (SHARED — Audit consumes; Approved-by @karl-dev-piqc for awareness) — retry + in-bubble errors, empty-response + client-timeout handling, DocumentSelector gated behind `protocolId`, `abortOnUnmount`, scroll pill, copy button, `'stopped'` rag state. All new props default to current behavior so Audit Mode is unchanged.
- `src/components/dashboard/Dashboard.tsx` (SHARED) — import the unified `ExtendedMessage` (one line); call site unchanged.
- Tests: `src/lib/site/__tests__/useAskThread.test.ts` (extend), `src/components/dashboard/__tests__/DashboardChat.test.tsx` (new — Audit regression guard).

## Out of scope (files forbidden)

- `supabase/migrations/**` — no schema/RLS changes in this PR (the descoped security items live here; separate Roger PR).
- `supabase/functions/audit-mode-chat/**`, `supabase/functions/chat/**` — other chat surfaces, untouched.
- `src/lib/site/askPrompts.ts` — suggestion logic unchanged.
- `src/lib/demo/fixtures/askResponses.ts` — demo answer content unchanged.
- Any `visit-execution/`, `sotr/`, `audit/` component/lib dirs.

## Architecture layers touched

- [ ] migration
- [ ] RPC
- [ ] adapter
- [ ] context
- [x] component
- [x] API (edge function + `src/lib/supabase.ts` client helper)
- [x] test

## Mock data plan

None.

## Approved-by

- @rv61 — `supabase/functions/dashboard-chat/index.ts`, `src/lib/supabase.ts` (Roger's ownership).
- @ki-dev-piqc — implicit: this is Kiara's Site Mode area (`src/lib/site/`, `src/components/dashboard/site/`); Ishika is driving with her sign-off.
- @karl-dev-piqc — `src/components/dashboard/DashboardChat.tsx` shared with Audit Mode; all changes prop-gated + default-safe. Tag for awareness.

## Verification

- [ ] Switch protocols mid-stream → old thread keeps its question, no tokens leak into the new protocol's thread/sessionStorage; both threads usable after.
- [ ] New-chat clears the active protocol's thread + storage key; collapse mid-stream aborts the request (DevTools) and reopen shows a settled "stopped" state, not a phantom cursor.
- [ ] Failed send / empty response / 35s timeout all show an in-bubble error with a working Retry; user message preserved.
- [ ] Ask hides the DocumentSelector; server scopes retrieval to `protocolId` (sources never from another protocol); bad protocolId → 404.
- [ ] Error redaction: bogus OPENAI key → `{"error":"AI service error"}` (no `detail`); forced RPC error → `X-Rag-Error: retrieval_error` only.
- [ ] Audit Mode chat regression: selector present, streams + cites, background completion still works (no `abortOnUnmount`), in-bubble errors render.
- [ ] `npm run typecheck && npm run test && npm run build` pass; `/piqc-review` clean.
