// =============================================================================
// Narrative ↔ SoA-grid divergence detection (narrative-first spec §5.5).
//
// Narrative recovery gives PIQC a second, independent reading of the same
// protocol. Once both readings exist, DISAGREEMENT between them is signal:
// the protocol cited against itself. Litmus-clean by construction — both sides
// derive from the uploaded document; no external norm anywhere.
//
// v1 classes (deterministic comparators only — every finding re-derivable):
//   window_mismatch  both readings state a nonzero ±window and any component
//                    differs. Grid 0/0 = the header stated none (parser
//                    default); LLM 0 = stated none (schema instruction) —
//                    0-vs-N is an ABSENCE question and never fires here.
//   presence         ONE-DIRECTIONAL: the narrative lists a procedure at an
//                    aligned visit; the grid knows that procedure SOMEWHERE
//                    (same closed vocabulary) but does not mark it at that
//                    visit. The reverse direction never fires — the extract is
//                    known-incomplete, so narrative absence is evidence of
//                    nothing. A label the grid has nowhere is granularity by
//                    construction, silent by design. A sibling variant marked
//                    at the visit (same paren-stripped key) also silences it.
//   cohort_scope     the divergence-shaped subset of the cohort reconcile
//                    notes (orphan schedule refs / prose cohorts with no
//                    schedule coverage), promoted into closable records.
//
// Runs AFTER enrichScheduleFromLlm: E1 window recovery only fills grid 0/0
// (single-reading case → nothing left to compare) and never touches a nonzero
// grid window — so recovery cannot mask a real window disagreement.
//
// Wording: every `detail` states WHAT WAS COMPARED and asserts no verdict.
// Pure (no I/O), vitest-importable. Persistence lives in ingestPipeline (5a2).
// =============================================================================

import {
  alignGridVisitToLlm,
  indexLlmScheduleVisits,
  normLabelFull,
  normLabelLoose,
  type ScheduleOfEventsItem,
} from "./soaGridParser.ts";

export type DivergenceClass = "window_mismatch" | "presence" | "cohort_scope";

export interface DivergenceReading {
  source: "soa_grid" | "narrative";
  /** Quotable text for this reading. verbatim=true → protocol text as parsed
   * (e.g. the SoA column header); verbatim=false → an extraction-recorded
   * value, honestly labeled as such (the extract stores integers, not prose). */
  quote: string;
  verbatim: boolean;
  section: string | null;
  page: number | null;
}

export interface DetectedDivergence {
  class: DivergenceClass;
  /** Stable per-protocol locus key — the upsert identity across re-ingests. */
  locus_key: string;
  visit_name: string | null;
  procedure_label: string | null;
  reading_a: DivergenceReading; // the grid reading
  reading_b: DivergenceReading; // the narrative reading
  /** What was compared — never a verdict. */
  detail: string;
}

function fmtWindow(minus: number, plus: number): string {
  return (minus === plus ? `±${minus}` : `−${minus}/+${plus}`) + " day(s)";
}

function numOrZero(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? Math.max(0, Math.trunc(v)) : 0;
}

export function detectNarrativeGridDivergences(
  gridSchedule: readonly ScheduleOfEventsItem[],
  llmSchedule: unknown,
  cohortReconcileNotes: readonly string[] = [],
): DetectedDivergence[] {
  const out: DetectedDivergence[] = [];
  const idx = indexLlmScheduleVisits(llmSchedule);

  // The grid's closed-world vocabulary: label key → visit names where marked.
  // Presence can only fire INSIDE this vocabulary — a narrative label the grid
  // has nowhere is the narrative describing what the grid doesn't itemize.
  const gridVocab = new Map<string, string[]>();
  for (const v of gridSchedule) {
    for (const p of v.procedures_structured) {
      const k = normLabelFull(p.label);
      if (!k) continue;
      const l = gridVocab.get(k);
      if (l) l.push(v.visit_name);
      else gridVocab.set(k, [v.visit_name]);
    }
  }

  if (idx.entries.length > 0) {
    for (const visit of gridSchedule) {
      const aligned = alignGridVisitToLlm(visit, idx);
      if (!aligned) continue;
      const raw = aligned.raw;
      const headerQuote = visit.source_header ?? visit.visit_name;

      // ---- window_mismatch ------------------------------------------------
      const gm = visit.window_minus_days;
      const gp = visit.window_plus_days;
      const lm = numOrZero(raw.window_minus_days);
      const lp = numOrZero(raw.window_plus_days);
      if ((gm > 0 || gp > 0) && (lm > 0 || lp > 0) && (gm !== lm || gp !== lp)) {
        out.push({
          class: "window_mismatch",
          locus_key: `w:${normLabelFull(visit.visit_name)}`,
          visit_name: visit.visit_name,
          procedure_label: null,
          reading_a: {
            source: "soa_grid",
            quote: headerQuote,
            verbatim: true,
            section: "Schedule of Assessments",
            page: null,
          },
          reading_b: {
            source: "narrative",
            quote: `extraction recorded a ${fmtWindow(lm, lp)} scheduling window for this visit`,
            verbatim: false,
            section: null,
            page: null,
          },
          detail:
            `Two readings of ${visit.visit_name}'s scheduling window differ: the SoA column header ` +
            `(“${headerQuote}”) parses to ${fmtWindow(gm, gp)}; the narrative extraction recorded ` +
            `${fmtWindow(lm, lp)}. Both derive from this protocol — verify which governs before scheduling.`,
        });
      }

      // ---- presence (one-directional) -------------------------------------
      const gridHereFull = new Set<string>();
      const gridHereLoose = new Set<string>();
      for (const p of visit.procedures_structured) {
        const fk = normLabelFull(p.label);
        if (fk) gridHereFull.add(fk);
        const lk = normLabelLoose(p.label);
        if (lk) gridHereLoose.add(lk);
      }
      const seenLlmKeys = new Set<string>();
      for (const rec of aligned.procs) {
        const label = String(rec.label);
        const k = normLabelFull(label);
        if (!k || seenLlmKeys.has(k)) continue;
        seenLlmKeys.add(k);
        if (gridHereFull.has(k)) continue; // marked here — no divergence
        const loose = normLabelLoose(label);
        if (loose && gridHereLoose.has(loose)) continue; // a sibling variant is marked here → granularity, silent
        const elsewhere = gridVocab.get(k);
        if (!elsewhere || elsewhere.length === 0) continue; // grid has it nowhere → granularity, silent
        out.push({
          class: "presence",
          locus_key: `p:${normLabelFull(visit.visit_name)}:${k}`,
          visit_name: visit.visit_name,
          procedure_label: label,
          reading_a: {
            source: "soa_grid",
            quote: headerQuote,
            verbatim: true,
            section: "Schedule of Assessments",
            page: null,
          },
          reading_b: {
            source: "narrative",
            quote: label,
            verbatim: false,
            section: null,
            page: null,
          },
          detail:
            `The narrative extraction lists “${label}” at ${visit.visit_name}, but the SoA column does ` +
            `not mark it there. The grid does mark this procedure at ${elsewhere.length} other ` +
            `visit(s) (e.g. ${elsewhere[0]}), so both readings use the same vocabulary. Verify against ` +
            `the protocol whether it is required at this visit.`,
        });
      }
    }
  }

  // ---- cohort_scope: promote the divergence-shaped reconcile notes ---------
  // Included: orphan schedule refs (grid scopes to a cohort the prose never
  // defines) and prose cohorts with no schedule coverage. Excluded: citation
  // gaps and prose-count mismatches — those are extraction-quality findings,
  // not narrative↔grid divergence.
  for (const note of cohortReconcileNotes) {
    if (!/schedule references|no schedule coverage/i.test(note)) continue;
    out.push({
      class: "cohort_scope",
      locus_key: `c:${note.toLowerCase().replace(/\s+/g, " ").trim().slice(0, 180)}`,
      visit_name: null,
      procedure_label: null,
      reading_a: {
        source: "soa_grid",
        quote: "SoA cohort scoping (per-visit applies_to, derived from table headings)",
        verbatim: false,
        section: "Schedule of Assessments",
        page: null,
      },
      reading_b: {
        source: "narrative",
        quote: "protocol cohort definitions (body-text extraction)",
        verbatim: false,
        section: null,
        page: null,
      },
      detail: `${note}. The SoA's cohort scoping and the protocol's own cohort definitions disagree — verify against the protocol.`,
    });
  }

  return out;
}
