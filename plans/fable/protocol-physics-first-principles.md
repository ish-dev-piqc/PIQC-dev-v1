# FABLE — the physics of a protocol, from first principles

status: ideation (product-altitude feedback; NOT build-spec — nothing here reorders slices 1–4)
branch: `fable/narrative-first` · author: Fable (claude-fable-5), 2026-07-18
sibling: `narrative-first-worksheet-spec.md` (the build spec this doc deliberately stays out of)

---

## 0. Why this document exists, and the license it runs on

The worksheet spec's §5.6 treated "physics" inside the founder's frame: the dependency structure
underneath the SoA. That was correct scoping for a build spec — and it was **not** a
first-principles account of what a protocol *is* in the industry sense. The founder asked for
that account, and for the product feedback it generates.

**The license, stated once:** the litmus test bounds PIQC's *output*, not Fable's *design-time
knowledge* — the brief says so in its own words ("the bound is on OUTPUT, not model knowledge;
clinical reading is the lens"). The rule that keeps this whole document doctrine-safe is:

> **Industry knowledge may choose the questions. Only the uploaded document may supply the
> answers.**

Everything below uses industry knowledge to decide *where PIQC should look*; nothing below
licenses PIQC to *assert* anything it cannot quote from the document in hand. Every product idea
ends with that check.

---

## 1. First principles: what a protocol actually is

Strip away the format and a protocol is **one document forced to serve five masters at once**:

| Master | What they need from the document | Their projection |
|---|---|---|
| **The scientist/statistician** | A valid causal design (question → estimand → endpoints → power) | The design sections, statistics section |
| **The regulator** | A legal commitment: *this is what will be done, and any departure is a recorded breach* | The whole document as contract; deviations defined against it |
| **The site** | An executable instruction manual: who does what, when, in what window | The SoA + the operational prose scattered everywhere else |
| **The safety apparatus** (medical monitor, IRB/EC) | Bounded risk: monitoring, stopping rules, dose-modification logic, AE handling | Safety sections, dose-mod tables, halting criteria |
| **The participant** | An honest basis for consent | The consent-relevant subset |

The industry's structural failure — the one PIQC exists inside — is that these five projections
ship as **one linear prose document**. The SoA table is the *only* place where the operational
projection is even partially compiled; every other projection must be re-derived by a human
reading the whole document with their role in mind. The coordinator hand-building a worksheet,
the CRA hand-building a monitoring plan, the auditor hand-checking consistency: all of them are
**decompiling the same document into their own projection, by hand, every time.**

**This is the first-principles definition of the product: PIQC is a projection compiler for a
document class that entangles five audiences.** The §10 universality contract in the worksheet
spec (trunk + per-persona projections) turns out not to be an architecture preference — it is the
shape of the problem itself. That is worth knowing: it means the trunk investment compounds with
every projection, and it means any competitor who builds per-persona features without a shared
trunk is rebuilding the decompiler once per audience.

---

## 2. The six laws — the physics any protocol obeys

These are the invariant structures underneath every interventional protocol, regardless of
sponsor, phase, or therapeutic area. Each law names the human labor it currently forces.

### Law 1 — the causal chain (nothing in the SoA is arbitrary)

Every procedure exists because some endpoint needs a measurement at some time, or because safety
demands surveillance: **objective → estimand → endpoint → assessment → visit → window → procedure
→ data point.** A protocol's Objectives/Endpoints section and its assessment sections *state*
this chain; the SoA is its compiled output. Two consequences:

- A procedure's **criticality is derivable from the document itself**: primary-endpoint ancestry
  is stated, safety mandates are stated. (The industry's current direction — risk-proportionate
  quality, critical-to-quality factors — is converging on exactly this, but PIQC never needs to
  cite that trend: the chain is in the uploaded document.)
- The chain is also a **consistency surface**: an endpoint that requires a measurement the SoA
  never schedules, or a scheduled assessment serving no stated purpose, is the protocol
  contradicting itself one level above the narrative↔grid seam.

*Labor forced today:* CRAs and monitors reconstruct "which assessments are critical" by judgment;
coordinators can't answer "why am I doing this procedure" without a document dive.

### Law 2 — time is multiple clocks, not a number line

A protocol runs on a small set of named clocks: consent, randomization/first dose (Day 1), cycle
clocks (C1D1, C2D1…), event clocks ("within 7 days of progression," "30 days after last dose"),
end-of-treatment, follow-up. Every visit is **(anchor clock, offset, window)** — and intercurrent
events *move the clocks*: a dose delay shifts every cycle-anchored visit and none of the
calendar-anchored ones; discontinuation kills one schedule and activates another.

**This is a first-principles critique of the current product, grounded in code already read:**
the extract schema makes `study_day` a **required integer** (`ingestPipeline.ts:648`), and the
grid parser's approximate-day pass (`soaGridParser.ts:1042-1064`) exists precisely to fake a day
number for visits that *have no day* (EOT, ED, LTFU). That hack is the single-clock assumption
compensating at the edge. Multi-clock protocols — which is to say, most of oncology — are being
flattened into a number line, and the flattening is why dose-delay rescheduling (the most common
real-world scheduling event) is invisible to the model.

*Labor forced today:* coordinators recompute every downstream visit date by hand after every
delay — the single most repeated scheduling task at a site.

### Law 3 — the population is a set of trajectories, not a roster

Eligibility defines the set; cohorts partition it; and then reality deforms it — screen failures,
discontinuations, deaths, crossovers, unscheduled visits. The protocol pre-declares the forks:
the early-termination visit, the discontinuation pathway, the follow-up schedule, unscheduled-
visit contents. **The SoA is a field; a participant is a path through it.** A deviation is a
path-vs-field mismatch. PIQC's grid already *sees* the fork columns (EOT/ED are exactly the
approx-day visits of Law 2) — it does not yet model them as forks: which visits die when a
participant discontinues, what activates, within what window of the triggering decision.

*Labor forced today:* when a participant discontinues, someone re-derives their remaining
obligations by hand, under time pressure, from prose.

### Law 4 — the latent programs (prose that is secretly code)

Protocols embed executable logic written as narrative: "if of childbearing potential…", "if
Grade ≥3, hold and re-dose at…", dose-modification tables (toxicity grade × occurrence count →
action), stopping rules, re-screening rules. Dose-mod tables are the densest: two-dimensional
decision programs that sites hand-transcribe into laminated cheat sheets — the archetypal
"unlock the physics, re-lock into an executable view" behavior, done with scissors. The
`conditions[]` recovery in the current arc captures the *simple* conditionals; the tables are the
deep end.

*Labor forced today:* the cheat sheet — hand-built, uncontrolled, drifting from the amendment.

### Law 5 — the amendment force (a diff distributed as prose)

Protocols are living documents whose version control the industry does on paper: amendments ship
as narrative summaries-of-changes plus a reissued document; sites operate on protocol ∪
amendments ∪ clarification letters, with version skew across sites and countries. The industry's
change-management artifact is a *diff communicated in prose* — and every role needs a different
projection of that diff: "what changed for *my* visits, *my* participants mid-cycle, *my* role."
PIQC's cross-document machinery (N1) already compares versions; the first-principles extension is
the *projection of the diff*: per-participant amendment impact ("participant 012 is mid-Cycle 3;
this amendment changes Cycle-3 PK sampling").

### Law 6 — the provenance law (already PIQC's spine)

The regulatory physics: every act must trace to document authority, every claim to a record —
"if it isn't written down, it didn't happen." This law is why the litmus test is not a product
preference but the *native physics of the domain*: an assertion without a citation is, in this
industry, not merely weak — it is inadmissible. PIQC's spine is aligned with the deepest law of
the territory. No change; named for completeness because it is the reason the other five laws
are exploitable *by PIQC specifically*.

---

## 3. The authoring physics — why contradictions live where they live

One more first-principles layer, and the most commercially useful one: **why does
narrative↔grid divergence exist at all?** Because of how protocols are made. They are assembled
by committees from sponsor template libraries, under deadline, with the SoA table and the
assessment prose maintained by **different hands at different stages** — the SoA gets late edits
in design reviews that never propagate back into the body text, and vice versa; the synopsis is
rewritten first or last and drifts from the body; footnotes accrete as the cheapest place to
patch the table without re-flowing it; boilerplate arrives from the template whether or not it
applies.

This yields a **principled map of where internal contradictions accumulate** — a divergence
roadmap derived from the industry's own process rather than from guesswork:

| Seam | Authoring cause | PIQC status |
|---|---|---|
| **SoA table ↔ assessment prose** | Different hands, late table edits | ✅ the current arc's D-classes — the detector is pointed at the highest-yield seam *first*, which this map confirms rather than assumes |
| **Footnotes ↔ cells they modify** | Footnotes as cheap patches | Deferred arc (D3 + footnote linkage) — second-highest yield, correctly sequenced |
| **Synopsis ↔ body** | Synopsis rewritten out-of-phase | Future seam — same two-readings machinery, new pair |
| **Eligibility ↔ scattered restatements** (footnotes, dosing sections) | Template reuse + patching | Future seam |
| **Amendment ↔ unchanged sections** | Prose-diff change management | N1's territory (cross-document), already in the spine |

The flagship's story sharpens accordingly: PIQC's divergence detection is not generic
"AI finds inconsistencies" — it is **pointed at the seams the industry's own authoring process
provably creates**, one seam per arc, cheapest and highest-yield first.

---

## 4. Product feedback — ranked, doctrine-filtered

Filtered through the spine (litmus, advisory-only, no wallpaper, additive, no re-parse). Each
item ends with its litmus check. Ranked by value × lift × how much the current trunk already
carries it.

### F1 — the why-chain: document-derived criticality (Law 1) — *highest leverage, nearest*

Extract the endpoint→assessment linkage the protocol itself states, and attach **why** to every
procedure: *"serves secondary endpoint E2 (§2.2, p.14)."* This upgrades the existing
`classification` enum (`primary_endpoint` / `safety_critical` — `ingestPipeline.ts:554-565`)
from a per-procedure LLM guess into a **cited chain**, and it gives every surface a
document-derived criticality signal: the worksheet's ORIENT bucket gains "what this serves," the
SOTR/auditor view gains grouping-by-criticality, and the Deliverable Engine's monitoring-focus
outputs gain a defensible ranking — all from the same trunk field. It also unlocks a deeper
divergence seam later (endpoint requires a measurement the SoA never schedules).
*Litmus:* clean — the chain is quoted from the document's own objectives/endpoints/assessment
sections; where the document doesn't state the linkage, PIQC stays silent (no inferred ancestry).

### F2 — the clock model: anchors, not day numbers (Law 2) — *deepest structural payoff*

Model each visit as **(anchor, offset, window)** instead of a required flat `study_day`. The
current schema's forced integer + the `isApproxDay` compensation hack are the single-clock
assumption leaking; an anchor model makes dose-delay rescheduling *computable* (shift one clock,
every dependent visit follows — with citations to the anchor definitions in the document) and
makes event-anchored visits (EOT, "within 7 days of X") first-class instead of faked. This is
Site Mode's calendar becoming *correct under reality* rather than correct under the happy path.
Real cost: a schema evolution with migration + type mirrors — not a slice, an arc.
*Litmus:* clean — anchors are stated in the document ("Cycle = 21 days," "within 30 days of last
dose"); PIQC computes only with stated arithmetic and cites the anchor's definition. Where no
anchor is stated, the visit stays flagged as unanchored — silence over inference.

### F3 — trajectory forks: the discontinuation pathway (Law 3)

Model the protocol's own forks: on discontinuation, which scheduled visits deactivate, what
(EOT visit, follow-up schedule) activates, within what window of the trigger. Rides the grid's
existing EOT/ED visibility + F2's event anchors. The participant-level "physics unlock": the SoA
is the field, the participant is the path.
*Litmus:* clean — the pathway is the document's own EOT/discontinuation sections, quoted.

### F4 — the seam map as the divergence roadmap (§3) — *free, adopt now*

Not a feature: a **sequencing principle**. Point each future divergence arc at the next authoring
seam (footnotes → synopsis↔body → eligibility restatements), in that order, because the
authoring process concentrates contradictions there. Zero build cost; it replaces guesswork in
roadmap decisions and sharpens the sales story ("we check the seams where protocols actually
break").
*Litmus:* n/a (internal prioritization) — outputs remain two-quote comparisons per the flagship
design.

### F5 — compiled latent programs: dose-mod tables as cited decision trees (Law 4) — *horizon*

Compile the document's own dose-modification tables into navigable, cited decision views — the
laminated cheat sheet, generated, version-true, and quoting every node. High value, genuinely
hard extraction (two-dimensional tables, row/col semantics), meaningful mis-compile risk — the
wrong-catch doctrine applies at full strength. Horizon item: after the footnote arc proves
cell-granularity linkage, this is the same muscle one level up.
*Litmus:* clean if and only if every node quotes the table cell; a paraphrased decision tree
would be the litmus violation this doctrine exists to prevent. Silence over summary.

### F6 — amendment impact projection (Law 5) — *connects existing pieces*

Project the version-diff onto participants and roles: which active participants are mid-schedule
in a changed region, which visits change for whom. N1 (cross-document divergence) supplies the
diff signal; F2's anchors supply "mid-Cycle 3"; Site Mode supplies the participant state. This is
stage-8 (amendment impact analysis) of the platform's own workflow map, grounded in the trunk.
*Litmus:* clean — both document versions are uploaded documents; participant state is the site's
own data; every changed item cites both versions (N1's existing shape).

**Recommendation:** adopt **F4 now** (it's a decision rule, not code), design **F1 next** (it
rides the current trunk and upgrades an existing field from guess to citation — the same
"recover what's already paid for" economics as this arc), hold **F2** as the first
*schema-bearing* arc after the flagship proves out (it is the biggest structural payoff and the
biggest cost — a founder-gated fork), and let **F3/F6** queue behind F2's anchors. **F5** waits
for the footnote arc's machinery.

---

## 5. What this changes about the current arc: almost nothing — deliberately

First-principles passes are dangerous when they reorder work that is already correctly ordered.
Check, explicitly:

- **Slices 1–4 unchanged.** Narrative recovery is the prerequisite for every idea above — F1
  attaches *why* to fields that must first exist; F2's windows ride recovered timing; the seam
  map's first seam *is* the current flagship. The build spec stands as written.
- **One reservation planted, no code:** the ontology's CLOCK bucket should be understood as
  *(anchor, offset, window)* with today's `study_day` as the degenerate single-anchor case — so
  F2, when it comes, is an evolution of the bucket rather than a re-design. One sentence of
  intent, zero schema now (the overengineering rule holds).
- **One confirmation gained:** the §10 universality contract (trunk + projections) is not an
  architectural taste — §1 shows it is the shape of the document class itself. The trunk
  investment is the product.

---

## 6. The one-sentence versions

- A protocol is one document serving five masters, and every reader is hand-decompiling their
  own projection — **PIQC is the projection compiler.**
- The industry's authoring process concentrates contradictions at known seams — **PIQC's
  divergence roadmap is that seam map, walked in order.**
- The document states its own why-chain, clocks, forks, and programs — **PIQC may use everything
  it knows to decide where to look, and only the document to decide what to say.**
