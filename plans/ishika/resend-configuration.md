---
owner: ish-dev-piqc
feature: resend-configuration
status: active
started: 2026-05-23
target_pr:
---

# Resend — project configuration

## Context

Resend is wired in one place today: `supabase/functions/contact/index.ts` (landing-page contact form) calls `https://api.resend.com/emails` via an inline `fetch`. A second consumer is queued — org-invite emails, explicitly flagged as Resend follow-up in `plans/ishika/_archive/orgs-admin-ui-and-invites.md`. Three gaps to close before that next consumer arrives: (1) extract the inline call into a reusable `supabase/functions/_shared/resend.ts` helper so the next caller doesn't copy-paste; (2) wire Resend's official MCP server (`resend-mcp`) into a project-scoped `.mcp.json` so Claude can list/verify domains and send test emails from the IDE during dev; (3) document the operational setup (DNS verification + `supabase secrets set`) in `docs/RESEND.md` so future devs don't hunt through plan MDs.

Pure refactor + tooling/docs. No behavior change for the contact form. Org-invite email wiring is a separate follow-up plan.

## Scope (files allowed)

- `supabase/functions/_shared/resend.ts` (NEW — shared helper, ~75 LOC)
- `supabase/functions/contact/index.ts` — delete inline `sendEmail`, call helper
- `.mcp.json` (NEW — project root)
- `docs/RESEND.md` (NEW)
- `.env.example` — append trailing documentation comment
- `plans/ishika/resend-configuration.md` — this plan

## Out of scope (files forbidden)

- `src/components/dashboard/site/OrgSettingsDrawer.tsx` and `src/lib/orgs/orgApi.ts` — wiring org-invite emails is a separate plan; this PR only sets up the helper for that consumer
- `src/components/dashboard/site/TodayTab.tsx` and `src/lib/site/dateUtils.ts` — cert-alert emails are not on the roadmap for this PR
- Any other `supabase/functions/*` — only `_shared/` and `contact/` are touched
- `src/lib/**` — edge functions don't import from `src/lib`; the helper lives in `_shared/`, not `src/`
- `src/types/**` — no DB schema change, no type mirror
- `package.json` / `package-lock.json` — `resend-mcp` is run via `npx -y`, no project dependency
- `.github/workflows/**`, `CLAUDE.md`, `docs/CODEOWNERS.md` — process files, not in this feature

## Architecture layers touched

- [ ] migration — N/A (no DB change)
- [x] RPC (`supabase/functions/`) — new `_shared/resend.ts`, refactored `contact/index.ts`
- [ ] adapter — N/A
- [ ] context — N/A
- [ ] component — N/A
- [ ] test — N/A (existing `src/lib/contact/__tests__/contactApi.test.ts` is unaffected; helper is server-side Deno code, not Vitest-reachable)

## Mock data plan

None.

## Approved-by

- `@rv61` (Roger) — for `supabase/functions/_shared/resend.ts` (NEW) and `supabase/functions/contact/index.ts` (edit). Both files live under `supabase/` which is Roger's codeowner area per `docs/CODEOWNERS.md`.

Other Scope files (`.mcp.json`, `docs/RESEND.md`, `.env.example`) are not in any codeowner area — no additional Approved-by required.

## Verification

- [ ] `supabase functions deploy contact` succeeds (helper resolves, no Deno import errors)
- [ ] Submit landing-page contact form once → row appears in `contact_messages` → logs show `contact.recorded` event. Email outcome depends on domain-verification state (see note below) — the refactor must not change the failure mode either way.
- [ ] `grep -r 'fetch.*api.resend.com' supabase/functions/contact/` returns no hits (call moved out)
- [ ] `grep -r 'sendResendEmail' supabase/functions/` returns hits in both `_shared/resend.ts` (definition) and `contact/index.ts` (call site)
- [ ] After `export RESEND_API_KEY=…` in shell + Claude Code restart: ask Claude "list my Resend domains via the resend mcp" — returns the project's domain list (confirms MCP is wired)
- [ ] `docs/RESEND.md` is self-contained: a fresh dev can verify a domain and run a test send without reading any plan MD or CLAUDE.md
- [ ] `/piqc-review` passes locally; CI `piqc-discipline.yml` passes on the PR

**Note on domain verification:** `updates.piqclinical.com` is currently unverified in Resend. Until it's verified, the contact form's email send fails (DB row still saved; user still sees success because email is best-effort). This PR does not fix that — only DNS records do. The MCP makes the fix easier by exposing `domains.verify` from the IDE.
