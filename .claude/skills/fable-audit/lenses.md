# Lenses — Fable reviews the Opus build (Design/UX + Code correctness first)

Each cell reviews Opus-built code and answers, per its lens: **would Fable build and approve
this?** Approve generously — if the code meets the bar, leave it, even if Fable would have
written it a little differently. File an **upgrade** only for a real gap Fable wouldn't ship,
and make the upgrade serve the product goal, not personal style. Taste-only differences are
approvals, not findings.

These lenses apply at **both altitudes** — both run in Phase 2 (Phase 1 is triage). The **macro**
pass (one reviewer per surface) looks through them at the *workflow* level (does the flow cohere?
is the system sound? does the journey teach a first-time user? is clinical integrity preserved
across the flow?). The **micro** fan-out (one reviewer per cell) looks through them at the *line*
level. Same bar, two zoom levels.

The pass feeds the audit decision — **Approve / Approve with upgrades / Block**. Findings become
the apply set that `/fable-apply` lands only after a human approval record; the audit itself never
edits. Each finding still reads like a refactor (*here's the gap → here's the concrete
`smallest_safe_fix`*). Weight the budget accordingly:

- **PRIMARY lenses (most findings, most budget):** Design + UX, Code correctness. These drive
  the pass — polish and quality upgrades of the Opus-built Audit / Sponsor / Deliverables work.
- **GUARDRAIL lenses (higher severity bar, fewer findings):** Architecture, Clinical integrity.
  Run these to catch **red-lines only** — things a refactor must not break. Don't pad the report
  with architecture nits or restate CLAUDE.md rules; surface a guardrail finding only when a
  real line is crossed.

Each lens **applies the methodology of an existing skill** — reviewers have `Read/Glob/Grep` only
and **cannot call other skills**; the "Apply the methodology of" lines below name the doctrine,
and the bullets inline what each lens actually needs. (`piqc-architect` is a plain file a reviewer
MAY `Read` at `~/.claude/skills/piqc-architect/SKILL.md`; the plugin skills are not readable
paths.) Obey `findings-schema.md` (structured output, per-cell cap, drop nits) and never report
anything on the CI-gate exclusion list in `surfaces.md`.

---

## PRIMARY · Lens 1 — Design + UX

**Apply the methodology of** `design:design-critique` (hierarchy, consistency, usability),
`design:accessibility-review` (WCAG 2.1 AA), `design:design-system` (token/naming drift), and
`design:ux-copy` (microcopy, empty/error states, CTAs) — you cannot call these skills; the checks
below are the operative rubric.

**PIQC-specific checks:**
- **Semantic tokens & consistency** — text uses `text-fg-heading | -body | -sub | -muted | -label`.
  (Raw `text-gray/slate/zinc/neutral` is CI-caught — skip; flag *hardcoded hex/rgb*, one-off
  spacing, and inconsistent component styling the CI regex misses.)
- **Drawer / overlay parity** — drawers use `useOverlay` + `useSwipeDismiss` like
  `src/components/sotr/SourceTruthDrawer.tsx`. Flag bespoke overlay/dismiss code to
  refactor onto the shared hooks.
- **State completeness** — every data surface has empty / loading / error states, and teaches a
  first-time user what each element means (VEW completeness doctrine).
- **Cognitive load** — collapse duplication; inherit/derive/pre-populate instead of making the
  human re-type derivable data. Flag redundant inputs. Trim noise, **not** signal — never remove
  genuine compliance information to look cleaner.
- **Visual hierarchy & rhythm** — spacing scale, alignment, heading levels, information density.
  These are the bread-and-butter of the refactoring pass.
- **Voice / attribution** — "PIQC drafted / flagged / found" is product-bearing; flag if missing,
  never flag it *as* verbosity to strip.

---

## PRIMARY · Lens 2 — Code correctness & quality

**Apply the methodology of** `engineering:code-review` (bugs, edge cases, error handling, races)
— you cannot call it; the checks below are the operative rubric.

**PIQC-specific checks:**
- **`Result<T>` discipline** — `src/lib/*/*Api.ts` returns `Result<T> = {ok:true,data} |
  {ok:false,error}` (canonical: `src/lib/audit/auditApi.ts`). Flag `throw` outside programmer-error
  guards, and callers that ignore the `ok:false` branch.
- **Data-flow direction** — components consume hooks and never fetch; adapters are pure mappers.
  (Supabase-in-component / supabase-in-adapter are CI-caught — skip those exact greps; flag *logic*
  that mislayers or fetches indirectly.)
- **Realtime correctness** — missed unsubscribes, duplicate channels, stale cache after realtime.
- **Async / race** — promise handling, unguarded `await` in loops, optimistic-update rollback.
- **Readability refactors** — duplicated blocks to extract, dead branches, over-long components to
  split, unclear names, magic numbers. Core review material, not just bug-hunting.
- **Type honesty** — (`any` in `src/lib` is CI-caught — skip) flag `as` casts that lie, `!` on
  nullable data, and `src/types/*` shapes that drift from the RPC.

---

## GUARDRAIL · Lens 3 — Architecture (red-lines only)

**Apply the methodology of** the skeptical principal-architect pass (you MAY
`Read ~/.claude/skills/piqc-architect/SKILL.md`) and `engineering:tech-debt` prioritization.

Report a finding **only** when a refactor would cross an architectural line:
- **Mode isolation for the NEW modes** — Sponsor / Deliverables / CRA importing from
  Audit / Site / SOTR or vice-versa (CI only checks site/audit/sotr, so these new modes are the
  real target). This is the top guardrail hit.
- **Context isolation** — a mode importing another mode's context.
- **Structural dead code / overengineering** — whole unused files/exports, single-caller
  abstractions, config sprawl (`deliverableConfigs.ts`), bypassed gates (`canUseSponsorMode`
  declared but not enforced). Prefer flagging *structural* debt; leave line-level nits to the
  correctness lens.

Do **not** file architecture findings for style preferences or things already fine.

---

## GUARDRAIL · Lens 4 — Clinical integrity (red-lines only)

**Apply the methodology of** the clinical-trial architect framing (you MAY
`Read ~/.claude/skills/piqc-architect/SKILL.md`).

Non-negotiable lines a refactor must never break — file only when one is crossed, always
`blocker` or `high`:
- **No new mocks** — only a `piq-*-v1` localStorage toggle **default-off** is allowed (pattern:
  `src/context/SiteDataContext.tsx`). Default-on mock data on a clinical surface, or `mock/fixture/
  seed` refs outside `__tests__/`, are `blocker`.
- **PHI / PII** — no real participant data, MRNs, DOBs, real protocol PDFs, or sponsor-identifying
  data committed or logged.
- **Provenance / ALCOA** — generated content stays Attributable/Legible/Contemporaneous/Original/
  Accurate: origin badge + review state + timestamp. Advisory-only, earned write-back — flag any
  silent auto-write to the record.
- **Protocol completeness** — flag anything that could drop a protocol-mandated requirement
  (missing > extra).
- **No sponsor branding** in PIQC-generated artifacts (added externally on export).

---

## Cross-lens rule

File each underlying issue **once**, under the most severe applicable lens. A mode-isolation
import that's also a design smell is one architecture (guardrail) finding, not two.
