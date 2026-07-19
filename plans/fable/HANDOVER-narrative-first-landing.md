# HANDOVER — Narrative-first visit landing: S2+ build-out after Site Mode validation

**Written by:** Fable (concept + S1 builder), 2026-07-19
**For:** an Opus build session with zero prior context. Read this top to bottom, then build.
**Verify tier:** Sonnet re-runs tests + adversarial pass per slice (`workflow_multimodel_routing` — prompt the founder to switch models at each tier boundary).

---

## 1. What exists (do not rebuild)

| Thing | Where |
|---|---|
| Approved design (3 concepts + verdict) | Artifact "narrative-first-concepts" — synthesis: Brief landing + day-in-order sequence + opened rows |
| S1 build (deterministic, PR pending) | branch `sixonelabs-piqc/narrative-first-visit-landing` |
| Pure brief builder | `src/lib/visit-execution/visitBriefModel.ts` (+ 14 tests) |
| Components | `VisitBriefBlock.tsx`, `VisitSequenceBlock.tsx`; `VisitExecutionTab.tsx` recomposed; `VisitSnapshotCard.tsx` gained `hidePurpose` |
| The layout contract | snapshot → brief → divergences → signals → sequence → "Work the visit" (collapsed acting layer, error banner OUTSIDE it, auto-opens on add/promote, re-collapses on visit change) |

S1 is the `templated` provenance rung: zero LLM, zero backend. Every brief line is assembled from already-extracted fields; refs obey the **citation discipline** — a claim carries only the source that supports *that* claim (gate lines cite `condition.source_section/page`, never the item's SoA quote).

## 2. The validation gate (before ANY S2 work)

Run the original validation exercise again with a real coordinator on a parsed protocol:

1. Open a visit cold. Can they say what the visit is for, who attends, what gates the dose, within ~60s — without opening the PDF?
2. Did they open the PDF at any point? For what? (That gap is S2's target list.)
3. Did the collapsed checklist bother them? (If yes → flip the default: `workOpen` initial state in `VisitExecutionTab.tsx`, one line. Do NOT remove the section.)
4. Do the brief's caps (BRIEF_LINE_CAP=3) trim something they needed at the top? (Tune the constant, keep the honest "+N more" line.)

**Decision rule:** if the deterministic brief already closes the critique, S2 may not be worth its risk — tell the founder that instead of building. LLM refine is only justified by validated gaps in *fluency*, not coverage.

## 3. S2 — the gated LLM refine (the only new machinery)

**What:** an optional "Refine with PIQC" pass that rewrites the brief's mechanical lines into flowing prose — WITHOUT changing what is claimed or cited.

**The pattern is already proven twice in this repo. Copy it, don't invent:**
- Edge-function skeleton + JWT-scoped ownership proof: `supabase/functions/isa-report-draft/` (the sibling)
- The verbatim anchor gate: `isa-report-draft/sectionContract.ts` `gateSection()` — every anchor must appear verbatim or the draft is withheld (422)
- Cross-tree parity test: `src/lib/audit/__tests__/isaReportSectionContract.test.ts` — duplicated Deno-side constants asserted equal from vitest; drift fails CI

**S2's gate, precisely (per-sentence cite-or-withhold):**
1. Client sends the deterministic `VisitBriefLine[]` (the truth) to a new edge fn `visit-brief-refine`.
2. Model returns prose where each sentence maps to ≥1 input line key.
3. Server gate: every input line's **claim tokens** (the numbers, thresholds, section refs — extract them mechanically from the line) must appear in the output verbatim; every ref chip re-attaches from the INPUT lines (the model never emits citations); any dropped/altered claim → withhold, return the templated lines unchanged with a `withheld_reason`.
4. Provenance: brief gains a `source` rung `templated → llm` surfaced in the block label ("PIQC drafted · refined"); no DB write — refine is per-render, cache client-side. If the founder wants persistence, that's a migration + the `*_source` column pattern from `20260728000000_audit_mode_isa_report_narrative.sql`.
5. PHI/name rules: protocol text only; no sponsor names in prompts (grep `20260516010000` for the stance).

**Files:** `supabase/functions/visit-brief-refine/` (+ pure `refineContract.ts` unit-tested cross-tree), `visitBriefModel.ts` (claim-token extractor, pure), `VisitBriefBlock.tsx` (refine affordance + withheld honesty line), `visitExecutionApi.ts` or a sibling `visitBriefApi.ts` (Result<T>). Owner @ish-dev-piqc (client) + @roger (supabase/) → Approved-by lines.

## 4. Fine-tune backlog (cheap, judgment-flip items — do only what validation demands)

- `workOpen` default (collapsed ↔ expanded) — 1 line
- Sequence respects role lens? Currently NO by design (reading = full set). If coordinators want it: pass `roleFilter` to `VisitSequenceBlock`, filter — but keep the "All N requirements" honesty count on the header.
- Brief chips → clickable (open TraceabilityDrawer when the ref resolves to an item) — wire `onOpenTraceability` through `VisitBriefBlock`; chips are static addresses today.
- `ExecutionChecklist` rows: inline source quote (concept C's last 20%) — the quote already renders in sequence nodes; only add to rows if users ask.

## 5. Propagating the pattern (audit / sponsor) — LATER, separate arcs

Mode isolation: never import Site Mode components. What propagates is doctrine:
open on a reading → watch-outs visible → acting layer one gesture down → every claim wears its address → caps are honest → templated rung before gated LLM rung.
Audit Mode's ISA surfaces already follow it (protocol-citation bridge, report anchor gate). A sponsor-facing brief would re-derive over sponsor-side data. Each is its own feature-intake.

## 6. Build mechanics (non-negotiables)

- Worktree off `origin/main`; plan MD per slice, pushed BEFORE building; Approved-by for VEW files (@ish-dev-piqc).
- `node_modules` symlink into the worktree; `node_modules/.bin/tsc --noEmit -p tsconfig.app.json` (bare `tsc --noEmit` is a NO-OP); vitest suites under `src/lib/visit-execution`.
- Semantic Tailwind tokens only; `Result<T>` in API layers; no `any` in `src/lib/**`; migrations append-only.
- PR body format: What this is / the objects / doctrine / verification / review notes; browser pass = dev-team lane post-merge.
