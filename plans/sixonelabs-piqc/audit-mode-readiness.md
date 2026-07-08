---
owner: sixonelabs-piqc
feature: audit-mode-readiness
status: active
started: 2026-07-08
---

# Audit Mode Readiness — vendor-product regression fixes from the ISA generalization

## Context

The ISA (Investigator Site Audit) foundation merged (#404) and generalized Audit Mode
from vendor-only to two-workflow. A 5-lens adversarial review (blind-verified) found the
generalization dragged **regressions into the already-shipped vendor product**, not just
left ISA incomplete. This feature fixes the 5 "fix-now" items:

1. **Chat edge-fn won't boot (BLOCKER).** `audit-mode-chat` extended `VALID_VIEWED_STAGES`
   with the 7 `ISA_*` stages but `STAGE_FOCUS_HINTS` still has only the 8 vendor stages.
   The module-top drift guard `throw`s on cold-start, so the function never registers
   `Deno.serve` — the next redeploy bricks PIQC chat for **vendor + ISA both**.
2. **Swallowed audit-list error (HIGH).** `AuditContext` sets `error` on a failed audits
   SELECT but no component reads it → a transient DB failure renders "No audits yet" and
   the `activeId` eviction effect drops a returning auditor out of their open audit.
3. **REPORT_DRAFTING dispatch skips the workflow key (MEDIUM→LOW).** The Stage-7 special
   case in `AuditWorkspaceShell` isn't `workflow_type`-gated, so switching to an ISA audit
   on Stage 7 flashes the vendor editor and fires a vendor-only RPC against the ISA id.
4. **List APIs swallow DB errors as `[]` (MEDIUM).** `listVendors` / `listSites` /
   `listAuditorProtocolLibrary` `console.error` + `return []`, so a failed fetch is
   indistinguishable from a legitimately empty list in the New-Audit drawer.
5. **createAudit discards the RPC's specific message (LOW).** `createAudit` `console.error`
   + `return null`, dropping the Postgres RPC's specific reason ("Protocol version % not
   found" etc.); the drawer shows a flat "Audit creation failed."

## Scope

- `supabase/functions/audit-mode-chat/index.ts`
- `src/context/AuditContext.tsx`
- `src/components/dashboard/audit/AuditRequiredGate.tsx`
- `src/components/dashboard/audit/AuditWorkspaceShell.tsx`
- `src/lib/audit/auditCreationApi.ts`
- `src/components/dashboard/audit/onboarding/NewAuditDrawer.tsx`
- `src/lib/audit/__tests__/auditCreationApi.test.ts`
- `src/components/dashboard/audit/onboarding/__tests__/NewAuditDrawer.test.tsx`
- `src/components/dashboard/audit/__tests__/AuditRequiredGate.test.tsx`

## Out of scope

- ISA-aware chat context (join `sites`, workflow-branch the system prompt) — deferred #6.
- The dangling "·" separator on empty `protocol_code`.
- A `UNIQUE` index on `sites`.
- ISA stages 2–7 placeholders and an ISA audit parked at `ISA_SITE_INTAKE` — these are
  **intentional scaffold**, not defects. Leave them.
- `supabase/migrations/**` — no schema change; the ISA migrations are already merged
  (`20260705000000`, `20260709000000/000100`, `20260719000000`, `20260721000100`).

## Architecture layers touched

`{ edge-function, context, component, api, test }`. No migration → no DB→types mirror.

## Mock data plan

None.

## Approved-by

- Karl — `src/lib/audit/**`, `src/components/dashboard/audit/**`
- Roger — `supabase/functions/**`
- +2 reviewers — `src/context/AuditContext.tsx` (shared infra)

(Cross-owner edits; review-tags required on the PR per CODEOWNERS.)

## The five fixes (exact sites)

**#1** — `audit-mode-chat/index.ts`: add the 7 `ISA_*` keys to `STAGE_FOCUS_HINTS` with
one-line auditee-neutral cues. Do **not** relax the drift guard — parity is the invariant.
Only makes the function boot; ISA chat stays vendor-framed (deferred #6).

**#2** — `AuditContext.tsx:186-190`: guard the `activeId` eviction with `&& !error`.
`AuditRequiredGate.tsx`: destructure `error` from `useAudit()`; render an error+**Retry**
state (Retry calls `refresh()`) **before** the `audits.length === 0` empty state.

**#3** — `AuditWorkspaceShell.tsx:389`: change `if (viewedStage === 'REPORT_DRAFTING')` →
`if (activeAudit.workflow_type === 'VENDOR_AUDIT' && viewedStage === 'REPORT_DRAFTING')`.

**#4** — `auditCreationApi.ts`: move `listVendors` / `listSites` /
`listAuditorProtocolLibrary` to an audit-local `Result<T> = { ok: true; data: T } | { ok:
false; error: string }` (mode isolation forbids importing Site's). Update the sole caller
(`NewAuditDrawer` bootstrap) to render a **load-failed** picker state distinct from empty.

**#5** — `auditCreationApi.ts:createAudit`: return the RPC error through `Result<T>`;
`NewAuditDrawer` surfaces `result.error` instead of the flat "Audit creation failed."

## Verification

- **#1:** `deno check` boots without throw; POST a chat request on a vendor AND an ISA
  audit → 2xx (ISA context still vendor-framed = known-deferred).
- **#2:** simulate a failed audits SELECT → gate shows error+Retry, NOT "No audits yet"; a
  returning auditor with a persisted `activeId` is NOT evicted; Retry recovers.
- **#3:** vendor audit on Stage 7, switch to an ISA audit → no vendor-editor flash, no
  `audit_mode_prefill_report_draft` call against the ISA id.
- **#4:** force `listSites` to error → site picker shows load-failed (retry), not empty;
  grep confirms no caller treats the return as a bare array.
- **#5:** submit a vendor audit with a stale protocol version → drawer shows the RPC's
  specific message.
- **Gate:** `/piqc-review` clean (scope, ownership, arch, mocks, tokens, dead-code, PHI).
- **Ops caveat (not a code fix):** redeploy `audit-mode-chat` only **after** #1 merges —
  redeploying the current code bricks chat.
