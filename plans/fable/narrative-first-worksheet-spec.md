# FABLE SPEC — narrative-first: the complete study worksheet

status: spec (OUTPUT of the Fable pass; input to the Opus build)
brief: `plans/fable/narrative-first-BRIEF.md` (this branch)
branch: `fable/narrative-first` (proving ground, cut from main `0b93bb5`). NOT a merge target.
author: Fable (claude-fable-5), 2026-07-18
grounding: brief §2 re-verified firsthand against `soaGridParser.ts`, `ingestPipeline.ts`,
`cohortExtraction.ts`, `ExecutionChecklist.tsx`, `TraceabilityDrawer.tsx`, `VisitNavigator.tsx`,
`ProtocolTab.tsx`, `WorksheetItemRow.tsx`, `types/visit-execution/index.ts`. Every file:line in this
spec was read, not inherited.

---

## 0. Verdict up front

**The brief's economics are right and, if anything, understated.** This is a recovery job — and
while re-verifying it I found a **second live defect the brief missed**: `normLabel`
(`soaGridParser.ts:1070-1072`) strips parentheticals, so "Pregnancy test (serum)" and "Pregnancy
test (urine)" collide into one key *today*, before any widening. Combined with the global
first-wins map, today's "exact" matcher is neither exact nor safe. Two compounding defects, both
fixable in one small function.

I also found the flagship is **cheaper than the brief prices it**: both sides of a window
comparison are *already parsed into integers today* — the grid header parser extracts ±N days
(`soaGridParser.ts:286-294`) and the LLM schema requires `window_minus/plus_days` per visit
(`ingestPipeline.ts:495-503`). The first divergence class is a numeric comparison of fields that
already exist, not a new detector.

The three calls that shape everything below:

1. **Do not widen the join. Narrow it, then make its failures visible.** The brief's candidate
   (reuse cohort token/alias matching) transfers the wrong half of the cohort pattern — see §5.4.
   The right move is per-visit scoping + invariant-hoisting + a uniqueness gate, with every
   non-bind surfaced by the reconcile signal instead of recovered by fuzzier matching.
2. **The worksheet's governing mechanic is "rows advertise depth; cells advertise exceptions."**
   That single rule resolves the context-bloat / completeness / poke-the-bubble tension — §5.6.
3. **Divergence ships second, by dependency, not by preference.** A comparison between two readings
   is only as trustworthy as the join that pairs them. Today's join would manufacture false
   divergences out of its own binding errors. Fix the join → the flagship becomes safe.

If forced to ship exactly one thing: the narrative-recovery slice (§7). It is the load-bearing
prerequisite of everything else, including the flagship.

---

## 1. (§5.1) The narrative ontology — five buckets, keyed to coordinator decisions

The brief asked for ~4 buckets that map to real decisions, not a 24-bucket taxonomy. I land on
**five, each keyed to a distinct question the coordinator is answering**, and — this is the design
move — **visibility defaults are assigned per bucket, not per field.** One auditable rule instead
of twenty per-field judgments.

| Bucket | Question it answers | Fields (all already in schema) | Visibility default |
|---|---|---|---|
| **ORIENT** | *Why does this visit exist?* | `visit_purpose` (`ingestPipeline.ts:513`) | Visit-header lede, always visible |
| **GATE** | *Do I do this at all, for this participant?* | `conditions[]` (`:575-589`), cohort scope (`applies_to`) | **Always visible at rest** — never behind a poke |
| **CLOCK** | *When, in what window, in what order?* | `timing` (`:590-602`), visit `window_minus/plus_days`, `study_day` | **Always visible at rest** — never behind a poke |
| **ACT** | *What exactly am I doing / recording?* | `description` (`:533-536`), `source_fields[]` (`:603-622`), `role_hint` | One line at rest; full text on poke |
| **TRACE** | *Where is this written, verbatim?* | `source_quote`, `protocol_section`/`page`, `cross_references[]` (`:633-646`), footnote slot | Poke-only (the existing TraceabilityDrawer) |

Rationale for the one asymmetry: GATE and CLOCK change *what the coordinator does or when* —
hiding them creates deviations. ACT and TRACE explain and evidence — hiding them creates clicks.
A click is recoverable; a deviation is not. That is the whole tiering argument.

**v1 vs deferred:**
- **v1 populates all five buckets** — every field above already exists end-to-end
  (`VisitExecutionItem`, `types/visit-execution/index.ts:342-382`; rendered zones in
  `ExecutionChecklist.tsx:356,406-484`; TRACE home in `TraceabilityDrawer.tsx:114-167`). The gap is
  population (brief §2c confirmed).
- **Deferred, slot reserved:** footnote caveat (a sixth entry inside TRACE, later promoted into
  GATE when a footnote is conditional). The ontology names the slot now so the footnote arc slots
  in without re-design; `FootnotesDrawer` remains its display-only home until then.
- **Deferred:** frequency semantics ("every 4 weeks") — no parser exists, and its only consumer
  would be divergence class D5, which I defer (§5.5).

**Trade I considered and rejected:** a "SAFETY" bucket (safety-critical classification promoted to
its own tier). Rejected because `classification` already renders as a badge
(`ExecutionChecklist.tsx:334`) and a sixth bucket adds taxonomy without adding a decision — the
classification badge answers "how careful must I be," which is orthogonal to the five questions.

---

## 2. (§5.2 under §5.6) The complete worksheet flow — the physics frame made concrete

### 2.1 The two-layer contract, accepted and hardened

I **accept the brief's reduction** — *presentation of the requirement set may adapt; membership may
not* — and harden it from a policy into a mechanical property Opus can enforce:

> **The render-set invariant.** The worksheet renders the full `visit_requirements` row set for the
> visit. Adaptive operations are order, grouping, collapse, and decoration. **There is no filter on
> membership anywhere in the render path.** The completeness strip (§2.4) derives its numerator and
> denominator from that same set, so the surface's completeness claim and its render are the same
> data — they cannot disagree.

This is checkable in review (no `.filter()` on the item array between adapter and render, except
the existing cohort *view* filter — see the honest caveat below) and testable (rendered row count
=== fetched row count).

Honest caveat: `CohortFilterBar` (`VisitNavigator.tsx`) already filters the *visit list* by cohort.
That is membership-legal — cohort scope is part of the protocol's own membership rule for a
participant (`applies_to` is grid truth, not preference) — but the spec must say it out loud: **the
only legal membership operation is one the protocol itself states.** User preference may never be
one.

### 2.2 The coexistence model: map ↔ chapter

The brief asked how the preserved SoA view and the narrative flow coexist as complementary views of
one truth. Proposal — and it is mostly *wiring*, not new surface:

- **The SoA visualization is the map.** Concretely, today: the "Schedule of events" section of
  `ProtocolTab.tsx` (site mode, `:118-240` — the thing the validators saw after upload) and the
  schedule entries in SOTR. Whole study, across time, structure-authoritative. Untouched in
  membership and mark truth (spine #3, #4).
- **The worksheet is the chapter.** One visit deep — the VEW workspace (`VisitExecutionTab` +
  `VisitNavigator` as the chapter list). Narrative-led, execution-ordered.
- **Two moves connect them.** *Zoom in:* each visit row in the ProtocolTab schedule section gets an
  "Open worksheet →" affordance landing on that visit in VEW. *Zoom out:* the VEW visit header
  shows the visit's grid coordinate ("Day 14 · ±3d") linking back to the schedule section. The map
  orients; the chapter executes; each names the other.

Trade space: I considered a true side-by-side (grid pane + narrative pane). Rejected for v1 — it
doubles visual density (the exact bloat the founder flagged), and the two-move model gets the same
navigational value with zero new layout. Side-by-side remains available later for wide screens if
validation asks for it.

### 2.3 Anatomy of the chapter — what carries the eye, in order

1. **The lede (ORIENT).** `VisitSnapshotCard` already reserves a purpose field
   (`VisitSnapshot`, `types/visit-execution/index.ts:389-394`). Recovery makes it the protocol's
   *own* stated purpose instead of a regenerated summary — the eye's first stop: *why you're here
   today*, with a TRACE chip. (Note: this is a litmus **upgrade** — today's regenerated purpose is
   an LLM summary without a quote; the recovered one is the extract with provenance. §6.)
2. **The requirement rows, execution-ordered.** The checklist is *already* workflow-ordered by
   `phase` (`pre_visit → check_in → assessment → dosing → post_dose → safety_ae_conmed →
   close_out`, schema `:537-553`). This is the founder's "unlock the physics" already half-built:
   the adaptive re-ordering is deterministic, derived from extracted data, and protocol-order is
   the fallback when phase is null. Do not reinvent it — feed it better data.
3. **Per row at rest** (promotions from today's render, `ExecutionChecklist.tsx`):
   - `description` promoted from afterthought (`text-xs`, `:356`) to the readable second line
     (`text-sm text-fg-body`) — it is the substance the validators hand-copied; it cannot read as
     metadata.
   - The conditions chip (`:434-448`) currently says only "↳ If" / "↳ 2 conditions". Promote the
     **first condition's `condition_text`, truncated, into the chip** ("↳ If: childbearing
     potential…"). GATE must state its gate at rest, not just its existence. Full if/then callouts
     stay behind the toggle (represented-as-present, and already built).
   - Timing stays as-is — `:413-424` already renders it inline with hard-constraint amber. CLOCK
     is already at rest. Cohort badge likewise (`CohortBadge` exists).
   - TRACE stays behind the Info button → `TraceabilityDrawer` (`:489-499`). Cross-references
     land in the drawer's existing block (`TraceabilityDrawer.tsx:145-167`) — currently starved by
     the parse gap, populated by recovery.
4. **The completeness strip** — §2.4.

What stays quiet-but-reachable: full description prose, source-field scaffolds, cross-reference
snippets, quotes, edit-drift history. All ACT/TRACE — the bucket rule, applied.

### 2.4 Completeness made visible, and silence ≠ emptiness

The footer strip, derived entirely from the render-set invariant:

> **"All 14 procedures the SoA marks for this visit are shown · 11 with narrative · 3 grid-only ⚠"**

- The denominator is grid truth (membership). The narrative count is bind state. The claim is
  self-referential (about PIQC's render, not about the protocol) and therefore litmus-legal — §6.
- **Each unbound row carries its own marker** — a quiet but present line: *"No narrative found for
  this item — showing the SoA entry only. Verify against the protocol source."* Visually distinct
  from a collapsed row (marker vs. chevron): **emptiness is a claim, collapse is a state.** This is
  the reconcile signal (§7, slice D) earning UI presence exactly where the brief predicted.
- Honest limit, stated now: at row level, v1 cannot distinguish *"the protocol has no narrative for
  this"* from *"the narrative exists but failed to bind."* The aggregate reconcile record **can**
  (it knows whether an unbound LLM record existed at that visit — §5.4), and the per-visit summary
  surfaces that aggregate. Plumbing the distinction per-row is a v2 refinement, not a v1 blocker —
  the row wording above is the honest superset of both cases.

### 2.5 Poke the bubble — rows advertise depth, cells advertise exceptions

The brief's hard question: how does a cell signal depth without every cell shouting? Answer:
**it doesn't — the row does.** After recovery, *most* procedures will have narrative; per-cell
depth decoration would decorate everything, which is decoration of nothing.

- **Row level (the procedure, on the map):** one quiet affordance (ⓘ) meaning "narrative exists
  for this procedure." Poking it returns the procedure's *invariant* narrative — the parts true
  everywhere it appears (§5.4's hoisting set).
- **Cell level (procedure × visit):** decorated **only when this visit deviates from the row's
  norm** — conditional here, different window here, cohort-restricted here, or carrying a
  divergence flag (§5.5). A mark on a cell means *"this instance is special,"* which is precisely
  the signal a grid can carry without becoming the density we're escaping. (Design note: pick a
  glyph that cannot be confused with protocol footnote superscripts — a corner tick or colored
  edge, not a letter. Protocols own the superscript-letter grammar; colliding with it would imply
  a legend that doesn't exist.)
- **A poke returns, in bucket order of consequence:** GATE (conditions, cohort scope) → CLOCK
  (timing, window) → ACT (description, first sentence) → TRACE links ("§7.3 · p.84", "Open in
  worksheet →"). Consequence first; prose second; evidence last-but-always.
- **Too consequential to hide?** Yes — but the enforcement surface is the **worksheet**, not the
  map. The map orients; nobody executes from it. On the acting surface, GATE/CLOCK are at rest by
  the bucket rule. On the map, the exception mark says "look closer," and the poke or the zoom-in
  is one gesture away. Forcing GATE text onto map cells would reprint the protocol into the grid —
  the exact failure §5.6 names.
- Cells with **no bound narrative** on the map: no affordance at all (nothing to poke), which is
  itself the honest signal once the row-level ⓘ exists — a row with ⓘ whose cell yields nothing
  extra is "nothing special here"; a row *without* ⓘ is "PIQC has no narrative for this procedure
  anywhere," and the worksheet's unbound marker carries the loud version of that claim.

### 2.6 The hard tension, resolved — and its failure mode

Resolution adopted: **hiding is legal only when the hidden thing is represented as present**
(an affordance is a claim), **plus the bucket rule** (GATE/CLOCK are never behind the affordance
on the acting surface), **plus the render-set invariant** (membership cannot be hidden at all,
only narrative depth can collapse).

Named failure mode: **affordance blindness.** Users habituate to collapsed chips and stop poking —
"represented as present" decays into "technically disclosed." Two mitigations, one honest limit:
- The bucket rule caps the blast radius: what a blind user misses is explanation (ACT/TRACE),
  never obligation (GATE/CLOCK). A missed description costs understanding; it does not cause a
  deviation.
- Volume discipline: if a row would render more than ~2 collapsed affordances, the design has
  failed the bloat test at that row — fold TRACE affordances into the single Info button (already
  the pattern) rather than multiplying chips.
- The honest limit: no UI can force reading. The completeness strip keeps the *count* of depth in
  view, which is as far as honesty goes without becoming nagging (wallpaper by another name).

### 2.7 The audit-reconstruction constraint, answered

**v1 needs no view trace, and here is the argument, not just the assertion:** every adaptive
operation in this design — phase ordering, bucket visibility, collapse defaults, exception marks —
is a **deterministic pure function of persisted, versioned data** (the bound narrative fields +
fixed rules in code). It takes **no user-state inputs**: no per-user config, no session state, no
mutable preference. Therefore *"what did the coordinator see when they executed this visit?"* is
answered by re-rendering the versioned data with the versioned code — the same reconstruction
standard the compliant static layer already meets. What the coordinator *changed* is already
traced (`derived_text` drift + edit log, `ExecutionChecklist.tsx:360-401`).

**The tripwire, stated as an invariant Opus must preserve:** the moment any adaptive operation
takes user identity, session state, or a preference as an input, a persisted view-config record
becomes mandatory *in the same PR*. Until then, adding one would be speculative schema — the
overengineering the working agreement bans.

### 2.8 The bloat test, applied to this design

What the design **removes** from the reading path (not only what it adds):
1. **The PDF round trip itself** — the failure being replaced; every recovered field is a trip
   not taken, and every *un*-recovered field is now a visible marker instead of a silent gap.
2. **Regenerated prose** — the per-visit `generateVisitPurpose` call (`ingestPipeline.ts:2006-2014`)
   stops firing when the protocol's own purpose survives; the user reads the protocol's sentence,
   not a paraphrase of it.
3. **Repetition across cells** — invariant narrative is stated once at row level (§2.5); per-cell
   text appears only where this visit genuinely differs. The protocol states "fasting ≥8h" once;
   so do we.
4. **Protocol-section scanning** — phase ordering replaces document order with execution order,
   which is the coordinator's hand-built re-lock, pre-built.

And the self-test the brief demanded: a worksheet row at rest is ≤3 lines (label+badges /
description / chips). A visit page is a checklist with a lede, not a linearized reprint — the
prose lives one poke deep, where the bucket rule put it.

---

## 3. (§5.4) Adversarial pressure-test of the join — verdict: narrow it, don't widen it

### 3.1 What reading the code adds to the brief's diagnosis

The defect is sharper than "global first-wins." `enrichScheduleFromLlm`'s own docstring
(`soaGridParser.ts:1074-1083`) justifies the global map with *"a label like 'Hematology' has the
same role wherever it appears"* — which is true **for `role_hint`** and false for `conditions` and
`timing`. The map was designed for a visit-invariant field and then visit-variant fields were
routed through the same assumption. **The bug is a variance-regime error**, and the fix must
therefore be field-aware, not just visit-scoped.

Second confirmed defect (not in the brief): `normLabel` strips parentheticals
(`replace(/\([^)]*\)/g, "")`, `:1071`). "Pregnancy test (serum)" ≡ "Pregnancy test (urine)";
"Vital signs (orthostatic)" ≡ "Vital signs". Distinct procedures already collide into one key, and
first-wins picks a winner silently. Today's matcher is **already** looser than exact — in the
dangerous direction, with no gate.

Mitigating fact that bounds the blast radius: the enricher **fills only empty fields**
(`:1110-1129`). Fixes change what gets filled, never overwrite grid truth — the regression surface
is small, and spine #3 is structurally safe.

### 3.2 Failure taxonomy of any looser-than-exact matcher

| Failure | Example | Consequence |
|---|---|---|
| **Sibling collision** | "PK sample (plasma)" vs "(urine)" — *live today* via paren-stripping | One sibling's conditions/timing attached to the other, with a provenance chip lending false authority |
| **Split-row collision** | Grid rows "ECG (triplicate)" / "ECG (single)"; narrative "ECG" | Token overlap binds the generic narrative to both — sometimes right, unknowable when wrong |
| **Cross-visit variance** | "Vital signs" pre-dose serial at V1, single at V7 — *live today* via first-wins | V1's timing rule executes at V7: wrong execution, invisible until a deviation |
| **Granularity mis-bind** | Narrative "Laboratory assessments" vs grid "Hematology", "Chemistry" | A summary's conditions sprayed onto itemized rows it may not govern |
| **False-divergence poisoning** | Any of the above, once §5.5 ships | The comparison engine reads its own join error as a protocol contradiction — the flagship dies of manufactured findings |

The last row is the decisive one: **the join's precision is load-bearing for two features.** Every
mis-bind is both a wrong instruction today and a false divergence tomorrow.

### 3.3 Is a wrong-visit attachment worse than silence? Yes — and here is the asymmetry

Silence sends the coordinator back to the PDF: the *old* failure, fully visible (unbound marker),
fully recoverable. A wrong attachment sends the coordinator into confident wrong execution, with a
citation chip vouching for it — invisible until it becomes a protocol deviation, and
trust-destroying when traced back. Doctrine holds (spine #8), and the mechanism is now specific:
**the unbound marker converts silence from a silent failure into a visible, cheap one — which
makes silence strictly acceptable as a failure mode, and mis-binding strictly not.**

### 3.4 The recommended matcher — precision-tiered, with every non-bind made visible

Replace the single global map with this, inside `enrichScheduleFromLlm` (signature can stay;
callers unchanged, `ingestPipeline.ts:2255`):

1. **Visit alignment first.** Align LLM visits ↔ grid visits by `normalizeVisitNameKey` (already
   exists — used at `ingestPipeline.ts:2032`), falling back to exact `study_day` equality on
   non-approximate days only (`isApproxDay` visits excluded — their day is synthetic,
   `soaGridParser.ts:1042-1064`). Ambiguous key (two grid visits collide) → no visit-level
   alignment for that pair; note it in the reconcile record.
2. **Field-variance split.** Visit-**invariant** fields: `role_hint`, `source_fields`,
   `description` (see trade below). Visit-**variant** fields: `conditions`, `timing`.
3. **Per-visit map (precision tier 1).** For each aligned visit pair, key LLM procedures by
   **full** normalized label (case/whitespace/superscript folding — **parentheticals preserved**).
   Bind all five fields here. Collision inside one visit (two LLM procs, one key) → bind neither,
   flag.
4. **Invariant-hoisted global map (tier 2).** A label may bind globally **only** for fields whose
   values are deep-equal across *every* occurrence of that label in the LLM extract. Identical
   everywhere → binding it anywhere is safe by construction; varying anywhere → that field binds
   only via tier 1. This recovers the common case the per-visit scoping loses — a procedure
   described once in prose, applying everywhere — at zero wrong-visit risk. This, not per-visit
   scoping alone, is the answer to the brief's "shrinks match coverage" trade.
5. **Paren-stripped fallback (tier 3) with a uniqueness gate.** Only when tiers 1–2 miss: match on
   paren-stripped label **iff exactly one candidate exists on both sides** (one grid label, one
   LLM label reduce to that key). Two "Pregnancy test (…)" siblings → no bind, flag. This keeps
   today's legitimate recoveries ("Hematologyᵃ" → "Hematology") and closes the collision hole.
6. **Everything unbound → the reconcile record.** Per protocol:
   `_narrative_recovery: { bound, unbound: [{visit, label, had_candidate}], collisions: [...] }`
   on `documents.extracted_fields` — the exact persistence pattern `reconcileCohorts` proved
   (`ingestPipeline.ts:2288-2308`). `had_candidate` preserves the bind-failure vs.
   absent-in-protocol distinction §2.4 needs.

**What I explicitly reject from the brief's candidate slice:** token/alias widening borrowed from
the cohort resolver. The cohort machinery works because its vocabulary is **tiny, closed, and
alias-extracted** — `study_cohorts` ships `soa_aliases` from prose (`ingestPipeline.ts:2213-2216`),
and `cohortsFromTableHeading` only ever returns members of that list. Procedure vocabulary is
open, collision-rich, and has **no extracted alias source**. What transfers is the closed-world
*discipline* (bind only into a known list, ambiguity → no bind, reconcile flags the rest) — which
tiers 1–5 embody — not the matcher. If coverage numbers from the reconcile record later justify
it, procedure-alias extraction (mirroring `soa_aliases`) is the principled widening path — a new
extract field, its own gated arc, **not** fuzzy matching.

**Trade named honestly:** tiers 1–5 will bind less than a token matcher would. The difference
lands in the reconcile record and the unbound markers — visible, countable, and honest — instead
of in silent mis-binds. Given §3.3's asymmetry and §3.2's poisoning row, that is the correct side
of the trade, and it is reversible later; mis-binds baked into worksheets are not.

**Footnote-marker linkage:** stays deferred (brief §2d). One addition: §5.5/D3 gives it a second
consumer — conditionality divergence is undetectable until footnotes re-link. Its future business
case just got stronger; its present cost didn't get smaller.

---

## 4. (§5.3) The build slices, re-ranked

Ranked by value × lift × litmus-safety, with the dependency edges that actually order them:

| # | Slice | Verdict | Why |
|---|---|---|---|
| 1 | **Visit alignment + tiered matcher** (fixes first-wins AND paren-collision; §3.4 tiers 1–5) | **Ship first** | The only slice that turns *wrong* data into right data; everything else adds data on top of it. Small: one function's internals + tests. |
| 2 | **Preserve `visit_purpose` + `cross_references`** through the overwrite | **Ship with #1** | Depends on #1's visit alignment (both are visit-keyed). Zero mis-bind risk. Kills the per-visit `generateVisitPurpose` spend via the existing quality-floor gate (`ingestPipeline.ts:2006-2014` — wiring confirmed live) and un-starves `TraceabilityDrawer`'s cross-ref block. |
| 3 | **Reconcile signal** (`_narrative_recovery` + unbound markers) | **Ship with #1** | The honesty layer; converts silence into visible silence (§3.3); the aggregate feeds §5.5. Rides the proven `_cohort_reconciliation` persistence shape. |
| 4 | **UI promotion** (purpose lede · description promotion · GATE chip text · completeness strip · unbound marker) | **Ship with #1–3** | The demo and the validator-visible fix. Data without render doesn't demo; render without data lies. All five changes are line-level edits to existing components (§2.3). |
| 5 | Join widening beyond §3.4's tiers | **Cut from v1** | §3.4 verdict. Revisit only if `_narrative_recovery` coverage numbers demand it, via alias extraction — never fuzzy matching. |
| 6 | Divergence detection | **Slice 2** — designed now (§5.5), built after 1–4 | Dependency, not preference: the comparison inherits the join's precision. |
| 7 | Footnote linkage | **Slice 3** — unchanged | Now carries two consumers (worksheet caveats + D3). |

Slices 1–4 are one **vertical slice** in the working agreement's sense: parse fix → persistence →
adapter → render, demoable end-to-end on one re-ingested seeded protocol, no new schema, no
re-parse (the enricher runs at ingest on already-parsed artifacts).

---

## 5. (§5.5) Narrative ↔ SoA divergence — the flagship, designed to survive contact

### 5.1 Taxonomy, ranked — with a build-order the code itself dictates

| Class | Rank | Basis (verified) | Gate |
|---|---|---|---|
| **D2 — window mismatch** | **1 — ship first** | Both sides already integers today: grid `parseVisitHeader` "±N days/weeks" (`soaGridParser.ts:286-294`) vs LLM `window_minus/plus_days` (`ingestPipeline.ts:495-503`) | Fire only when **both sides nonzero** and any component differs. Grid `0` = *not found* (parser default); LLM `0` = *stated none* (schema instruction) — 0-vs-N is an absence question (N2's terrain), never a v1 divergence. Compare minus and plus componentwise (grid is symmetric-only; LLM can carry −2/+3). |
| **D4 — cohort scope** | **2 — surface, don't detect** | `reconcileCohorts` already computes orphan refs / uncovered cohorts / count mismatches (`cohortExtraction.ts:175-222`), persisted as buried notes | Zero new detection. Promote existing notes into divergence records. The flagship's cheapest win is literally already computed. |
| **D1 — presence** (narrative mandates; grid unmarked) | **3 — gated** | Set-difference per aligned visit: LLM procedure list vs grid marks | Three-part gate below — the boundary test, made mechanical. **One-directional only.** |
| **D3 — conditionality** | **Deferred — blocked by footnotes** | The grid cannot express conditionality except via footnote markers, and that link is destroyed at parse (brief §2d). "The grid says unconditional" is not a grid claim — it is a parse limitation | Shipping D3 now would fire a false contradiction on every footnote-conditioned cell — the noisy-direction failure the brief says kills the feature on contact. Unlocks with the footnote arc. |
| **D5 — frequency** | **Deferred** | No parser on either side; requires arithmetic over visit sequences (cycles, unscheduled visits) | High false rate, no existing machinery. Revisit after D1/D2 prove the surfacing loop. |

### 5.2 The boundary test — granularity vs. contradiction, made mechanical

The brief calls this the crux and it is. My resolution removes the judgment call entirely:

> **Divergence requires both readings to speak the same vocabulary.** A narrative procedure counts
> as "missing from the grid" (D1) only when **(a)** its label binds — through §3.4's gated tiers —
> to a procedure the grid knows *somewhere* in the study, **(b)** the visit alignment for that
> pair is confident (tier-1, not approximate-day), and **(c)** the grid does not mark that
> procedure at that visit. A label the grid has *nowhere* is the narrative describing what the
> grid doesn't itemize — **granularity by construction, silent by design.**

And one asymmetry that buys most of the precision: **D1 never fires in the reverse direction**
(grid marks it; narrative doesn't mention it). The LLM extract is known-incomplete — that is this
entire arc's diagnosis — so narrative *absence* is evidence of nothing. A one-directional detector
on a closed vocabulary cannot manufacture the "the grid didn't itemize it" false positive, and it
cannot punish the extract for being what we already know it is.

Confidence gating, uniform across classes: (i) both sides carry their own citation (grid: header/
cell provenance from `_reducto_citations.schedule_of_events`, `ingestPipeline.ts:2257-2261`;
narrative: the extract's section/page fields); (ii) the comparator is **deterministic** — no LLM
judges divergence in v1, so every finding is re-derivable in review; (iii) the join gate is
upstream — only tier-1/tier-2 bindings feed comparison, so join uncertainty never masquerades as
protocol contradiction.

No-wallpaper check (spine #7): all three classes are structurally silent-capable — a consistent
protocol fires nothing. D2/D1 fire per actual mismatch; D4 fires per existing reconcile note.
None is always-on. ✓

### 5.3 One record, two postures

The founder locked designing both postures; here is the shared data layer and the honest split.

**The shared record** (mode-agnostic — new table, Roger's lane; this is the flagship's one real
schema cost, named plainly):

```
protocol_divergences
  id, protocol_id, document_id
  class            'window_mismatch' | 'cohort_scope' | 'presence'
  locus            { visit_name, visit_template_id?, procedure_label? }
  reading_a        { source: 'soa_grid',  quote, section?, page? }
  reading_b        { source: 'narrative', quote, section?, page? }
  detail           text — what was compared, stated without a verdict
  status           'open' | 'raised_with_sponsor' | 'resolved' | 'dismissed'
  dispositions     append-only [{ status, note, actor, at, amendment_document_id? }]
  created_at, protocol_version
```

**Lifecycle — smaller than the brief's candidate.** `open → raised_with_sponsor →
resolved(note required, optional amendment link)`, plus **`dismissed(note required)`** for
"benign / we accept reading A" — closability is a correctness requirement (locked), and not every
finding warrants a sponsor round trip; without `dismissed`, tolerable findings sit open forever
and become the wallpaper by accumulation. I **cut `acknowledged`** from the candidate: it is a
state without a decision — ceremony, not lifecycle. Reopen = append a new `open` disposition.
**Every transition appends; nothing erases** — the audit sees that the divergence existed, who
dispositioned it, and how, forever. Who may close: v1, any user with worksheet-edit standing on
the protocol (founder question #1 on tightening this).

**Per-surface (the genuinely different parts):**
- **Coordinator (Site/VEW):** divergence chip on the affected requirement row + a count on
  `VisitSnapshotCard` — scoped to the visit in view, which is what keeps the worksheet from
  becoming the auditor's list. Point-of-use framing: *"the protocol gives two readings of this
  window — resolve before scheduling."* Never blocking.
- **Auditor (SOTR/protocol review):** the protocol-wide list — grouped by class, filterable by
  status, sorted open-first. **I endorse the founder's hunch: this is the more native home.**
  Finding contradictions is this persona's job; the worksheet only ever shows the slice of the
  list that intersects one visit. Honest cost, as the brief demands: a new small SOTR section
  component (Ishika's lane) — `WorksheetItemRow.formatVisit` (`WorksheetItemRow.tsx:123`) stays
  untouched; this is a sibling list, not a retrofit of the row renderer.
- **Notice rail (S1 spine):** one new family — `narrative_grid_divergence`, the **intra-document
  sibling of N1** (`cross_document_divergence`), slotting at N1's severity tier (contradictions
  rank top of the v2 layout). Recommendation with a named trade: the rail carries **one aggregate
  notice per protocol** ("PIQC found 3 places where this protocol's narrative and its SoA
  disagree") deep-linking to the list — not one notice per record. Per-record notices double the
  lifecycle surface (rail state + record state drift apart) and re-create accumulation; the record
  is the lifecycle home, the rail is the doorbell. Cost of the aggregate: one less-granular rail
  entry — founder question #4.

### 5.4 The drafted clarification query — deterministic, position-free

Locked: PIQC drafts it; human owns and sends it. Design that makes the draft litmus-clean:
**verbatim quotes + fixed connective scaffolding per class — zero generated prose.** The draft is
a deterministic render of the record, re-derivable in audit, incapable of taking a position:

```
Subject: [protocol code, version] — clarification request: [locus]

Section [reading_b.section], p.[page] states:
    "[reading_b.quote]"
The Schedule of Assessments ([reading_a.section/locus]) states:
    "[reading_a.quote]"

These read differently regarding [class-fixed phrase: "the visit window for {visit}" /
"whether {procedure} is required at {visit}" / "which cohorts {procedure} applies to"].
Could you confirm which reading governs, and whether a clarification or amendment is planned?
```

It asks; it never asserts. A coordinator can send it unedited without PIQC having taken a position
— the locked wording requirement, satisfied structurally rather than by tone. Delivery: **copy
button only** in v1. No outbound send of any kind (locked); even `mailto:` is deferred to founder
question #2 — it is still human-sent, but it puts recipient-handling inside PIQC, which is scope
the founder hasn't asked for. Sponsor branding: none, per standing doctrine — the draft is plain
text the site sends under its own identity.

---

## 6. Litmus audit — every proposed surface

The litmus bound is on output: every assertion cites the uploaded document. Two sharpenings this
design forces, then the table:

- **Span-anchoring is part of litmus.** A verbatim quote from the right document attached to the
  *wrong target* passes a document-level audit while violating its point — §3.2's mis-binds are
  litmus failures wearing a citation. The audit unit is the *(quote, anchor)* pair; §3.4's gates
  are therefore litmus machinery, not just correctness machinery.
- **Self-referential claims are legal.** The completeness strip asserts facts about PIQC's own
  render ("all N shown"), derived from grid truth — a claim about the software, not the protocol.

| Surface | Asserts | Cites | Verdict |
|---|---|---|---|
| Requirement fields (description/conditions/timing) | Protocol's own extracted text | Extract provenance (`source_section`/`page`, `source_quote`) via TraceabilityDrawer | ✅ clean, given §3.4 anchoring |
| Visit-purpose lede | Protocol's stated purpose | Extract citation | ✅ **improves** today's posture — replaces a regenerated LLM summary (quote-less) with the protocol's own text |
| GATE chip text | First condition, truncated | The condition's own `source_section/page` | ✅ verbatim fragment + ellipsis; full text one toggle away |
| Completeness strip | "All N grid-marked items shown, K unbound" | Grid membership + bind state | ✅ self-referential |
| Unbound marker | "No narrative found for this item" | Absence claim about PIQC's recovery, not the protocol | ✅ — wording must stay "PIQC found no…", never "the protocol has no…" (that would be an uncited claim about the document) |
| Poke bubble / exception marks | This cell's bound narrative / deviation from row norm | Bound fields' provenance | ✅ marks derive from cited fields only |
| Phase ordering | Execution order | Extracted `phase`, protocol-order fallback | ✅ derived from extraction; never inferred from "typical" visit shape — the fallback IS the litmus posture |
| Divergence record | "These two passages read differently" | **Two** citations from the uploaded doc — litmus-perfect by construction | ✅ the flagship's claim |
| Divergence notice (rail) | Count + pointer | The records | ✅ aggregate of cited findings |
| Drafted query | Quotes + a question | Both citations, fixed scaffolding, zero generated prose | ✅ position-free by structure |
| Auditor list | The records, grouped | Same records | ✅ |

No proposed surface asserts an external norm anywhere. The one standing risk is anchoring drift
(§3.2), which the matcher tiers gate — and which Sonnet's verification should test directly
(deliberately colliding labels in the fixture set).

---

## 7. If forced to ship exactly one thing

**The narrative-recovery vertical (§4 slices 1–4): tiered matcher + visit alignment,
purpose/cross-ref preservation, reconcile signal, minimal UI promotion.** One slice, because its
parts are load-bearing for each other — recovery without the matcher fix ships wrong data;
either without the unbound marker ships dishonest completeness; all three without the render
ships nothing the validators can see.

What I'd cut, and it costs me to say it: **the flagship.** Divergence detection is the strategic
payoff, but it is second **by dependency** — it consumes the join's precision and the recovery's
data, and shipped today it would report the parser's own binding errors as protocol
contradictions. The recovery slice is also, on its own, the complete answer to the validation
failure that started this arc: the coordinator builds the worksheet without reopening the PDF,
or sees exactly where and why they still must.

If "one thing" means one *commit*: §3.4's matcher fix alone — the only change that converts data
PIQC currently gets **wrong** into data it gets right. Everything else adds; that one corrects.

---

## 8. What the brief gets wrong (invited, so said plainly)

1. **"Exact `normLabel` match only" (§2b) understates the defect.** `normLabel` strips
   parentheticals, so the current matcher is already a lossy many-to-one mapping — sibling
   procedures collide *today*, before any widening. The brief names one live bug (first-wins);
   there are two, and they compound. The fix list must include the collision gate or the
   "fixed" join still mis-binds siblings.
2. **"The SoA cell is already the join key" (§5.6) is imprecise.** The join key today is the
   *label, globally* — that's the bug. The cell (label × visit) *becomes* the join key only after
   §3.4. The poke-the-bubble design survives intact, but the cheapness claim is one slice later
   than stated.
3. **"Reuse the cohort resolver's token/alias logic" (§6) transfers the wrong half of the
   pattern.** Cohort resolution is safe because its vocabulary is tiny, closed, and
   alias-extracted from prose; procedures are open-vocabulary with no alias source. What
   transfers is the closed-world discipline and the reconcile shape. The matcher itself must not
   ship for procedures (§3.4). As written, the candidate slice would build the mis-binder §5.4
   warns about.
4. **"The gap is population, not schema, not UI" (§2c) is true for slice 1 and false for the
   flagship.** Divergence needs a record, a lifecycle, and two renderers (§5.3). Correct as
   scoped; wrong if inherited as an arc-level assumption — the founder should see the flagship's
   schema cost now, not discover it at build time.
5. **The success test is unfalsifiable as stated.** "Never reopens the PDF" can't be measured
   in-product. Proxy that can: **every worksheet atom either carries in-product provenance or an
   explicit unbound marker; the per-visit unbound count is the defect count.** Drive it to zero
   across the seeded corpus; re-run the validation session and count return trips. That's the
   measurable version of the founder's test.
6. **Minor:** the candidate lifecycle's `acknowledged` state (§5.5) is ceremony — a state without
   a decision. Cut it (§5.3 here); `raised_with_sponsor` *is* the acknowledgment.

Everything else in the brief survived adversarial re-reading: the diagnosis line numbers are
accurate, the caged spine is internally consistent, the two-layer reduction holds, and the
sequencing (recover → diverge → footnotes) is the dependency order, not just a preference.

---

## 9. Questions only the founder can answer

1. **Who may close a divergence?** v1 proposal: anyone with worksheet-edit standing may
   `dismiss`/`resolve` (note required, trail permanent). Tighten to reviewer-role-only?
   (Coordinator-dismissable is lighter; reviewer-gated is more defensible in an audit narrative.)
2. **Drafted query delivery:** copy-to-clipboard only (my recommendation), or also a `mailto:`
   handoff? Both are human-sent; `mailto:` adds recipient handling inside PIQC — scope you
   haven't asked for, but one click less for the site.
3. **Amendment behavior for divergences:** when a new protocol version is ingested, do open
   divergences on the old version carry forward, auto-annotate ("superseded by v3 upload"), or
   simply remain on the old version's record? (My lean: detection re-runs per version;
   old records stay, linkable via the `amendment_document_id` disposition field — but the
   carry-forward UX is a workflow decision, not a technical one.)
4. **Rail granularity:** one aggregate divergence notice per protocol (my recommendation, §5.3)
   vs. one per record. Aggregate keeps the rail thin; per-record makes each finding
   individually dismissable from the rail.
5. **Which divergence surface ships first** once slice 2 starts — worksheet chips (coordinator,
   the validating persona) or the SOTR list (auditor, the more native home)? Both read the same
   record; this is pure sequencing. My lean: record + worksheet chips together (they ride VEW
   surfaces slice 1 already touched), SOTR list immediately after — but you said the
   build-decision waits for this spec, so it waits.

---

*Spine check, closing: nothing above relaxes §3. The litmus bound tightened (span-anchoring);
no re-parse anywhere (the enricher and detectors run on already-parsed artifacts at ingest);
grid structure stays authoritative (fill-only-empty preserved); the SoA visualization is retained
and given a navigation role; completeness gained a visible instrument; everything PIQC produces
is drafted/flagged for a human; every signal can stay silent; and the precision gate sits on the
link, where the doctrine put it.*
