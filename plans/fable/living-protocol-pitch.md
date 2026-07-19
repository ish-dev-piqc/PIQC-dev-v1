# The Living Protocol

status: pitch draft (OUTPUT of the Fable pass; for founder review — not committed, not published)
brief: `plans/fable/living-protocol-pitch-BRIEF.md`
author: Fable (claude-fable-5), 2026-07-18
audience decision: written for the clinical-operations reader who lives the problem — the
site-network ops lead, the lead coordinator's boss, the sponsor clin-ops director — with the
investor reading over their shoulder. The re-ranking argument is in Part 4.

---

## Part 1 — The pitch

### The sharpest reader on your team

We watched a study coordinator upload a protocol into our product and get back something
genuinely useful: the full schedule of assessments, every procedure at every visit, laid out
clean. She looked at it. Then she opened the PDF again and started copying sentences out of it
by hand — the conditions, the windows, the instructions around each procedure — into a
worksheet she was building herself.

Separately, an auditor did the same thing. Same product, same protocol, same quiet return to
the document.

Neither of them complained. That's the part worth sitting with. Hand-extracting a protocol into
your own working documents is so normal in clinical research that nobody experiences it as a
failure. It's just the job. A coordinator preparing for a visit, a CRA building a monitoring
plan, an auditor checking consistency — all of them are doing the same thing: reading a long
document with their role in mind and manually pulling out their piece of it. Every site, every
study, every amendment, again.

We build software for clinical trials, and our own test for ourselves is blunt: if the product
isn't collapsing that load, it's failing that user. By that test, we had failed both of them.
The grid told them *what happens when* — and then stopped. Everything they needed to actually
execute or verify a visit stayed locked in the document.

So we went looking for why. What we found changed what we think this product is.

### It's a capacity gap, not a diligence gap

A clinical protocol is one document trying to serve five readers at once: the scientist who
needs a valid design, the regulator who needs a binding commitment, the site that needs an
instruction manual, the safety apparatus that needs bounded risk, and the participant who needs
an honest basis for consent. Each of them needs a different projection of the same underlying
truth — and the industry ships all five projections as a single block of linear prose.

So every reader decompiles their own version by hand. Not because they lack skill — these are
some of the most careful readers in any industry — but because no human can hold a hundred and
twenty pages in their head at once. You read page 84 with a memory of page 12, not with page 12.
That's not a diligence problem to be solved with more training and more checklists. It's a
capacity gap, and it has been mislabeled as a people problem for as long as trials have existed.

Here is the observation our whole thesis rests on: **at sufficient depth, reading and
self-auditing are the same act.** A reader thorough enough to hold the entire document at once
doesn't just understand it — they notice where it disagrees with itself. The window stated one
way in a table and another way in prose. The cohort named in the dosing section and defined
nowhere. The appendix that's referenced but doesn't exist. Humans reading at human capacity
can't see these reliably. A reader without that limit can.

That reader is what we're building. Not a smarter reader than your team — a **more complete**
one. It reads the whole protocol, every time, without fatigue, and it can prove what it read,
because every claim it makes carries the protocol's own words as evidence.

### Where the contradictions live

Protocols disagree with themselves in predictable places, because of how they're made. They're
assembled by committees under deadline, from template libraries, with the schedule table and
the assessment prose maintained by different hands at different stages. Late edits to the table
don't propagate back into the body text. Footnotes accrete as the cheapest way to patch a table
without re-flowing it. The synopsis is rewritten out of phase with the body.

Which means internal contradictions aren't scattered randomly through the document — they
concentrate at the seams where different hands maintained different statements of the same
fact. Grid versus prose. Footnote versus the cell it modifies. Synopsis versus body.
Eligibility criteria versus their restatements deeper in.

Checking those seams isn't fishing. It's looking where the fish are — a map of where protocols
break, derived from how protocols are written.

### What we found when we read our own pipeline

When we went to fix what the coordinator hit, we assumed we'd be building new extraction. We
weren't. The narrative context she was hand-copying — the per-procedure descriptions, the
conditional logic, the timing rules, the purpose of each visit — **our pipeline had already
read all of it.** A later processing step discarded it, then tried to re-attach it by matching
procedure labels, badly. We had already paid to read the very thing our users were reading by
hand. The work in front of us wasn't construction. It was recovery.

And the recovery pass practiced what we preach in a way we didn't plan. Cross-checking our own
pipeline against itself the way we claim to check protocols, we found two silent defects —
places where the system produced confident, wrong output with no signal at all. Finding them
required exactly the property we're selling: exhaustive comparison of a thing against itself.
We fixed them. We're telling you about them anyway, because a company selling rigorous reading
should be caught reading itself rigorously.

### Two readings of one protocol — and why disagreement is a gift

Recovering the narrative does something bigger than filling in worksheets. It gives the system
a **second, independent reading of the same protocol** — the prose's account alongside the
table's account. And once two readings of one document exist, disagreement between them stops
being noise. It becomes signal.

The narrative says vital signs at every visit; the grid doesn't mark visit three. The
narrative says a ±3-day window; the table header says ±2. The grid marks a procedure as
unconditional; the prose says "only if an adverse event occurred."

Every one of those, undetected, is a future protocol deviation — discovered after a visit was
executed wrong, written up, explained to a sponsor, filed. Detected at upload, it's an email:
the site asks the sponsor which reading governs, *before activation, before any participant is
affected*. The same finding, moved upstream, changes from a compliance event into a
clarification.

Three things make this the strongest idea we have:

- **It cites the protocol against itself.** Both sides of every comparison are the uploaded
  document's own words, quoted, with section and page. No external standard, no model opinion,
  no "best practice" is ever invoked.
- **It never adjudicates.** The system shows both passages side by side, states what it
  compared, and drafts the clarification question a human can send. It does not decide which
  reading is right, and it sends nothing, ever. Your team owns every judgment and every
  communication.
- **No human does this exhaustively — and that's not a criticism of humans.** Nobody
  cross-checks every narrative sentence against every grid cell; the combinatorics are
  inhuman. A tireless reader can. That is a capability claim, not a feature claim, and it's
  the difference between this and every document tool you've seen.

To be precise about where this stands: the schedule-of-assessments visualization, the cited
extraction, the visit worksheets, and protocol-grounded Q&A are in the product today. The
narrative recovery and divergence detection are the direction the platform is being built
toward — the diagnosis is proven and the machinery is designed, but we won't describe it to
you as shipped, because it isn't yet. We'd rather earn the claim than borrow it.

### The rule that makes this admissible

Everything above would be worthless in a regulated setting without one hard rule, so we made it
the constitution of the product:

> **The system only ever checks your protocol against your protocol — never against what it
> thinks a study like yours ought to contain.**

The operating form of the rule: **industry knowledge may choose the questions; only the
uploaded document may supply the answers.** The system is allowed to know that a 3+3
dose-escalation design entails dose-limiting-toxicity criteria — it uses that knowledge to know
*where to look*. But it may only flag the gap by citing your protocol's own commitment: "§3.1
commits to a 3+3 design; the DLT criteria that design refers to are not defined in this
document." What it may never do is hold your protocol up against an industry yardstick —
"studies like yours usually have a DSMB" — because the moment it does, you're trusting a
model's opinion instead of your document's text, and in a GxP environment that trust is not
yours to extend.

This bound is not a limitation we apologize for. It is the only posture in which an AI's
reading is *admissible* — every assertion inspectable by an auditor, every claim resolvable to
a quote, nothing resting on what the model believes about the world. And we hold it further
than citation: a correct quote attached to the wrong target is a citation-shaped failure —
provenance that survives inspection is worse than no provenance — so the discipline extends
down to anchoring every quote to the exact span it governs.

That discipline is also why this is hard to copy. A feature can be cloned in a quarter. A bound
that must be held in every pipeline stage, every surface, and every sentence of output — and
that is disqualifying to violate even once — is a company-level practice, not a checkbox.

### What this becomes

The dead PDF wakes up. The protocol stops being a document your team survives — read once,
hand-extracted, re-read under pressure — and becomes a living protocol: navigable by role,
answerable with citations, self-checked at every upload and every amendment, with your team's
judgment sitting on top of the deepest reading anyone has ever given the document.

**PIQC reads deep so your team reads shallow.** Not shallow in rigor — shallow in cost. The
depth is done, cited, and waiting; your people spend their attention on the judgments only they
can make.

If you run trials, you already employ the readers this is built for. We'd like to show you what
their protocol looks like when something tireless has read it first.

---

## Part 2 — The compression ladder

**One sentence.**
PIQC is the sharpest reader on your clinical-trial team: it reads the entire protocol every
time, notices where the document disagrees with itself, and proves every claim with the
protocol's own words — never with anyone's opinion.

**One paragraph.**
Every role in a clinical trial hand-extracts its own view of the protocol — coordinators build
worksheets, CRAs build monitoring plans, auditors build checklists — because no human can hold
a 120-page document whole. That's a capacity gap, not a diligence gap, and it's where
deviations are born: at sufficient depth, reading a protocol and auditing it are the same act,
because a reader who holds the whole document notices where it contradicts itself. PIQC is
that reader. It parses the protocol once into cited, confidence-scored structure; drafts the
role-specific views humans currently build by hand; and — as its readings deepen — surfaces
the places where the protocol's own table and its own prose disagree, quoting both sides, so
sites can ask the sponsor which reading governs before activation instead of explaining a
deviation after. It is bounded by constitution: industry knowledge may choose the questions,
but only the uploaded document may supply the answers — which is the only kind of AI reading a
GxP team is in a position to trust.

**One page.**

*The problem.* A protocol is one document serving five readers — scientist, regulator, site,
safety, participant — and it ships as linear prose. So every reader decompiles their own
projection by hand: the coordinator's worksheet, the CRA's monitoring plan, the auditor's
checklist. Skilled people re-derive the same document's meaning, role by role, site by site,
amendment by amendment. The failure isn't skill. No human holds 120 pages at once; humans read
page 84 with a memory of page 12. The industry has treated a capacity gap as a diligence
problem for decades.

*The insight.* At sufficient depth, reading and self-auditing are the same act. A reader who
holds the whole document notices where it disagrees with itself — the window stated two ways,
the cohort used but never defined, the referenced appendix that doesn't exist. And those
contradictions cluster predictably: protocols are written by committees, with tables and prose
maintained by different hands, so divergence concentrates at the authoring seams. A complete
reader checking those seams isn't fishing; it's looking where the fish are.

*The product.* PIQC parses the uploaded protocol once into structured, confidence-scored,
source-cited data — every extracted item traceable to quoted text, page, and section. From
that one parse it drafts what teams currently hand-build: visit-by-visit worksheets with
per-requirement traceability, role-filtered views, protocol-grounded Q&A that answers with the
cited passage beside it. Humans review, edit, and own everything; the system drafts and flags,
and decides nothing. The direction it's being built toward: recovering the protocol's own
narrative as a second independent reading, so that narrative-versus-grid disagreements surface
at upload — both passages quoted — and become sponsor clarifications instead of protocol
deviations.

*The moat.* One rule, held everywhere: the system checks your protocol only against your
protocol — never against what it thinks a study like yours should contain. Industry knowledge
chooses the questions; only the document supplies the answers. Every claim an auditor can
inspect, quote-anchored to the exact span it governs. In a regulated setting this bound isn't a
limitation — it's the only admissible posture for machine reading, and because it's a
discipline held across the whole system rather than a feature, it does not clone in a quarter.

*The line.* PIQC reads deep so your team reads shallow — the depth is done, cited, and
waiting; your people spend their attention on the judgments only they can make.

---

## Part 3 — The objection set

### "Isn't this just another PDF chatbot?"

A chatbot answers the questions you ask. The failure we watched wasn't unanswered questions —
it was questions nobody thought to ask. The coordinator didn't query her way into the ±2/±3
discrepancy; she didn't know it existed. Retrieval-and-answer tools are reactive by
construction: their ceiling is the user's own suspicion. A reader is proactive: it follows
every internal reference, tracks every commitment the document makes to itself, cross-checks
every fact stated twice, and raises its hand — with quotes — when something doesn't hold.

The other difference is the failure mode. A chatbot's characteristic failure is a confident
answer assembled from nowhere. Ours is designed to be the opposite: where the system can't
cite, it stays silent and *shows you* the silence as an explicit gap rather than papering over
it. You can build a chatbot in a weekend on any document. You cannot get "notices what you
didn't ask, and proves it" out of a chat loop, because that's not a chat capability — it's a
reading capability.

### "What happens when it's wrong?"

We designed for the wrong day, not the right one. Three layers:

First, posture: the system drafts and flags; it executes nothing, sends nothing, and decides
nothing. There is no path from a wrong output to a wrong action that doesn't pass through a
human reviewing a citation. Second, inspectability: every claim carries the protocol's own
quoted words, page and section attached — verification is one click, not an investigation.
Third, and most important, an asymmetry we hold deliberately: **silence over inference.**
Where the system's reading fails to bind, it says so visibly instead of guessing, because a
visible gap costs a human a moment while a confident wrong claim wearing a citation — a
citation-shaped failure — can survive inspection and do real harm. That failure class is the
one we engineer against hardest: precision-gated matching, deterministic checks that a
reviewer can re-derive, and quotes anchored to the exact spans they govern.

The honest version of this answer: none of that is a guarantee of correctness, and we won't
pretend otherwise. It's a posture in which errors are cheap to catch, safe by default, and
diagnosable when found — which is the standard human processes in this industry are held to,
and the right standard for machine reading too.

### "Why can't the incumbent EDC/CTMS vendor add this next quarter?"

Three reasons, in ascending order of difficulty.

Economics first: EDC and CTMS vendors are paid to capture and manage trial data *after* the
protocol has been interpreted. Reading sits upstream of their franchise; their roadmap
gravity, their sales motion, and their buyer all point at execution systems, not at the
interpretation layer those systems silently assume someone else has done.

Substrate second: divergence detection requires two independent readings of one document with
span-level provenance on both sides, coming out of a single parse that many role-views share.
That's a foundation you architect from the first table, not a feature you bolt onto a
records system. Retrofitting it means rebuilding the way every downstream surface consumes
protocol data.

Discipline third — and this is the real moat: the bound. "Only the uploaded document may
supply the answers" has to be held in every extraction step, every UI surface, every generated
sentence, forever. The natural way to add "AI" to an existing platform — a summarization
layer, an assistant with general knowledge — violates the bound on day one. And in a GxP
setting, violating it once in front of a QA reviewer isn't a bug report; it's the end of the
evaluation. Features clone in a quarter. Constitutional restraint, provable in every output,
does not.

### "Sites don't buy software. Why would anyone pay for reading?"

They already pay for reading — more than for almost anything else. They pay for it in
coordinator-hours spent hand-building worksheets, in CRA-hours re-deriving monitoring focus,
in deviations whose root cause traces to an ambiguous or self-contradicting passage nobody
caught before activation, and in the sponsor-relationship cost of explaining those deviations
afterward. The reading is currently purchased from the most expensive and least tireless
vendor available: their own staff, at the edge of capacity.

We're also not asking sites to adopt a new process. The wedge is an artifact they already make
— the visit worksheet the coordinator was building by hand when we watched her. The product's
first job is to hand back hours on work that already exists, not to add a workflow. And the
site is the first buyer, not the only one: the same single reading projects into sponsor
deliverables and audit preparation, which is where the platform economics compound — one
parse, many surfaces, each one a document someone today builds manually.

---

## Part 4 — Audience cuts

**The re-rank, first:** the primary artifact should be written for the **clinical-operations
reader** — site-network leadership, lead coordinators' managers, sponsor clin-ops — not the
investor. Three reasons. The proof material is operations-shaped: our strongest evidence is a
coordinator and an auditor doing something every ops reader has personally done, and that
recognition does more persuasive work in one paragraph than any market framing. Second, the
strongest material needs no availability claims when aimed at this reader — conviction about
the problem lands on someone who lives the problem. Third, investors are watchers of buyers:
an investor believes a category exists when they see a practitioner nod at the problem
statement. Write the piece that makes the practitioner nod; show the investor the practitioner.

**For the site / sponsor operations reader (the primary — Part 1 as written).** Lead with the
observed failure and the worksheet. Translate all physics into consequence ("the table says ±2,
the prose says ±3, and you find out at the visit"). Never use internal abstractions —
"projection compiler" does not appear; its meaning is delivered as "the views your team builds
by hand, drafted for review." Keep the deviation-versus-clarification contrast doing the
emotional work: this reader has written deviation reports and would rather not.

**For the investor.** Re-lead with the category and the shape of the market: regulated
industries run on documents no human can hold whole, and clinical protocols are the highest-
stakes instance; the interpretation layer between protocol and execution systems has never
been a product. Here "one document, five masters, every reader hand-decompiles their own
projection — PIQC is the compiler" earns its keep as the category-defining abstraction. The
moat section leads with the discipline argument (why incumbents structurally can't follow) and
the platform economics (one parse, many billable surfaces; site-first entry, sponsor-side
expansion). Why-now: machine reading finally has the depth, and the bound is what converts
that depth into something a regulated buyer may legally trust. The observed failure shrinks to
one paragraph of evidence; direction-versus-live framing stays exactly as restrained, because
investors diligence claims.

**For the internal team.** Not persuasion — doctrine. This is the only cut where the spine is
quoted directly as law: the litmus test on every output; silence over inference; the
citation-shaped-failure standard (a right quote on a wrong target is a violation, not a
near-miss); deterministic before generative; drafts-and-flags, never decides. The pitch's
narrative becomes the *why* behind rules the team already builds under, so that the discipline
reads as identity rather than compliance. The validation-failure story is told with full
internal candor — including that the product shipped confident wrong output silently — because
internally, that story is the strongest argument for why the rules exist.

---

## The three closers

### 1. If forced to make the argument with exactly one proof point

**The observed validation failure plus its diagnosis: two real users, independently, went back
into the PDF — and when we traced why, we found the product had already extracted what they
were hand-copying, then discarded it.**

Not the divergence flagship, and it costs something to say that, because the flagship is the
better story. But the flagship's evidence is a design proven against fixtures on an unmerged
branch — as a *proof point* it borrows availability it doesn't yet have, and one skeptical
"show me a live run" collapses it. The validation failure is invulnerable: it happened, we
watched it, it requires no availability claim, and it carries its own self-critical
credibility — we open by telling you where our own product failed and what that taught us.
Everything else in the pitch — the capacity gap, the seams, the two readings — unfolds from
that one observation as reasoning, and reasoning doesn't need shipping dates. The flagship
survives in the pitch as direction; the proof is the failure and the recovery.

### 2. What I think the brief gets wrong

- **"The strongest thing in the arsenal" (§2.4) conflates the strength of the idea with the
  strength of the evidence.** Divergence detection is the strongest *idea* in the arsenal; the
  strongest *evidence* is the observed failure and the extracted-then-discarded diagnosis. A
  pitch built with the flagship as its load-bearing proof would be one hostile question away
  from an availability apology. The brief gestures at this in the caged spine ("strongest as
  conviction about the problem") but under-flags that this decides the entire architecture of
  the pitch — the flagship must be framed as where the proven diagnosis *points*, not as what
  the product *does*. That's how Part 1 is built.
- **The thesis line's "with equal depth" is a claim that invites its own falsification.**
  Universality is by-construction for the self-comparison spine (any document can be checked
  against itself), but reading-lens quality genuinely varies by therapeutic area today, and
  "equal depth" hands a diligent buyer an easy test to design ("prove CGT depth equals
  oncology depth"). I wrote "the same discipline in every therapeutic area" instead — the
  bound and the mechanism are what's universal; depth of area coverage is progressive. Same
  conviction, no free ammunition.
- **The dogfooding argument (§2.3) survives only at two sentences, fused into the diagnosis
  story.** As its own section it's navel-gazing, as the brief suspects — but the brief
  under-names the sharper risk: the story concedes that our shipped pipeline produced
  confident, silent, wrong output, which is precisely the ammunition for the "what happens
  when it's wrong" objection. Told in one breath with its fix, in first person, it converts
  into credibility; given its own stage, it arms the skeptic. Two sentences is not a style
  choice — it's the safe dosage.
- **"Projection compiler" is internally true and externally cold — for the primary
  audience.** For an ops reader, "compiler" explains nothing they feel. It earns its place in
  the investor cut, where category abstraction is the job. The brief offers the frame without
  routing it; it needed routing.
- **The voltage formula ("completeness × tirelessness × provability") shouldn't appear as a
  formula anywhere external.** It's a fine internal mnemonic and it silently structures the
  pitch's thesis section, but written as multiplication it reads as slideware, and this pitch's
  authority rests on sounding like none of that.

### 3. Questions that need a founder decision

1. **Where does this artifact live?** A website essay (public, indexed, referenced by the
   site's Founder Intent section), a private memo (sent to specific readers), or the spine of
   a deck. This decides length discipline, CTA, and how much of the validation-failure story
   is tellable — I wrote it as a document that could become any of the three, but it should
   become one of them deliberately.
2. **May the validation failure be told publicly?** It's the strongest material in the piece
   and it's a story about our own product falling short for real users. I believe telling it
   is a strength (it's the earned-conviction voice at full power), but it describes real
   usage by real people and concedes a real shortcoming — publishing it is a founder call,
   not a writer call.
3. **Is "The Living Protocol" the public category name, or the internal codename?** The pitch
   currently leads with "the sharpest reader on your team" and lands "living protocol" late,
   as the destination image. If the category is to be *named* Living Protocol publicly, the
   pitch should open with it and build toward it instead. One of these should be chosen; the
   current draft hedges toward reader-first.
4. **What is the ask?** The close is deliberately CTA-light ("we'd like to show you what
   their protocol looks like when something tireless has read it first") because the real ask
   depends on a commercial decision: demo requests, a named design-partner program for the
   narrative-first work, or simply a conversation. The strongest version of this pitch ends
   on a specific ask; I couldn't supply it without deciding commercial posture for you.
5. **Which audience cut ships first?** My re-rank says ops-reader primary — but that assumes
   the near-term goal is buyer belief rather than a raise. If a raise is the actual next
   milestone, the investor cut should be built out first from Part 4's skeleton, and the
   primary becomes the appendix that proves practitioner resonance.
