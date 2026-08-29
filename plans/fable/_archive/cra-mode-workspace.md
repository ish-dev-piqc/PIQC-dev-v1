---
owner: fable-dev-piqc
feature: cra-mode-workspace
status: merged
merged: 2026-07-05
started: 2026-07-05
target_pr: #429
---

# CRA/Monitor Mode — PR-B: workspace content

## Context

Handover §6.2 + the CRA two-PR split (PR-A #427 landed the plumbing:
mode, rail icon, entitlement, single tab, gated placeholder). PR-B fills
the placeholder with the real workspace — the first role-lens surface
that is NOT hosted inside Sponsor. It composes pieces that already
exist: the `cra_monitoring_focus` deliverable (#414), the monitoring
prep checklist (#402), the ActionCard/Travel-Bridge rail (#416), and
the what-changed amendment banner (#425, already inside DeliverablePanel).
Zero new tables, zero new RPCs — it consumes existing packets.

## Design

**The architectural move:** `DeliverablePanel` — the generic
fetch/generate/mutate/export orchestrator — was pathed under
`src/components/dashboard/sponsor/deliverables/` when Sponsor was its
only consumer. CRA is the second consumer, so the panel graduates to
its non-mode home `src/components/deliverables/` (both dirs are
Fable-owned). This honors the plan's non-negotiable — "a role lens is a
config over Layer B, never a fork" — and avoids a `cra/` → `sponsor/`
dashboard import (a smell even though CI only lints the site/audit/sotr
trio). The per-artifact section config (`DELIVERABLE_CONFIGS`) extracts
alongside it into `deliverableConfigs.ts` so both surfaces share one
map (the `Record<DeliverableArtifactType,...>` stays exhaustive-typed).

- **Relocation (no behavior change):** `DeliverablePanel.tsx` moves to
  `src/components/deliverables/`; imports rewritten to the shallower
  depth. `DELIVERABLE_CONFIGS` extracted to
  `src/components/deliverables/deliverableConfigs.ts`.
  `ProtocolIntelligenceTab.tsx` (Fable-owned) updates its two imports;
  its behavior is byte-identical.
- **CRA content:** `CraWorkspacePlaceholder.tsx` → renamed
  `CraWorkspaceShell.tsx`. Gate order mirrors the Sponsor tab
  (canUseCraMode → protocol scope → deliverable picker → panel). The
  CRA lens differs from Sponsor by exactly three configs: (1) the
  picker offers the monitor's TWO operational deliverables
  `[cra_monitoring_focus (default), monitoring_prep_checklist]`, not all
  four; (2) amber accent (the rail's CRA color) not purple; (3) a
  monitor register in the copy ("where your limited on-site attention
  goes first"). Same `<DeliverablePanel/>`, same `<ActionCardRail/>`.
- **Dashboard.tsx** (unowned): the one import + JSX tag swap from
  `CraWorkspacePlaceholder` to `CraWorkspaceShell` — 2 lines, mirrors
  the PR-A wiring exactly.

## Scope (files allowed)

- `plans/fable/cra-mode-workspace.md` — this file.
- `src/components/deliverables/DeliverablePanel.tsx` — MOVED here.
- `src/components/deliverables/deliverableConfigs.ts` — NEW (extracted).
- `src/components/deliverables/__tests__/deliverableConfigs.test.ts` — NEW.
- `src/components/dashboard/sponsor/deliverables/DeliverablePanel.tsx` — DELETED (moved).
- `src/components/dashboard/sponsor/deliverables/ProtocolIntelligenceTab.tsx` — imports + config extraction (Fable-owned).
- `src/components/dashboard/cra/CraWorkspaceShell.tsx` — NEW (renamed from placeholder).
- `src/components/dashboard/cra/CraWorkspacePlaceholder.tsx` — DELETED (renamed).
- `src/components/dashboard/cra/craDeliverables.ts` — NEW (pure CRA lens: the deliverable subset).
- `src/components/dashboard/cra/__tests__/craDeliverables.test.ts` — NEW.
- `src/components/dashboard/Dashboard.tsx` — import/tag rename + stale-comment fix (UNOWNED).

## Out of scope (files forbidden)

- `src/lib/deliverables/**`, `src/lib/actions/**` — consumed, never modified.
- Any migration / RPC / table — this PR is frontend composition only.
- `src/context/ModeContext.tsx`, `src/lib/entitlements.ts`, `src/App.tsx`,
  `src/components/dashboard/LeftRail.tsx` — PR-A's plumbing; untouched here
  (no 2-reviewer shared-infra file is in this PR).
- Other mode dirs (`site/`, `audit/`, `sotr/`, VEW).

## Architecture layers touched

- [ ] migration
- [ ] RPC
- [ ] adapter
- [ ] context
- [x] component (relocation + CRA shell)
- [x] test (config invariants + CRA picker subset)

## Mock data plan

None.

## Approved-by

- No non-Fable codeowner approval required. Every substantive file is
  Fable-owned: `src/components/deliverables/` and
  `src/components/dashboard/sponsor/deliverables/` are both
  `@fable-dev-piqc` in `docs/CODEOWNERS.md`.
- `src/components/dashboard/Dashboard.tsx` is UNOWNED; the change is a
  2-line component rename mirroring the PR-A wiring.

## Verification

- [x] typecheck / build green; new config + shell tests pass (9/9); zero
  new full-suite failures vs the same-env baseline (991 pass / 19
  pre-existing / 1010 — exactly +9 over PR-A's 982/19/1001).
- [x] DeliverablePanel relocation is behavior-preserving: git detects the
  move as a rename (only the import block differs); ProtocolIntelligenceTab
  passes identical props; no test imported the old path (verified pre-move).
- [x] Adversarial review (4 verified lenses): 1 confirmed of 2 candidates
  — dark-mode picker-chip contrast (white on pale amber, ~1.9:1). Fixed:
  chip surface decoupled from icon accent → 6.8:1 light / ~8:1 dark.
- [ ] Manual (enterprise sub): CRA rail → workspace renders; protocol
  picker + 2-chip deliverable picker (focus default); Generate drafts
  the monitoring focus; regenerate preserves edits; amendment banner
  shows on seq>1; ActionCard/Travel rail appears when cards exist;
  export disabled for focus, enabled for checklist. Non-enterprise sub
  sees the amber gate card.
- [ ] `piqc-review` clean (mode isolation, no `any`, semantic tokens,
  no supabase in components, append-only — N/A no migration).

## Decisions encoded

1. **Orchestrator graduates to non-mode.** Second consumer is the
   trigger to move DeliverablePanel out of the sponsor path — the exact
   "config over Layer B, never a fork" moment the plan named.
2. **CRA lens = 3 configs, not a fork.** Subset picker + accent + copy;
   identical panel + rail. Divergence at the panel layer would be the
   red flag; there is none.
3. **CRA shows the two operational deliverables.** Risk overview and SIV
   are sponsor-facing; the monitor's surface stays focused on where
   attention goes (focus) and what to prep (checklist).
4. **Rename over in-place.** The file becomes a real shell, so it earns
   the honest name; the 2-line Dashboard import swap is the cost, paid
   to an unowned file.
