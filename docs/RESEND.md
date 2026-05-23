# Resend — setup and usage

Transactional email sender for PIQC edge functions. Today it powers the landing-page contact form ([supabase/functions/contact/index.ts](../supabase/functions/contact/index.ts)). Next planned consumer is org-invite emails ([plans/ishika/_archive/orgs-admin-ui-and-invites.md](../plans/ishika/_archive/orgs-admin-ui-and-invites.md)).

The Resend API key is a server-side secret. It never reaches the browser — `.env.example` does **not** list it; do not add `VITE_RESEND_*` anywhere.

## Code pattern

Every edge function that sends email goes through the shared helper at [supabase/functions/_shared/resend.ts](../supabase/functions/_shared/resend.ts):

```ts
import { sendResendEmail } from "../_shared/resend.ts";

const result = await sendResendEmail(
  {
    to: "recipient@example.com",
    from: "PIQClinical <hello@updates.piqclinical.com>",
    replyTo: userEmail,
    subject: "…",
    text: "…",
  },
  { requestId, logPrefix: "myfeature" },
);
if (!result.ok) {
  // best-effort: persist the row regardless; log and move on
}
```

The helper reads `RESEND_API_KEY` from `Deno.env`. Log events are namespaced by `logPrefix` — `myfeature.resend.missing_key`, `myfeature.resend.error`, `myfeature.resend.fetch_failed`. Pick a stable prefix so logs stay grep-able.

## Production setup

### 1. Verify the sending domain (one-time, per environment)

PIQC sends from `updates.piqclinical.com` — a subdomain dedicated to product emails so reputation stays isolated from the apex `piqclinical.com`. Each environment that sends real email needs the domain verified in its Resend account.

1. Resend dashboard → **Domains** → **Add Domain** → `updates.piqclinical.com`
2. Resend shows two required DNS records (exact values are dashboard-specific — copy them):
   - **SPF** — `TXT` at `updates.piqclinical.com` (or root, depending on Resend's instructions) → `v=spf1 include:resend.com -all`
   - **DKIM** — `TXT` at `resend._domainkey.updates.piqclinical.com` → the public key Resend generates
3. Add both records at the DNS provider for `piqclinical.com`
4. Optional but recommended: **DMARC** — `TXT` at `_dmarc.updates.piqclinical.com` → `v=DMARC1; p=none; rua=mailto:ishika@piqclinical.com`
5. Resend auto-verifies once records propagate (usually minutes; up to a 72-hour window before status flips to `failed`)

### 2. Set the API key as a Supabase secret

The edge function reads `RESEND_API_KEY` from the Supabase function environment, not from `.env.local`. Set it via the CLI:

```sh
supabase secrets set RESEND_API_KEY=re_…
```

Verify:

```sh
supabase secrets list
```

The value is redacted in the output but the key name should appear.

## Local dev — MCP server

Project root `.mcp.json` wires Resend's official MCP server (`resend-mcp`) so Claude can list domains, check verification status, and send test emails from inside the IDE.

### One-time per developer

Export the same `RESEND_API_KEY` value in your shell rc (`~/.zshrc` or `~/.bashrc`):

```sh
export RESEND_API_KEY=re_…
```

`.mcp.json` reads it via `${RESEND_API_KEY}` interpolation — the key is never committed. Restart Claude Code in this repo; the MCP server auto-loads at session start.

### Smoke test

Ask Claude:
- "list my Resend domains via the resend mcp" → confirms the MCP is wired
- "what DNS records does updates.piqclinical.com need on Resend" → returns the exact SPF + DKIM values to add at the registrar
- "check the verification status of updates.piqclinical.com" → useful while waiting for DNS propagation

The MCP also exposes tools to send/list/cancel emails, manage contacts and broadcasts, and manage templates — see [github.com/resend/mcp-send-email](https://github.com/resend/mcp-send-email) for the full surface.

## Adding a new email-sending consumer

Checklist:

1. Import `sendResendEmail` from `../_shared/resend.ts` (do not call `fetch("https://api.resend.com/emails", …)` directly)
2. Pick a stable `logPrefix` matching your feature (`contact`, `invite`, `cert-alert`, …) so log events are grep-able
3. Decide the FROM address:
   - Default to `<feature>@updates.piqclinical.com` to keep sending reputation per-feature
   - Anything new requires the address to be deliverable from a verified domain — `updates.piqclinical.com` covers any local part, no extra DNS needed
4. Best-effort send pattern: persist the DB row first, then send. If the email fails, log it and return success to the user — never block the user on a transient mail failure
5. Add the new function to the table at the top of this doc

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `contact.resend.missing_key` in logs | `RESEND_API_KEY` not set as a Supabase secret | `supabase secrets set RESEND_API_KEY=…` |
| `contact.resend.error` with status 403 and "domain not verified" | DNS records not yet propagated, or wrong domain in `RESEND_FROM` | Verify domain via Resend MCP / dashboard; confirm DNS records are live |
| `contact.resend.fetch_failed` | Network error reaching api.resend.com | Resend status page; retry — best-effort means the DB row is safe regardless |
| MCP shows no domains | `RESEND_API_KEY` not exported in shell, or shell rc not sourced before opening Claude | `export RESEND_API_KEY=…`; restart Claude Code session |
