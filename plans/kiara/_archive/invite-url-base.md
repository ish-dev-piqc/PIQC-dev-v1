---
owner: ki-dev-piqc
feature: invite-url-base
status: merged
merged: 2026-05-31
started: 2026-05-30
target_pr: #192
---

# `buildInviteUrl` — use Vite BASE_URL instead of deriving from window.location.pathname

## Context

When a site administrator clicked "Create invite + copy link" from the org settings drawer, the copied URL pointed at `https://ish-dev-piqc.github.io/?invite=<token>` — a 404 because the GitHub Pages site lives at `/PIQC-dev-v1/`, not at the org root.

Cause: `buildInviteUrl` derived its path from `window.location.pathname` and tried to strip the trailing route segment via regex. The regex assumed the admin was on a sub-route like `/PIQC-dev-v1/dashboard`, where stripping `/dashboard` correctly yields `/PIQC-dev-v1/`. But if the admin was *already* at the configured root `/PIQC-dev-v1/`, the regex over-stripped — turning `/PIQC-dev-v1` into `/` and producing the 404 URL.

Fix: use `import.meta.env.BASE_URL`. Vite always exposes the configured `base` from `vite.config.ts` with a trailing slash, regardless of which route the user happens to be on. One source of truth, no path-stripping heuristics.

## Scope (files allowed)

- `src/lib/orgs/orgsApi.ts` — replace `buildInviteUrl`'s path-derivation logic with `import.meta.env.BASE_URL`. Pure helper; no API change; no caller updates needed.
- `plans/kiara/invite-url-base.md` — this file.

## Out of scope (files forbidden)

- Anything else in `src/lib/orgs/`, `src/components/`, `src/context/`, `supabase/`.

## Architecture layers touched

- [ ] migration
- [ ] RPC
- [ ] adapter
- [ ] context
- [ ] component
- [ ] test
- [x] util (pure helper in orgsApi.ts)

## Mock data plan

None.

## Approved-by

No cross-domain edits. The only file touched (`src/lib/orgs/orgsApi.ts`) is owned by `@ki-dev-piqc` per CODEOWNERS.

## Verification

- `npx tsc --noEmit --skipLibCheck -p tsconfig.app.json` → 0 errors
- In the deployed app (or locally with `npm run dev`):
  - Open org settings drawer as a site administrator
  - Click "Create invite + copy link" from any route (`/PIQC-dev-v1/`, `/PIQC-dev-v1/dashboard`, deeper routes)
  - Paste the copied link — host + path should match the configured base + `?invite=…`
  - Open the URL in incognito → should land on the app root (not 404)
- Existing `buildInviteUrl` smoke test in `orgsApi.test.ts` continues to pass — the test only checks token encoding into the query param, which is unchanged.
