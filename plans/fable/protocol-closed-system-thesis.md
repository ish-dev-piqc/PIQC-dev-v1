# The Closed-Protocol Thesis — strict closure, locked

**Status:** doctrine — fork locked by founder 2026-07-20 (**strict closure**). Reopening the fork is a doctrine amendment to this document, decided by the founder — it does not drift open feature by feature.

**Founder's decision record (verbatim):** "I think strict closure. as PIQC only operates in the best drafting use case. so any flags should remain in a 'draft' status and allow the user to make the next move."

---

## The thesis in one sentence

A clinical protocol is a **semantically closed system** — it must deliver every requirement to its external executors using only its own words plus the external systems it explicitly names — and any requirement whose execution needs language from outside that closure is, by Quality by Design, a **design defect whose regulated remedy is an amendment**.

## The QbD syllogism

1. A protocol's job is to deliver **requirements** across a boundary to external executors — coordinator, CRA, investigator, lab.
2. By QbD, quality is built into the artifact, not inspected in afterward. The protocol's critical quality attribute is **unambiguous executability**: one reading, independent of who reads it.
3. Therefore the protocol must be **semantically self-sufficient** — meaning fixed by its own vocabulary. External language entering at execution time is an uncontrolled source of interpretive variability.
4. An uncontrolled variability source is a design defect; the regulated remedy for a design defect is an amendment (or its lighter confession, a clarification letter).

**Corollary (falsifiable):** every clarifying amendment is a confession that the prior version was not closed.

## Formal core

A protocol is a small language. Lexicon = Definitions + Abbreviations + named imports. Grammar = the Schedule of Activities and procedural logic that sequence those terms into requirements.

**Closure:** every requirement resolves to a single executable meaning using only (a) the protocol's own text and (b) the external systems it explicitly names. A term used in a requirement but defined nowhere reachable is a **free variable**. Closure = no free variables in the requirement set. A free variable is a closure leak; a closure leak is a latent amendment.

### Three import classes (the "standard of care" boundary, resolved)

Closure is about *self-sufficiency of resolution*, not *absence of reference* — so external references split three ways:

| Class | Example | Closure status | PIQC's read |
|---|---|---|---|
| **Versioned import** | "graded per CTCAE v5.0" | Closed — one resolvable target | Resolve through it; cite it |
| **Named-but-unversioned delegation** | "per institutional standard of care" | Declared open port — the protocol *chose* to delegate | Flag as informational: a delegation the sponsor made, not a defect PIQC found |
| **Ambient dependency** | "dose as appropriate," "clinically significant" (undefined) | Closure leak | Flag as defect: latent amendment |

PIQC never fills any of the three. It **classifies** them — and classification is meta-channel.

## The fork, and the lock

Two configurations of an LLM inside a closed system:

- **A — the conservative reader (PIQC).** Resolves each requirement using only the closed vocabulary, or detects that it can't and flags the free variable. Adds no meaning the protocol doesn't already entail. A conservative extension: it says nothing the closed system doesn't already say. The model's external knowledge is licensed only to *detect* gaps, never to *fill* them.
- **B — the knowledge importer (the anti-PIQC).** Faced with "dose as appropriate," helpfully supplies "typically this means X" — delivering the requirement in external words and *masking the closure defect*. The protocol needed an amendment; the model papered it over with fluent, plausible, un-cited meaning. A system that always produces an answer destroys the very signal that the document was under-specified.

**Locked: strict closure.** PIQC flags gaps; it never proposes resolutions — not even fenced "possible readings." Rationale: PIQC operates in the drafting use case, where the correct response to a gap is to **fix the protocol**, not to interpret around it; and every PIQC output is born a draft, so the human always makes the next move.

## The two laws

**The Closure Razor.** For every character PIQC emits about a requirement: *is this word already in the protocol, or in a system the protocol names?* If yes — PIQC is reading. If no — the word is legitimate only as a **flag describing an absence** (meta-channel), never as **supplied meaning** (object-channel). This is the LITMUS rule — cite the uploaded protocol, never an external norm; the bound is on output, not knowledge — derived from first principles.

**The channel invariant.** PIQC may add words *about* the protocol (meta-channel: flags, findings, briefs, worksheets) and never words *as* the protocol (object-channel: requirement meaning). The requirement's executable meaning remains a function of the closed vocabulary alone. It is the difference between a proof-checker that says "line 7 doesn't follow" (adds no axioms) and one that silently inserts the missing lemma (changes the theory).

## Why draft status is the fence that holds

The rejected configuration ("closure + fenced suggestions") depends on a **behavioral fence**: trusting the model, output by output, to keep meta from bleeding into object. Strict closure + born-in-draft moves the fence into the **product's state machine**: everything PIQC emits enters as `draft` — structurally non-authoritative — and only a human move can promote anything.

**You can't audit a model's restraint; you can audit a state machine.** That is what makes this thesis provable in PIQC rather than aspirational.

## Drafting time is the QbD moment

PIQC operates where closure defects are cheapest: while the document is in play as a draft — authoring, amendment cycles, pre-submission review. A free variable found at drafting time is an amendment avoided at execution time — found before a site trips on it in the middle of a visit.

**Positioning that falls out:** PIQC is an **amendment-detection engine**. Every flag is a candidate amendment or clarification letter, surfaced before the site surfaces it the hard way. (Substantial amendments are famously expensive and mostly unbudgeted; the industry's own literature says a large share are avoidable drafting defects.)

## The shipped product already obeys this — derivation, not legislation

The thesis retro-derives decisions already locked, which is the strongest evidence the axiom is right:

| Shipped doctrine | Thesis derivation |
|---|---|
| LITMUS: cite the uploaded protocol, never an external norm | The Closure Razor, verbatim |
| Cite-or-drop server gates (Finding Writer) | Mechanical closure enforcement at the output boundary |
| Site verdict NEVER LLM | Object-channel protection — a verdict is meaning, and meaning is never model-supplied |
| "PIQC drafted / flagged / found" attribution, never polish-stripped | Channel labeling — the words announce which channel they belong to |
| Advisory-only; earned write-back | Draft status: PIQC's authority terminates at the draft boundary |
| Semantic-gap answer: harvest the doc's own glossary; a miss costs coverage, never correctness | The closed lexicon + the conservative reader's failure asymmetry |
| Closed-world E6(R3) map (ISA findings) | A versioned import done correctly — the audit's named external system, enumerated rather than ambient |
| Footnote arc: precision gate on the LINK, not the classification | Resolution *within* the closed system — reading, not importing |

## What strict closure buys

- **Provability.** Every output is auditable against the protocol text alone. A reviewer can verify any PIQC claim without outside knowledge — completeness × tirelessness × provability now has a formal spine.
- **Failure asymmetry.** A PIQC miss costs coverage (a gap unflagged), never correctness (a wrong meaning executed). The catastrophic LLM failure mode — fluent meaning-supply — is defined out of the product, then triple-gated (Razor → cite-or-drop → draft status) in case it leaks.
- **Regulatory posture.** PIQC reads documents; it does not interpret medicine. Strict closure keeps the product on the document-QC side of the clinical-decision-support line. (Posture, not legal advice.)
- **Hallucination-proof by construction, not by mitigation.** A hallucination would have to survive the citation gate *and* the draft gate *and* the human's next move.

## What it costs — and the standing rule

The rushed reader who wants "just tell me what it means" goes unserved **by design**. Any future feature that wants PIQC to propose resolutions — fenced readings, suggested definitions, auto-drafted amendment language — is a **doctrine amendment to this document first**: brought to the founder, decided explicitly, recorded here. The fork is closed until reopened. The doctrine practices the QbD it preaches.

## Build implications — standing checks for every emitting surface

- **Audit Mode approvals (founder ruling, 2026-07-20):** an audit report is a GxP deliverable, but **PIQC is not generating a GxP deliverable** — it delivers a close-to-final draft that breaks the auditor's writer's block. In-PIQC "approval" is therefore a **readiness-to-export latch at the draft boundary**, never an attestation; the user's own QMS owns signatures. Integrity gates on approval exist to keep the latch honest (what exports = what the human marked ready), not to perform a signature ceremony.

- **Sponsor Ask / chat:** answers are citations + gap flags, never interpretations.
- **Narrative↔SoA divergence:** pure meta-channel — the protocol cited against itself. The flagship stays the flagship.
- **Finding Writer:** findings are meta-language under cite-or-drop; verdicts stay human.
- **Footnote / subordinate-instruction arc:** link resolution must trace entirely through protocol text; the precision gate on the link *is* the closure gate.
- **Any new emitter:** its design doc names which channel it writes to. If it can't say, it isn't ready to build.
