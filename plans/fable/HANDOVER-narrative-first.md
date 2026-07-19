# Handover — `fable/narrative-first` (test branch, not a merge target)

**To:** Ishika · **Date:** 2026-07-18
**Branch:** `fable/narrative-first` (pushed to origin, merged up to `origin/main` as of #492)
**Ask in one line:** I need a **re-ingest of protocol data we already have**, in an isolated
environment, so I can actually *see* this working before we decide whether any of it belongs on main.

---

## Why this branch exists

In the last user-validation run, both the coordinator and the auditor hit the same wall: after
uploading a protocol, PIQC gave them the **SoA visualization and nothing else** — so they went back
into the PDF and hand-copied the narrative context (procedure descriptions, windows, conditional
logic) into their own worksheets.

That's the core promise inverting into extra work, so I had a design pass done on it and then built
the result here as a proving ground. **Nothing here is proposed for main yet.** I want your read on
it, and I want to see it run on real data first.

---

## What we found (the part you'll care about most)

The narrative isn't missing from the pipeline. **It's extracted, then discarded.**

`CLINICAL_EXTRACT_SCHEMA` already captures `visit_purpose`, per-procedure `description`,
`conditions[]`, `timing`, and `cross_references[]`. Then the deterministic grid assembly overwrites
`schedule_of_events` wholesale, and `enrichScheduleFromLlm` tries to re-attach that narrative by
matching procedure labels — with two defects:

1. **Global first-wins map.** The label map was keyed across *all* visits, so a procedure appearing
   at several visits inherited the **first visit's** conditions and timing. Narrative silently
   attached to the wrong visit — wrong instructions, no signal.
2. **`normLabel` strips parentheticals.** So "Pregnancy test (serum)" and "Pregnancy test (urine)"
   collapse to the same key today, and first-wins picks one silently. The "exact" matcher was
   already lossy, in the dangerous direction.

Both are live on main right now. That's the main thing I wanted you to see regardless of what
happens to this branch.

---

## What's in the branch

Two code commits on top of the design docs.

**`6e4b6dd` — narrative recovery**
- `enrichScheduleFromLlm` rebuilt: binds per-visit on aligned visits (shared `normalizeVisitName`,
  exact non-approximate `study_day` fallback); a field only binds *globally* when its value is
  identical across every occurrence of that label; paren-stripped matching survives only behind a
  uniqueness gate on both sides. Ambiguity → **no bind + a flag**, never a guess.
- Recovers `visit_purpose` and `cross_references` through the overwrite. Side effect worth noting:
  a recovered purpose short-circuits the per-visit `generateVisitPurpose` LLM call via the existing
  quality floor — fewer OpenAI calls per ingest.
- Recovers the ±window when the grid header stated none. A **nonzero** grid window is never
  touched — if the two readings disagree there, that's a finding, not a fix.
- Writes a `_narrative_recovery` record onto `extracted_fields` (same pattern as
  `_cohort_reconciliation`): what bound, what didn't, and whether a candidate existed. Silent loss
  becomes countable loss.
- VEW: description promoted to a readable line, conditions chip previews the actual condition text,
  unbound rows say so explicitly, plus a completeness strip.

**`47e88e1` — narrative↔SoA divergence detection**
- New table `protocol_divergences` (migration `20260726000000`) + detector in
  `supabase/functions/_shared/narrativeDivergence.ts`.
- Because recovery gives us a *second independent reading* of the same protocol, disagreement
  between the two is signal. v1 detects window mismatches, cohort-scope divergence, and
  one-directional presence gaps. Deterministic — no LLM judges divergence.
- PIQC shows **both quotes side by side and never adjudicates**. It drafts a clarification query the
  coordinator can send to the sponsor; PIQC never sends anything.
- Lifecycle: `open → raised_with_sponsor → resolved/dismissed`, append-only dispositions.

**Docs:** `plans/fable/narrative-first-worksheet-spec.md` is the real spec if you want the reasoning —
including a section on what the design brief got *wrong*.

Tests: **1420 passing, `tsc` clean**, merged up to current main.

---

## What I need from you

**The recovery only takes effect at ingest time.** Existing rows in the DB are untouched by design —
we're not re-parsing the corpus. So until a protocol goes through the patched edge function, the
narrative fields stay empty and the worksheet looks basically like it does today. I can't eyeball
this into existence.

So, concretely:

1. **An isolated Supabase project** — not prod, not the shared dev DB. This branch adds a table and
   changes ingest behavior, and I don't want either near real data while it's unproven.
2. **Apply** `supabase/migrations/20260726000000_protocol_divergences.sql`.
3. **Deploy this branch's edge functions** there (the ingest function is what matters).
4. **Re-ingest 2–3 protocols we already have** — the seeded demo set is ideal, and EFC14833 from
   your #492 just landed here in the merge. Old protocol data is exactly right: I want to see what
   recovery does against documents we already understand.

**One question for you before we spend anything:** re-ingest re-runs the Reducto parse+extract,
which costs money on protocols we've already paid to parse. Is there a path to re-run the
**post-parse steps against cached Reducto output**, or do we eat the parse cost per test protocol?
You know that pipeline better than I do. If we have to pay, I'd rather do two protocols than five.

---

## What I'll be looking at

- Does narrative actually populate, or does "no narrative found" appear everywhere?
- What `_narrative_recovery` says — the unbound count is the honest measure of whether the matcher
  is too strict. If it's high, I'd rather know now.
- Whether divergence fires at all, and if it does, whether the finding is a **real** contradiction
  or a false alarm. One false positive on a real protocol tells me more than the whole test suite.

---

## What's still unproven / not done

- **Zero runs against live data.** Every test is fixtures or golden files.
- **Coverage is deliberately conservative.** I chose stricter matching over fuzzy matching, so
  recovery will bind *less* than a loose matcher would — the misses are visible in the reconcile
  record instead of silently wrong. Reversible if the numbers say so.
- **Event-anchored visits still display an invented "Day N."** The parser now flags visits whose day
  is a synthetic sort anchor (EOT/ED/LTFU have no protocol-stated day), but plumbing that flag to
  the UI needs a column on `protocol_visit_templates` + the workspace RPC — your lane and Roger's,
  so I left it alone rather than sneak schema in.
- **Footnote→cell linkage untouched** — still its own arc.
- **No SOTR/auditor surface yet.** The divergence records are mode-agnostic and the protocol-wide
  review view is arguably the more natural home for them, but I didn't build into your area without
  talking to you first.

---

## What I'm asking of you, in order

1. Skim the diff and tell me if anything is structurally wrong — especially the ingest changes.
2. Tell me the answer on cached-parse vs. paying Reducto again.
3. Help me get the isolated environment stood up so I can look at it.

Then we decide together what, if anything, graduates to main. The two matcher bugs are worth fixing
on main regardless of what happens to the rest of this.
