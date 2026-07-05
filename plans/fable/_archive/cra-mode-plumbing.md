---
owner: fable-dev-piqc
feature: cra-mode-plumbing
status: merged
merged: 2026-07-05
started: 2026-07-05
target_pr: #427
---

# CRA/Monitor Mode — PR-A: plumbing (content-free)

## Context

Handover §6.2: monitors get their own workspace — a per-visit working
rhythm, not a sponsor sub-tab. This is PR-A of the planned two-PR split
(approved plan risk R3): the mode EXISTS after this PR — rail icon,
mode value, tab, entitlement gate, placeholder surface — but carries no
content. Keeping it content-free is what makes the 2-reviewer
shared-file review cheap. PR-B (all Fable-owned) replaces the
placeholder's internals with the CraWorkspaceShell hosting the
Monitoring Focus deliverable + checklist + ActionCard rail + amendment
banner — zero new tables or RPCs, it consumes existing packets.

## Design

- `DashboardMode` gains `'cra'`; localStorage rehydration accepts it
  (`piq-mode-v1` guard extended — unknown values still fall back to
  'site').
- `DashboardTab` gains `'cra-workspace'` (single tab v1); CRA tab-sets
  added beside SITE/AUDIT in LeftRail, Dashboard, and App;
  `VALID_DASHBOARD_TABS` extended.
- LeftRail: `RailKey` += 'cra'; ITEMS entry between Audit and Sponsor
  (label 'CRA mode', lucide `UserCheck`); PALETTE gains a distinct amber
  accent; `activeKey` recognizes the CRA tab/mode; `handleClick`
  mirrors the site/audit arms (setMode + navigate).
- Dashboard: `CRA_TABS` TabConfig (one entry, 'Monitoring Workspace');
  `mode === 'cra'` renders the placeholder surface; the tabs ternary and
  mode-fallback logic extended the same way audit's are.
- `canUseCraMode(subscription)` in entitlements.ts — enterprise tier,
  byte-parallel to `canUseSponsorMode` (the CRA workspace consumes the
  same enterprise-gated protocol intelligence). NEW
  `src/lib/__tests__/entitlements.test.ts` covers BOTH gates (the file
  had no tests; the 2-reviewer change ships with proof).
- NEW `src/components/dashboard/cra/CraWorkspacePlaceholder.tsx`
  (Fable-owned dir): entitlement gate first (calm enterprise card, the
  ProtocolIntelligenceTab pattern), then a draft-vocabulary "workspace
  lands in the next release" card naming what will live here. PR-B
  touches ONLY this directory.

## Scope (files allowed)

- `plans/fable/cra-mode-plumbing.md` — this file.
- `src/context/ModeContext.tsx` — union + storage guard (2-reviewer).
- `src/lib/entitlements.ts` — canUseCraMode (2-reviewer).
- `src/lib/__tests__/entitlements.test.ts` — NEW.
- `src/components/dashboard/LeftRail.tsx` — rail wiring.
- `src/components/dashboard/Dashboard.tsx` — tab + shell branch.
- `src/App.tsx` — tab sets + rail case.
- `src/components/dashboard/cra/CraWorkspacePlaceholder.tsx` — NEW.

## Out of scope (files forbidden)

- Everything the placeholder will eventually host: `src/lib/deliverables/**`,
  `src/lib/actions/**`, `src/components/deliverables/**`, sponsor dirs —
  PR-B territory.
- All mode content dirs (`site/`, `audit/`, `sotr/`, VEW).
- `src/context/` beyond ModeContext; supabase/**; migrations (none —
  this PR is frontend-only).

## Architecture layers touched

- [ ] migration
- [ ] RPC
- [ ] adapter
- [x] context (ModeContext union — 2-reviewer)
- [x] component (rail, dashboard branch, placeholder)
- [x] test (entitlements gates)

## Mock data plan

None.

## Approved-by

- Ishika + Kiara (`@ish-dev-piqc @ki-dev-piqc`) — `src/context/ModeContext.tsx`
  and `src/lib/entitlements.ts` (2-reviewer shared infra; diffs kept
  minimal and content-free by design).
- `LeftRail.tsx` / `Dashboard.tsx` / `App.tsx` are unowned in
  CODEOWNERS; changes mirror the existing site/audit arms exactly.

## Verification

- [x] typecheck / build green; entitlements tests 9/9 (both gates
  matrix-pinned); zero new full-suite failures vs baseline (1001 total).
- [ ] Manual: CRA rail icon renders with its own accent; click → mode
  'cra', placeholder surface with enterprise gate; mode survives reload
  (localStorage); switching back to site/audit unaffected; sponsor tab
  unaffected; non-enterprise sub sees the gate card.
- [x] Diff review: 81 insertions / 5 deletions across the five shared
  files — the deletions are the four single-line rewrites the new arms
  required (union lines, storage guard, tabs ternary, lucide import).
- [x] `piqc-review` clean.

## Decisions encoded

1. **Two-PR split** (approved plan R3): plumbing reviewed on shape,
   content reviewed on substance — never both at once in 2-reviewer
   files.
2. **Enterprise gate, surface-level** — rail icon always visible (the
   sponsor precedent), the surface gates. `canUseCraMode` is separate
   from `canUseSponsorMode` even though both check enterprise today:
   entitlements are product levers; coupling them couples future
   pricing.
3. **Single 'cra-workspace' tab v1** — the mode earns more tabs when
   PR-B's content demands them, not before.
4. **Placeholder names its future** — it lists what PR-B brings
   (monitoring focus, checklist, travel card, amendment banner) so the
   review of PR-A ratifies the plan for PR-B.
