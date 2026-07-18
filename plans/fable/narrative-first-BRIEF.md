# FABLE BRIEF — narrative-first protocol parsing → the complete study worksheet

status: brief (INPUT for Fable). Fable's output goes to `plans/fable/narrative-first-worksheet-spec.md`.
branch: `fable/narrative-first` (proving ground, cut from main `0b93bb5`). NOT a merge target.
date: 2026-07-18

---

## 0. Read this first — what you are being asked to do

You are being handed a **generative mandate**. Prior passes established that you do your best work
when you are given the doctrine spine as a cage and the *product* left genuinely open. This brief
cages the spine (§3) and leaves the design open (§5).

Do not return a single pre-locked answer. Return **weighed options with a recommendation** — trade
space the founder can choose from. Where you disagree with a framing in this brief, say so and argue
it; the brief is grounded but not infallible.

---

## 1. The failure this exists to fix

A user-validation run with a **coordinator** and an **auditor** produced the same failure:

> After protocol upload, **PIQC returned only the SoA visualization** — which left the user to **go
> back into the PDF protocol and manually pull out the relevant context of the SoA visit workflow**,
> then re-type it into their study worksheets.

Framed as the product test it actually is: **if PIQC is not collapsing cognitive load, PIQC is
failing for that user.** The SoA grid alone hands the work back. It says *which* procedure happens at
*which* visit and stops — while the instructions needed to execute or verify that visit (procedure
descriptions, timing/window rules, conditional "only if" logic, footnotes, cohort caveats) stay
locked in the PDF.

**The success test to design toward:** a coordinator builds a complete study worksheet for a visit
**without ever reopening the protocol PDF.** Every return trip to the PDF is a defect.

### 🔒 The SoA visualization is PRESERVED — this is not negotiable

The SoA grid PIQC renders today is a **real, already-won user win**: it takes a dense, hostile
diagram and makes it visualizable. Narrative-first **layers on top of it**. The failure was never
"PIQC showed the SoA" — it was "PIQC showed *only* the SoA and stopped there." We are adding the
missing half, not trading one win for another.

You may re-frame *how* the SoA sits in the flow. You may **not** delete it, hide it by default, or
demote it to an afterthought. Any proposal that removes it is out of bounds.

---

## 2. The grounded diagnosis — the narrative is ALREADY extracted, then discarded

This was verified by reading the current code (not assumed). It changes the economics: this is a
**recovery** job, not a build-from-scratch job.

**2a. The LLM extract already captures rich per-procedure narrative.** `CLINICAL_EXTRACT_SCHEMA` in
`supabase/functions/_shared/ingestPipeline.ts` defines:
- `schedule_of_events[].visit_purpose` — 1-3 sentence clinical purpose (`:513-521`)
- `procedures_structured[].description` (`:533-536`)
- `procedures_structured[].conditions[]` — if/then rules w/ `condition_text`, `consequence_text`,
  `source_section`, `source_page` (`:575-589`)
- `procedures_structured[].timing` — per-procedure timing constraint prose (`:590-602`)
- `procedures_structured[].role_hint`, `.source_fields[]` (`:566-622`)
- `schedule_of_events[].cross_references[]` — verbatim `snippet` + `source_section` + `page` (`:633-646`)

**This IS the narrative the validators were hand-hunting.** It is already paid for.

**2b. The deterministic grid overwrites it, then re-attaches by a brittle exact-string join.**
At `ingestPipeline.ts:2250-2256`, grid assembly replaces `schedule_of_events` wholesale. Then
`enrichScheduleFromLlm` (`soaGridParser.ts:1085-1134`) tries to recover — but:
- **exact `normLabel` match only** (`:1107` — no match → `continue`; that procedure gets *nothing*)
- recovery list (`:1110-1129`) covers `role_hint`, `conditions`, `timing`, `source_fields`,
  `description` — and **excludes `visit_purpose` and `cross_references` entirely**
- ⚠️ **the map is GLOBAL and first-wins** (`:1089-1101`) — keyed by label across *all* visits. A
  procedure recurring in several visits with **different** conditions inherits the **first visit's**
  narrative. **This is a live correctness bug: narrative silently attached to the wrong visit.**

Consequences: `visit_purpose` is thrown away then *regenerated* by a separate per-visit LLM call
(`generateVisitPurpose`, fired because `entry.visit_purpose` is always `""` on the grid path —
`:1989-2050`); `cross_references` end up empty on the grid path; any label mismatch = total silent
narrative loss for that procedure.

Note the contrast: the **cohort-scope** join uses a robust closed-world resolver
(`cohortsFromTableHeading`, token/alias/numeric-range), while the **narrative** join uses raw string
equality. The better pattern already exists in the same file.

**2c. The worksheet UI already declares and renders these fields.** `VisitExecutionItem`
(`src/types/visit-execution/index.ts:342-382`) carries `description`, `conditions[]`, `timing`,
`source_quote`, `cross_reference_snippet`. `ExecutionChecklist.tsx` renders `description` (`:356`, a
quiet `text-xs` line), the conditional/timing zone (`:406-484`); `TraceabilityDrawer.tsx` shows
verbatim `source_quote` + `cross_reference_snippet` (`:127-167`).

**→ The gap is POPULATION, not schema and not UI.**

**2d. Footnotes are the one genuinely hard case (deferred, not your v1).** The procedure→footnote
marker link is destroyed at parse: `stripTags` drops `<sup>` (`soaGridParser.ts:76`),
`stripTrailingFootnote` (`:91-99`), `noteOrNull` drops ref-only notes (`:104-107`). Legends survive
only as an unlinked blob (`get_protocol_soa_footnotes` → `FootnotesDrawer`, display-only, explicitly
"no parsing/linkage"). Re-linking at cell granularity is its own gated arc.

### The reference pattern you should reason from — cohort two-phase closed-world

Proven in-repo, and the template for everything here:
1. **Phase 1** — LLM extracts an *authoritative list* from PROSE only, evidence-gated
   (`ingestPipeline.ts:651-691` schema + `:711-731` prompt: "do NOT infer cohorts from the SoA table
   alone, never invent"). Parsed by `parseStudyCohorts` (`cohortExtraction.ts:74-118`); a label with
   no citation is **kept but marked `has_evidence:false`** — no silent invention, no silent drop.
2. **Phase 2** — a **deterministic closed-world resolver** binds structured SoA markers to that list
   (`cohortsFromTableHeading` `:826-874`, `markerCohortScope` `:894-921`); it can only ever return
   labels already in the list, so it cannot invent.
3. **Reconcile** — `reconcileCohorts` (`cohortExtraction.ts:175-222`) flags divergence classes
   (count mismatch, uncovered cohort, orphan schedule ref, missing citation). Never aborts, never hides.

---

## 3. 🔒 CAGED SPINE — non-negotiable, you may not relax these

1. **THE LITMUS TEST.** *"PIQC should only check against the protocol that was uploaded and not
   against what it thinks the industry standard of an oncology phase 1 should contain."* The bound is
   on **OUTPUT, not model knowledge** — clinical reading is the lens; **every assertion PIQC makes is
   a citation to the uploaded document.** Never an external norm, never a "typical" value.
2. **No re-parse.** The Reducto budget is reserved for customers. Everything ships on the **existing
   single HTML parse**. Do not propose a second parsing pass over the corpus.
3. **Grid stays authoritative for structure** (visit × procedure marks). Narrative augments; it never
   reshapes the grid's cell truth.
4. **The SoA visualization survives** (see §1).
5. **Completeness is the bar, not brevity.** PIQC fails if any protocol-mandated requirement for that
   visit is missing. **Trim noise, never signal.** Compliance complexity stays; presentation improves.
6. **Advisory, never autonomous.** PIQC drafts / flags / finds. The human approves. No auto-write into
   a worksheet, no bypassing review state. Attribution voice ("PIQC drafted / flagged") is
   product-bearing.
7. **No wallpaper.** A signal that fires on *every* protocol is noise. This doctrine already retired
   an always-on notice type. Anything you propose must be able to stay silent.
8. **A wrong catch is worse than silence.** The precision gate belongs on the **link**, not the
   classification.

---

## 4. What you're building on / what's out of scope

- **Deferred:** footnote-marker preservation + cell-granularity linkage (§2d).
- **Out of scope:** Audit Mode (separate vendor-audit product, verified it doesn't consume this path)
  and Ask/RAG (reads `chunks` + a `FACT_LABELS` allowlist that excludes `schedule_of_events`).
- **Inherits for free:** the Sponsor Deliverable Engine — all 6 deliverables generate from
  `protocol_extracted_items`, so richer narrative flows with **zero deliverable-side changes**.
- **Needs a small renderer change:** SOTR/Protocol review (`WorksheetItemRow.formatVisit()` prints
  only "… · 2 procedures"). This is the surface the *auditor* persona actually uses.

---

## 5. YOUR MANDATE — five deliverables

### 5.1 Narrative-type ontology for a worksheet
Enumerate the categories of narrative context a coordinator worksheet needs — candidates: procedure
description, visit purpose, timing/window rule, conditional "only if" logic, cohort-scope caveat,
cross-reference context, footnote caveat. **Rank which earn v1 vs. defer.** Decide what is *primary
content* vs. *drawer/on-demand*. Resist a 24-bucket taxonomy; prior doctrine favors ~4 buckets that
map to real decisions.

### 5.2 ⭐ HEADLINE ASK — a visually powerful "complete study worksheet flow"
This is the creative center of the pass, not a layout footnote.

Design how a coordinator moves through a visit when **narrative leads**: what carries the eye first,
what is promoted out of today's collapsed rows, what stays quiet-but-reachable, how provenance
(`source_quote` / `cross_reference_snippet`) attaches per requirement, and **how the preserved SoA
view and the narrative flow coexist as complementary views of one truth** (e.g. SoA as the orienting
map ↔ narrative as the working surface — propose the model; it is not pre-locked).

Design toward the success test: **the coordinator never reopens the PDF.** State explicitly what makes
the flow *complete* (nothing protocol-mandated missing for that visit) and **how completeness is made
visible rather than merely assumed.**

### 5.3 Re-rank the build slices
Candidate slice (below, §6) by value × lift × litmus-safety. Say what ships first and why.

### 5.4 Adversarial pressure-test of the join fix
Where does a looser-than-exact matcher **mis-bind or false-attach** narrative to the wrong procedure?
Is that worse than today's silent loss? What are the litmus risks?

**Must specifically address the confirmed global first-wins defect** (`soaGridParser.ts:1089-1101`):
scoping the map per-visit is the obvious fix, but it *shrinks* match coverage — name the trade and the
safe default. Governing question: **is a wrong-visit narrative attachment worse than silence?**

### 5.5 ⭐ NARRATIVE ↔ SoA DIVERGENCE DETECTION — the flagship intelligence capability

Founder insight, and the reason this work matters beyond worksheet convenience:

> When a human manually reviews the narrative *and* compares it against the SoA, they sometimes find
> **discrepancies between the two — and that is a good thing.** Surfacing them early lets the user
> flag and clarify before the study runs.

**Recovering the narrative gives PIQC a second, independent reading of the same protocol. Once both
readings exist, disagreement between them is signal.** Caught at upload, the site clarifies with the
sponsor *before activation* — before these become protocol deviations.

Why this is flagship, not nice-to-have:
- **Litmus-perfect by construction** — both sides of the comparison are the uploaded protocol's own
  text. PIQC cites the protocol **against itself** and never needs an external norm.
- **Makes "sharpest reader on your team" concrete** — no human exhaustively cross-checks every
  narrative sentence against every grid cell. A tireless reader can. Capability claim, not feature claim.
- **Already proven in-repo** — `reconcileCohorts` does exactly this shape; S1's
  `cross_document_divergence` is the same family one level out (across *documents*). This is the
  **intra-document, narrative-vs-grid** sibling.
- **Serves the auditor persona directly** — finding discrepancies *is* the audit job.

Work out:
- **The divergence taxonomy.** Which classes are real and worth surfacing. Candidates to rank:
  *presence* (narrative mandates a procedure at a visit the grid doesn't mark, or vice versa),
  *timing/window* (narrative ±3d vs. header ±2d), *conditionality* (grid unconditional vs. narrative
  "only if X"), *cohort scope* (narrative "Cohort B only" vs. grid marks all), *frequency*.
- **⚠️ The boundary test — THE CRUX.** Real contradiction vs. benign granularity difference. The
  narrative describing something the grid doesn't itemize is **NOT** a discrepancy. Get this wrong in
  the noisy direction and the feature dies on first contact. A false discrepancy is a trust-killer
  that manufactures busywork.
- **Confidence gating.** What must be true before PIQC asserts "these disagree"? Both sides
  high-confidence? Deterministic-only classes first (windows/cohorts, where parsers already exist)?
- **Surfacing moment + UX.** Early (at upload/review, so the site can clarify pre-activation) vs.
  in-worksheet at point of use, or both. How it routes into a **clarification workflow** rather than a
  blocking error. Reuse the existing `needs-clarification` affordance (already in the worksheet
  overflow menu) and the notice rail — don't invent a surface.
- **Wording honesty.** PIQC shows **both quoted sources side by side** and says what it compared. It
  **never adjudicates which one is right** and never auto-resolves. The human clarifies with the sponsor.
- **Fit with the S1 notice spine.** Is this a new notice family (intra-document sibling of
  `cross_document_divergence`)? Does it obey the no-wallpaper rule?

---

## 6. The candidate build slice you are re-ranking

"Recover the narrative PIQC already pays for" — no new schema, no re-parse:
- **Preserve** `visit_purpose` (the *original* extract) + `cross_references` through the grid
  overwrite. Bonus: short-circuits the per-visit `generateVisitPurpose` LLM call via the existing
  `reductoPurposeMeetsQualityFloor` gate, and un-empties `protocol_visit_templates.cross_references`.
- **Fix the global first-wins map** — scope narrative matching **per visit**. Correctness before coverage.
- **Widen the narrative join** from exact match to closed-world resolution (reuse the cohort resolver's
  token/alias logic) — *gated by your §5.4 verdict*.
- **Add a reconcile signal** for procedures with a grid cell but no narrative bind — makes today's
  silent loss visible.
- **Promote narrative to primary content** in `ExecutionChecklist.tsx` per your §5.2 design —
  **additively; the SoA view and FootnotesDrawer stay intact.**

**Sequencing:** (1) recover narrative → worksheet complete, then (2) divergence detection, then
(3) footnote linkage. You design (2) **now** so (1) is built with the comparison in mind rather than
retrofitted.

---

## 7. What to return

Write `plans/fable/narrative-first-worksheet-spec.md` on this branch containing §5.1–5.5, with:
- explicit **trade space + recommendation** for each product-shaped call (not a locked answer)
- a **litmus audit** of every surface you propose
- what you'd **cut** if forced to ship one thing
- anything in this brief you think is **wrong**, and why

Opus builds from your spec; Sonnet verifies. Design accordingly — be concrete enough to build from.
