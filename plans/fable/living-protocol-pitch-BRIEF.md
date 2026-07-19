# Fable brief — The Living Protocol founder pitch

**Deliverable:** `plans/fable/living-protocol-pitch.md`
**Mandate:** GENERATIVE. Voice, framing, and structure are yours to propose. The doctrine
spine below is caged and may not be relaxed.
**What this is NOT:** website copy, a feature list, or a spec. It is the piece of writing
that makes someone believe the category exists.

---

## 0. Why now

Every artifact PIQC has produced so far argues *inward* — specs, roadmaps, handovers, all
written to make a build decision. None of them argue *outward*. The north-star is
crystallized and a vertical slice has been built against it, but there is no single piece
of writing that makes a stranger care.

That's the gap. Close it.

---

## 1. The thesis you are selling

> **PIQC is the sharpest reader on your team.** It reads and self-audits protocols from
> any therapeutic area with equal depth.

Not *smarter*. **More complete, more tireless, more provable, and bounded.**
Voltage = completeness × tirelessness × provability.

The underlying observation: at sufficient depth, **reading and self-auditing are the same
act.** A reader thorough enough to hold the whole document at once will notice where it
disagrees with itself. Humans can't hold it all. That's not a skill gap — it's a capacity
gap, and it's the systems failure to name.

Supporting frames, use or discard as they serve the argument:

- **A dead PDF wakes up into a living protocol.** The origin seeds were a demo-watcher
  saying *"it's like a protocol as a website"* and the founder asking, after a
  consciousness podcast, *"what if PIQC were conscious — but only of the uploaded
  protocol?"* Same idea from two directions: website = the body (navigable, linked,
  role-aware, live, ask-able); bounded-consciousness = the mind. ⚠️ Never say
  "conscious" externally — the sanctioned words are *living protocol · it noticed ·
  sharpest reader · grounded with citations*.
- **PIQC reads deep so your team reads shallow.**

---

## 2. ⭐ The new material — what the narrative-first arc proved

This is the reason to write the pitch now rather than three months ago. Everything below
is real, recent, and grounded. Use what earns its place; you are not obligated to use all
of it.

### 2.1 A validation failure, observed — not hypothesized

A coordinator and an auditor, independently, hit the same wall. After uploading a
protocol, PIQC gave them the schedule-of-assessments visualization **and nothing else** —
so both went back into the PDF and hand-copied the surrounding context into their own
worksheets.

The founder's read: *if PIQC is not collapsing cognitive load, PIQC is failing for that
user.* The grid says which procedure happens at which visit and then stops. Everything
needed to actually execute or verify that visit stays locked in the document.

### 2.2 The diagnosis is the story

The narrative wasn't missing from the pipeline. **It was extracted, and then discarded.**

The extraction already captured per-procedure descriptions, conditional logic, timing
rules, and visit purpose. Then a later deterministic step overwrote it and tried to
re-attach it by matching procedure labels — badly. PIQC had already paid to read the
thing it was making users read by hand.

That is a better story than "we added a feature," and it generalizes: the value was
already latent in the parse; the work was recovery, not construction.

### 2.3 Reading our own pipeline the way we claim to read protocols

Two live correctness defects surfaced during that pass — a label map that let a procedure
appearing at several visits silently inherit the *first* visit's instructions, and a
normalizer that collapsed sibling procedures (a serum test and a urine test) into one key
and picked one at random.

Both were invisible. Both produced confident, wrong output with no signal. Finding them
required exactly the property being sold: exhaustive cross-checking of a document against
itself. There is a dogfooding argument here — take it if it lands, drop it if it reads as
navel-gazing.

### 2.4 ⭐ Two readings → divergence is signal (the flagship)

Recovering the narrative gives PIQC a **second, independent reading of the same
protocol.** Once two readings exist, disagreement between them is information.

The narrative says vitals at every visit; the grid doesn't mark visit three. The narrative
says ±3 days; the header says ±2. The grid marks a procedure unconditional; the narrative
says "only if an adverse event occurred."

Caught at upload, the site clarifies with the sponsor *before activation* — before these
become protocol deviations. Why this is the strongest thing in the arsenal:

- **It cites the protocol against itself.** Both sides of the comparison are the uploaded
  document's own words. No external standard is ever invoked.
- **PIQC never adjudicates.** It shows both quotes side by side, says what it compared,
  and drafts a clarification the human can send. It does not decide who's right, and it
  never sends anything.
- **No human does this exhaustively.** Nobody cross-checks every narrative sentence
  against every grid cell. A tireless reader can. That's a capability claim, not a
  feature claim.

### 2.5 The physics frame

A protocol is **one document serving five masters** — the scientist, the regulator, the
site, the safety apparatus, and the participant. Each needs a different projection of the
same truth, and today **every reader hand-decompiles their own projection** from a
document that was written for all five at once.

That reframes the product: **PIQC is a projection compiler.** One authored source, many
role-correct views, derived rather than re-typed.

A corollary worth mining: contradictions concentrate at **authoring seams** — the places
where different hands maintained different representations of the same fact. Grid versus
prose. Footnote versus cell. Synopsis versus body. Eligibility versus its restatement
later. Divergence detection isn't fishing; it's looking where the fish are.

### 2.6 The bound is the moat

The hard rule, and the thing that makes this sellable into a regulated setting:

> **PIQC only ever checks against the protocol that was uploaded — never against what it
> thinks an oncology phase 1 ought to contain.**

The precise formulation earned this month:

> **Industry knowledge may choose the questions. Only the uploaded document may supply
> the answers.**

The bound is on the **output**, not on what the model knows. PIQC may use domain knowledge
as a *reading lens* — to parse a given area better, or to decode a protocol's own
self-commitment ("it says 3+3, so it promised DLT criteria; where are they?"). What it may
never do is use domain knowledge as a **yardstick** ("oncology protocols usually have a
DSMB and yours doesn't").

This is not a limitation to apologize for. In a GxP setting it is the only kind of AI a
trial team is permitted to trust — and it is genuinely hard to copy, because it's a
discipline, not a feature.

One sharpening worth carrying: **a right quote pointing at the wrong target is a citation-
shaped failure.** Provenance that doesn't anchor to the correct span is worse than no
provenance, because it survives inspection.

---

## 3. Caged spine — non-negotiable

- **Never claim unshipped work as shipped.** The narrative-first arc lives on an unmerged
  branch with **zero runs against live data.** Every test is a fixture. It is a proof of
  *diagnosis and direction*, not a delivered capability. The existing site vocabulary is
  the guide: *Live today* vs. *Platform direction*. When in doubt, restrain the claim —
  and note that most of this material is strongest as **conviction about the problem**,
  which needs no availability claim at all.
- **Never say "conscious," "AI reviewer," or anything implying PIQC decides.** Advisory
  only. PIQC drafts, flags, and finds; humans approve.
- **No sponsor contact, no outbound send, no adjudication** — ever, in any framing.
- **The schedule-of-assessments visualization is a delivered win.** Narrative-first is
  additive. Do not frame it as fixing something broken; the failure was showing *only*
  the grid.
- **Voice: earned conviction, never résumé.** Authority comes from naming the problem
  more precisely than anyone else has — never from tenure, titles, year-counts, or
  credentials. Frame it as a systems failure, not a people failure: skilled teams
  re-deriving a protocol's meaning by hand, before anyone has seen a patient. First-person
  plainspoken founder voice is welcome. A bio is not. At most one quiet credibility line,
  and only if it reads as conviction rather than credential.
- **No sponsor branding, no invented customer names, no fabricated metrics or quotes.**

---

## 4. What to produce

Structure is yours. A suggested shape, to be overridden if you have better:

1. **The pitch itself** — the primary artifact. Long enough to actually argue, short
   enough to be read in one sitting.
2. **The compression ladder** — the same argument at one sentence, one paragraph, and one
   page. If the thesis doesn't survive compression, it isn't a thesis.
3. **The objection set** — the three or four hardest challenges a skeptical buyer or
   investor lands, and the honest answer to each. Include at least: *"isn't this just
   another PDF chatbot?"*, *"what happens when it's wrong?"*, and *"why can't the
   incumbent EDC/CTMS vendor add this next quarter?"*
4. **Audience cuts** — note where the argument must change for an investor, a site or
   sponsor buyer, and the internal team. Re-rank which audience the primary artifact
   should be written *for*; don't assume it's the investor.

Then close with three things, as in the prior pass:

- **What you would cut** if forced to make the argument with exactly one proof point.
- **Anything above you think is wrong** — a frame that won't survive contact, a claim
  that's weaker than it reads, a metaphor that breaks. Say so plainly.
- **The questions you couldn't answer** without a founder decision.

---

## 5. Grounding you may draw on

Read as needed; do not summarize them back:

- `plans/fable/living-protocol-vision.md` — the north-star, five reading acts, ambiguity
  engine, the seven moat arguments.
- `.claude/worktrees/narrative-first/plans/fable/protocol-physics-first-principles.md` —
  five masters, six laws, the authoring seam map. ⚠️ Lives only on the unmerged
  `fable/narrative-first` branch; read it at that worktree path.
- `.claude/worktrees/narrative-first/plans/fable/narrative-first-worksheet-spec.md` — the
  arc that produced §2, including a section on what its own brief got wrong. Same
  worktree-only caveat.
- `website/FABLE-BRIEF.md` — existing site voice and the Live-today / Platform-direction
  truth hierarchy. Do not contradict shipped copy.
