---
owner: ki-dev-piqc
feature: chrome-icons-and-hamburger
status: merged
merged: 2026-06-14
started: 2026-06-13
target_pr: #361
---

# Chrome polish — chat icon swap + collapsible hamburger

## Context

Two user-reported confusions:

1. **Chat icon collides with Ask bubble.** Both the LeftRail Chat icon
   and the AskBubble (PIQClinical assistant) used a speech-bubble
   glyph (`MessageCircle` and `MessageSquare`). Users couldn't tell
   them apart at a glance — different surfaces, same metaphor.
2. **Hamburger menu is too flat.** Settings/Organization/Appearance
   are flat sections of buttons; with more controls coming it gets
   unwieldy. Better to collapse Settings + Appearance into
   click-to-expand groups, with Organization promoted to a top-level
   entry (it's a destination page, not a settings sub-tab).

Note: a **Workspace icon already exists** on the LeftRail
(`LayoutGrid`, line 62). It's hidden when the rail is below
breakpoint — the v2 breakpoint PR ships that fix.

## Design

### Chat icon

Swap `MessageCircle` → `Hash` (`#`) everywhere the LeftRail Chat
icon renders. The chat overlay is channel-based (#general,
#protocol-code), so `Hash` is the correct metaphor. AskBubble keeps
its bubble glyph for the assistant. The same swap goes into the
mobile hamburger's Workspace section so the two stay in sync.

### Menu restructure (mobile hamburger + desktop user dropdown)

Both the mobile hamburger and the desktop user-avatar dropdown
adopt the same collapsible pattern, driven by shared in-memory state
(`settingsExpanded`, `appearanceExpanded`). Open one → expand
Settings → open the other → it's already expanded. Reasonable
behavior given the user already chose to expand it.

Sections:

```
Workspace          (flat — modes are direct nav)
  Workspace home
  Site mode
  Audit mode
  Sponsor mode (soon)
  Chat

Organization       (top-level entry, opens the org page)

Settings           [▸] (click to expand)
  Account
  Billing

Appearance         [▸] (click to expand)
  Switch to Dark / Light
  Heatmap layer (on/off)
  Demo mode (on/off — if entitled)

Sign Out           (separated)
```

Expanded state per category persists across re-opens within the
same session (in-memory only — not localStorage). Collapsed state
keeps the chevron pointing right (`▸`); expanded points down (`▾`).

Also fixes a latent React warning: `LeftRail` mapped items with
`<>` fragments and the `key` on the inner button. Keys on Fragment
require the long form `<Fragment key={...}>`. Switched to that. No
visible behavior change — just removes the warning.

**Plus the actual reason the Workspace icon wasn't visible:** the
LeftRail's `py-3` padding meant its first item sat at y=12, fully
under the fixed `h-16` navbar (which overlays the first 64px of the
viewport via `fixed top-0 z-50`). Dashboard's body already clears
the navbar with `pt-16`; the rail didn't. Changed `py-3` →
`pt-20 pb-3` so the rail starts at y=80 — 16px below the navbar.

## Scope (files allowed)

### New

- `plans/kiara/chrome-icons-and-hamburger.md` — this file.

### Modified

- `src/components/dashboard/LeftRail.tsx` — `MessageCircle` →
  `Hash` (Chat icon); switch map fragment to keyed `Fragment`.
- `src/components/Navbar.tsx` — `MessageCircle` → `Hash` (mobile
  workspace section); restructure Settings / Appearance into
  collapsible groups in **both** the mobile hamburger and the
  desktop user dropdown (shared expansion state); promote
  Organization to its own top-level entry in both menus.

## Architecture layers touched

- [x] component

## Mock data plan

None.

## Approved-by

Self (Site Mode / shared chrome).

## Verification

- `npx tsc --noEmit --skipLibCheck -p tsconfig.app.json` → 0 errors
- Manual:
  - LeftRail Chat icon renders as `#` symbol, not a bubble. AskBubble
    keeps its bubble.
  - LeftRail shows all five icons: Workspace · Site · Audit · Sponsor · Chat.
  - **Mobile hamburger**: open → Workspace (flat), Organization
    (single button), Settings ▸, Appearance ▸. Click Settings →
    expands to Account + Billing.
  - **Desktop user dropdown**: open → Organization (single button),
    Settings ▸, Appearance ▸. Same expand/collapse behavior.
  - Expanding Settings in mobile then opening desktop dropdown →
    desktop shows Settings already expanded (shared state).
  - Sign Out at the bottom of both menus.

## Mechanical checks

- No new color classes.
- No `: any` in `src/lib/**` — no lib edits.
- Plan MD referenced above.
