import { describe, it, expect } from "vitest";
import {
  parseSoaGrid,
  parseVisitHeader,
  classifyMark,
  gridToScheduleOfEvents,
  enrichScheduleFromLlm,
  evaluateSoaGate,
  extractRawColumns,
  assembleVisitsFromGrouping,
  deriveStudyDay,
  cohortOnlyRestriction,
  cohortsFromTableHeading,
  markerCohortScope,
  leadingCohortToken,
  type TableBlock,
} from "../soaGridParser.ts";
// Golden fixture: the real Schedule-of-Assessments table blocks Reducto returned
// for PP06489 (39814_Protocol_V5.0.pdf, pages 53–61). Verbatim, PDF-verified.
import pledoxTables from "./fixtures/pledox_soa_tables.json";

const TABLES = pledoxTables as TableBlock[];

describe("classifyMark", () => {
  it("classifies the four cell states", () => {
    expect(classifyMark("X ").mark).toBe("marked");
    expect(classifyMark("✓").mark).toBe("marked");
    expect(classifyMark("").mark).toBe("empty");
    expect(classifyMark("(X)").mark).toBe("conditional");
    expect(classifyMark("(X)10").mark).toBe("conditional"); // footnote ref, not a note
    expect(classifyMark("(X)10").note).toBeNull();
    expect(classifyMark("maybe later").mark).toBe("uncertain"); // never silently dropped
  });

  it("keeps a real timing note but drops a bare footnote number", () => {
    expect(classifyMark("X before IMP infusion").note).toBe("before IMP infusion");
    expect(classifyMark("X 7").note).toBeNull();
  });
});

describe("parseVisitHeader", () => {
  it("prefers the Week timeline anchor over the intra-cycle Day", () => {
    const h = parseVisitHeader("Treatment Visit 5 Day 1, Cycle 5 Week 8");
    expect(h.visit_name).toBe("Treatment Visit 5");
    expect(h.study_day).toBe(56); // Week 8, not Day 1
  });

  it("corrects a footnote-glued month number (Month 6¹¹ → Month 6)", () => {
    const h = parseVisitHeader("Assessment Visit Month 611");
    expect(h.visit_name).toBe("Assessment Visit Month 6");
    expect(h.study_day).toBe(180);
    expect(h.footnoteCapped).toBe(true);
  });

  it("derives screening / EOT scheduling from header text", () => {
    expect(parseVisitHeader("Screening ≤28 days prior to start of IMP").study_day).toBe(-28);
    const eot = parseVisitHeader("EOT Visit Day 14 (± 3 days), Cycle 12");
    expect(eot.visit_name).toBe("EOT Visit");
    expect(eot.study_day).toBe(14);
    expect(eot.window_plus_days).toBe(3);
  });
});

describe("parseSoaGrid — golden file (PP06489)", () => {
  const result = parseSoaGrid(TABLES);

  it("extracts all 21 distinct visits, none duplicated", () => {
    expect(result.visits).toHaveLength(21);
    const names = result.visits.map((v) => v.visit_name);
    expect(new Set(names).size).toBe(21); // no duplicate visit identity
    // every named visit the PDF schedule contains
    for (const expected of [
      "Screening", "Randomization", "EOT Visit", "EOS Visit",
      "Treatment Visit 1", "Treatment Visit 7", "Treatment Visit 12",
      "Assessment Visit Month 3", "Assessment Visit Month 6",
      "Assessment Visit Month 9", "Assessment Visit Month 12", "Assessment Visit Month 18",
    ]) {
      expect(names, `missing ${expected}`).toContain(expected);
    }
  });

  it("is self-consistent — every mark-bearing cell is accounted for", () => {
    expect(result.guards.soaTablesFound).toBe(9);
    expect(result.guards.nonSoaTablesSkipped).toBe(0);
    expect(result.guards.unresolvedSpans).toBe(0);
    expect(result.guards.emittedMarkCount).toBe(result.guards.rawMarkCount);
    expect(result.guards.lowConfidence).toBe(false);
  });

  it("gives each visit its own verbatim checklist (Screening, exact)", () => {
    const screening = result.visits.find((v) => v.visit_name === "Screening")!;
    expect(screening.procedures.map((p) => p.label)).toEqual([
      "Informed Consent",
      "CT/MRI Scan and Disease Assessment",
      "CEA",
      "Medical History and Prior Medication",
      "Physical Examination (per standard of care)",
      "Vital Signs (all Visits) and Weight (only for Treatment Visits)",
      "ECOG Performance Status",
      "Pregnancy Test",
      "Demographics",
      "Hematology",
      "Biochemistry",
      "Blood Mn",
      "ECG",
      "Cold Sensitivity Patient Questionnaire (Paper Diary)",
    ]);
  });

  it("matches the per-visit counts validated against the PDF cells", () => {
    const count = (n: string) => result.visits.find((v) => v.visit_name === n)!.procedures.length;
    expect(count("Screening")).toBe(14);
    expect(count("Treatment Visit 5")).toBe(13);
    expect(count("EOT Visit")).toBe(16);
  });

  it("keeps conditional (X) procedures flagged, never dropped", () => {
    const conditional = result.visits.flatMap((v) =>
      v.procedures.filter((p) => p.mark === "conditional").map((p) => p.label),
    );
    expect(conditional.length).toBeGreaterThan(0);
    expect(conditional.every((l) => /MRI of CNS/i.test(l))).toBe(true);
  });

  it("strips footnote superscripts and rejoins soft-wrapped words in labels", () => {
    for (const v of result.visits) {
      for (const p of v.procedures) {
        expect(p.label, `superscript in "${p.label}"`).not.toMatch(/[ª²³¹º⁰-⁹]/);
        expect(p.label, `soft-wrap in "${p.label}"`).not.toMatch(/[a-z]-\s/);
        // no header/scheduling text leaked in as a procedure
        expect(p.label).not.toMatch(/^(visit|day|cycle|week|month|assessment)\b|window/i);
      }
    }
  });

  it("captures per-cell timing notes (e.g. before IMP infusion)", () => {
    const withNotes = result.visits.flatMap((v) => v.procedures.filter((p) => p.note));
    expect(withNotes.length).toBeGreaterThan(20);
    expect(withNotes.some((p) => /before IMP infusion/i.test(p.note!))).toBe(true);
  });
});

describe("gridToScheduleOfEvents (golden file)", () => {
  const { visits } = parseSoaGrid(TABLES);
  const { schedule, citations } = gridToScheduleOfEvents(visits);

  it("emits one schedule entry per visit, in the downstream shape", () => {
    expect(schedule).toHaveLength(visits.length);
    const screening = schedule.find((s) => s.visit_name === "Screening")!;
    expect(screening.procedures).toContain("Informed Consent");
    // marked procedures emit classification=null so buildPersistPayloadForVisit's
    // assignClassification heuristic can derive required/safety_critical/endpoint
    // from the label (emitting "required" here would short-circuit that).
    expect(screening.procedures_structured[0]).toMatchObject({
      label: "Informed Consent",
      classification: null,
      protocol_section: "Schedule of Assessments",
    });
  });

  it("marks conditional (X) procedures classification=conditional, everything else null", () => {
    const all = schedule.flatMap((s) => s.procedures_structured);
    const cond = all.filter((p) => p.classification === "conditional");
    expect(cond.length).toBeGreaterThan(0);
    expect(cond.every((p) => /MRI of CNS/i.test(p.label))).toBe(true);
    // no marked procedure is hardcoded to "required"
    expect(all.every((p) => p.classification === "conditional" || p.classification === null)).toBe(true);
  });

  it("orders visits by protocol column sequence — EOT after the treatment visits, not at day 14", () => {
    const order = schedule.map((s) => s.visit_name);
    const idx = (n: string) => order.indexOf(n);
    // column_order is a strict 0..N-1 protocol sequence
    expect(schedule.map((s) => s.column_order)).toEqual(schedule.map((_, i) => i).sort((a, b) => a - b));
    expect(idx("Screening")).toBeLessThan(idx("Treatment Visit 1"));
    expect(idx("Treatment Visit 12")).toBeLessThan(idx("EOT Visit")); // EOT after all TVs (study_day=14 would mis-sort it)
    expect(idx("Treatment Visit 1")).toBeLessThan(idx("Treatment Visit 12"));
  });

  it("emits a high-confidence SoA-page citation for every visit", () => {
    expect(citations).toHaveLength(schedule.length);
    const idx = schedule.findIndex((s) => s.visit_name === "Screening");
    expect(citations[idx].section).toBe("Schedule of Assessments");
    expect(citations[idx].pages.length).toBeGreaterThan(0);
    expect(citations.every((c) => c.confidence === "high")).toBe(true); // deterministic parse
  });
});

describe("enrichScheduleFromLlm", () => {
  it("recovers role_hint / conditions / timing the grid can't see, by label match", () => {
    const { schedule } = gridToScheduleOfEvents(parseSoaGrid(TABLES).visits);
    const llm = [
      {
        procedures_structured: [
          { label: "Hematology", role_hint: "Lab", conditions: [{ condition_text: "x", consequence_text: "y" }] },
          { label: "ECG", role_hint: "Nurse", timing: { label: "pre-dose" } },
        ],
      },
    ];
    const n = enrichScheduleFromLlm(schedule, llm);
    expect(n).toBeGreaterThan(0);
    const hema = schedule.flatMap((s) => s.procedures_structured).find((p) => p.label === "Hematology");
    expect(hema?.role_hint).toBe("Lab");
    expect((hema?.conditions as unknown[]).length).toBe(1);
    const ecg = schedule.flatMap((s) => s.procedures_structured).find((p) => p.label === "ECG");
    expect(ecg?.role_hint).toBe("Nurse");
    expect(ecg?.timing).toMatchObject({ label: "pre-dose" });
  });

  it("does not overwrite a value the grid already set, and is a no-op with no LLM data", () => {
    const { schedule } = gridToScheduleOfEvents(parseSoaGrid(TABLES).visits);
    schedule[0].procedures_structured[0].role_hint = "Coordinator";
    enrichScheduleFromLlm(schedule, [{ procedures_structured: [{ label: schedule[0].procedures_structured[0].label, role_hint: "Lab" }] }]);
    expect(schedule[0].procedures_structured[0].role_hint).toBe("Coordinator"); // not overwritten
    expect(enrichScheduleFromLlm(schedule, [])).toBe(0);
    expect(enrichScheduleFromLlm(schedule, null)).toBe(0);
  });
});

describe("evaluateSoaGate", () => {
  it("uses the grid when it covers the expected visits cleanly", () => {
    const result = parseSoaGrid(TABLES);
    const decision = evaluateSoaGate(result, 12); // PledOx has 12 treatment visits
    expect(decision.useGrid).toBe(true);
    expect(decision.method).toBe("grid");
  });

  it("falls back when the grid under-covers the independent signal", () => {
    const result = parseSoaGrid(TABLES);
    const decision = evaluateSoaGate(result, 30); // claim far more visits than present
    expect(decision.useGrid).toBe(false);
    expect(decision.method).toBe("llm_fallback");
    expect(decision.reasons.join(" ")).toMatch(/under-covers/);
  });

  it("falls back when there is no SoA grid", () => {
    const result = parseSoaGrid([{ content: "<table><tr><td>prose</td></tr></table>" }]);
    const decision = evaluateSoaGate(result, 0);
    expect(decision.useGrid).toBe(false);
    expect(decision.method).toBe("llm_fallback");
  });
});

describe("parseSoaGrid — guards on degenerate input", () => {
  it("flags low confidence when there is no SoA grid", () => {
    const r = parseSoaGrid([{ content: "<table><tr><td>just prose</td></tr></table>" }]);
    expect(r.visits).toHaveLength(0);
    expect(r.guards.lowConfidence).toBe(true);
    expect(r.guards.notes).toContain("no SoA grid table found");
  });

  it("ignores non-table content", () => {
    const r = parseSoaGrid([{ content: "no tables here" }]);
    expect(r.visits).toHaveLength(0);
  });
});

// =============================================================================
// HYBRID production path: extractRawColumns (deterministic, complete, verbatim)
// + assembleVisitsFromGrouping (driven by the LLM grouping — mocked here so CI is
// deterministic and runs no live LLM). Golden fixture = the same PledOx SoA.
// =============================================================================
describe("extractRawColumns — golden (PP06489), vocabulary-free", () => {
  const { columns, guards } = extractRawColumns(TABLES);

  it("reads every visit column (flat, per page) with full self-consistency", () => {
    expect(guards.soaTablesFound).toBe(9);
    expect(guards.selfConsistency).toBe(1); // every detected mark is emitted
    expect(guards.notes).toEqual([]);
    expect(columns).toHaveLength(64); // flat columns (a visit recurs across continuation tables; incl. sparse named-visit rescues)
    expect(columns[0].idx).toBe(0); // idx is the left-to-right page sequence
  });

  it("captures each column's procedures verbatim (Screening, page 53)", () => {
    const scr = columns.find((c) => /^screening/i.test(c.header))!;
    expect(scr.procedures.map((p) => p.label)).toEqual([
      "Informed Consent",
      "CT/MRI Scan and Disease Assessment",
      "CEA",
      "Medical History and Prior Medication",
      "Physical Examination (per standard of care)",
      "Vital Signs (all Visits) and Weight (only for Treatment Visits)",
      "ECOG Performance Status",
      "Pregnancy Test",
    ]);
  });

  it("emits no header/scheduling text or footnote superscripts as procedures", () => {
    for (const c of columns) {
      for (const p of c.procedures) {
        expect(p.label).not.toMatch(/[ª²³¹º⁰-⁹]/);
        expect(p.label).not.toMatch(/^(visit|day|cycle|week|month|assessment)\b|window/i);
      }
    }
  });
});

describe("assembleVisitsFromGrouping — golden (PP06489)", () => {
  const { columns } = extractRawColumns(TABLES);
  // Simulate the LLM grouping deterministically: group flat columns by canonical
  // visit name (the real LLM does richer collapse/dedup; this proves assembly).
  const byName = new Map<string, number[]>();
  for (const c of columns) {
    const name = parseVisitHeader(c.header).visit_name;
    if (!byName.has(name)) byName.set(name, []);
    byName.get(name)!.push(c.idx);
  }
  const grouping = { visits: [...byName.entries()].map(([name, source_idx]) => ({ name, source_idx })) };
  const { schedule, citations } = assembleVisitsFromGrouping(columns, grouping);

  it("unions a grouped visit's procedures across its source columns (Screening = 14, deduped)", () => {
    const screening = schedule.find((s) => s.visit_name === "Screening")!;
    expect(screening.procedures).toContain("Hematology"); // from a later page-53 block, not the first column
    expect(screening.procedures.length).toBe(14);
    expect(new Set(screening.procedures).size).toBe(screening.procedures.length); // deduped
  });

  it("rescues the sparse 'Randomization' visit (1 mark/column) that mark-density alone drops", () => {
    const rnd = schedule.find((s) => s.visit_name === "Randomization");
    expect(rnd, "Randomization visit missing").toBeTruthy();
    expect(rnd!.procedures).toContain("Randomization");
  });

  it("produces the distinct PledOx visits in protocol-column order", () => {
    const names = schedule.map((s) => s.visit_name);
    for (const expected of [
      "Screening", "Randomization", "Treatment Visit 1", "Treatment Visit 12", "EOT Visit", "EOS Visit",
      "Assessment Visit Month 3", "Assessment Visit Month 9",
    ]) {
      expect(names, `missing ${expected}`).toContain(expected);
    }
    // column_order is a strict ascending sequence; EOT sorts after TV12 (study_day=14 would mis-place it)
    expect(schedule.map((s) => s.column_order)).toEqual([...schedule.map((s) => s.column_order)].sort((a, b) => a - b));
    expect(names.indexOf("Treatment Visit 12")).toBeLessThan(names.indexOf("EOT Visit"));
  });

  it("emits a high-confidence SoA-page citation per assembled visit", () => {
    expect(citations).toHaveLength(schedule.length);
    expect(citations.every((c) => c.confidence === "high" && c.section === "Schedule of Assessments")).toBe(true);
  });

  it("identity grouping = one visit per raw column (the grid_ungrouped fallback)", () => {
    const idGrouping = { visits: columns.map((c) => ({ name: c.header, source_idx: [c.idx] })) };
    const { schedule: s } = assembleVisitsFromGrouping(columns, idGrouping);
    expect(s).toHaveLength(columns.length);
    expect(s.map((v) => v.column_order)).toEqual([...columns.keys()]);
  });

  it("ignores unknown source_idx — the LLM cannot invent a column", () => {
    const { schedule: s } = assembleVisitsFromGrouping(columns, { visits: [{ name: "Bogus", source_idx: [9999] }] });
    expect(s).toHaveLength(0);
  });

  it("derives study_day from the LLM-cleaned name when the terse source header can't parse (regression: BLKR201 'D1 0' → 'Day 1')", () => {
    // Production bug: a column header like "D1 0" yields study_day=null, and the
    // NOT-NULL study_day persist drops the visit — collapsing a 12-visit schedule
    // to the lone Screening row. The LLM cleans "D1 0" → "Day 1", which parses, so
    // assembly must prefer the grouped name. Build columns whose headers are terse
    // codes and whose grouped names are the clean equivalents.
    const c0 = columns[0];
    const terse = [
      { ...c0, idx: 0, header: "D1 0" },
      { ...c0, idx: 1, header: "D7 X" },
      { ...c0, idx: 2, header: "Wk 4 visit" }, // "Wk" doesn't parse; name "Week 4" does
    ];
    const { schedule: s } = assembleVisitsFromGrouping(terse, {
      visits: [
        { name: "Day 1", source_idx: [0] },
        { name: "Day 7", source_idx: [1] },
        { name: "Week 4", source_idx: [2] },
      ],
    });
    expect(s.map((v) => v.study_day)).toEqual([1, 7, 28]); // none null → none dropped at persist
  });
});

describe("cohort applicability", () => {
  const col = (idx: number, header: string, section: string): import("../soaGridParser.ts").RawColumn => ({
    idx, header, page: 1, section,
    procedures: [{ label: `P${idx}`, note: null, mark: "marked" }],
    markCount: 1,
  });
  const idGroup = (cols: import("../soaGridParser.ts").RawColumn[]) => ({
    visits: cols.map((c) => ({ name: c.header, source_idx: [c.idx] })),
  });

  it("cohortOnlyRestriction extracts an explicit [X only] / (X only) marker", () => {
    expect(cohortOnlyRestriction("D3/ET* (D4 [S4 Only])")).toBe("S4");
    expect(cohortOnlyRestriction("Biopsy (Cohort B only)")).toBe("Cohort B");
    expect(cohortOnlyRestriction("Day 1")).toBeNull();
  });

  it("tags ONLY visits with an explicit [X only] marker; everything else is null (applies to all)", () => {
    // Reliable-markers-only: the parse-unstable section-table signal is NOT used.
    // Only the exclusive "[S4 Only]" visit is cohort-scoped; the rest stay null
    // (shared) regardless of which SoA table they came from — so no shared visit
    // is ever wrongly hidden by the cohort filter.
    const cols = [
      col(0, "Screening", "Multiple Ascending Dose"),
      col(1, "Day 1", "Single Ascending Dose Cohorts"),
      col(2, "Day 3/ET* (D4 [S4 Only])", "Multiple Ascending Dose"),
    ];
    const { schedule } = assembleVisitsFromGrouping(cols, idGroup(cols));
    const by = Object.fromEntries(schedule.map((s) => [s.visit_name, s.applies_to]));
    expect(by["Screening"]).toBeNull();
    expect(by["Day 1"]).toBeNull();
    expect(schedule.find((s) => /S4 Only/.test(s.visit_name))!.applies_to).toEqual(["S4"]);
  });

  it("does NOT tag a single-schedule protocol — every visit applies_to=null (no regression)", () => {
    const cols = [
      col(0, "Screening", "Table 1: Schedule of Assessments"),
      col(1, "Day 1", "Table 1: Schedule of Assessments"),
      col(2, "Day 8", "Table 1: Schedule of Assessments"),
    ];
    const { schedule } = assembleVisitsFromGrouping(cols, idGroup(cols));
    expect(schedule.every((s) => s.applies_to === null)).toBe(true);
  });
});

describe("assembleVisitsFromGrouping — monotonic approximate day (Visit Prep sorts by study_day)", () => {
  const col = (idx: number, header: string): import("../soaGridParser.ts").RawColumn => ({
    idx, header, page: 1, section: "SoA",
    procedures: [{ label: `P${idx}`, note: null, mark: "marked" }],
    markCount: 1,
  });

  it("anchors a dateless tail visit to (last real day)+1 so it sorts AFTER real visits, not at its column index", () => {
    // "Follow-up" has no parseable day → deriveStudyDay falls back to column index
    // (2). The monotonic pass must lift it above the last real day (20) → 21, so a
    // study_day-sorted UI keeps it last instead of placing it at day 2.
    const columns = [col(0, "Day 10"), col(1, "Day 20"), col(2, "Follow-up")];
    const grouping = { visits: columns.map((c) => ({ name: c.header, source_idx: [c.idx] })) };
    const { schedule } = assembleVisitsFromGrouping(columns, grouping);
    expect(schedule.map((s) => s.visit_name)).toEqual(["Day 10", "Day 20", "Follow-up"]);
    expect(schedule.map((s) => s.study_day)).toEqual([10, 20, 21]);
  });

  it("increments consecutive dateless visits and keeps real-dated visits untouched", () => {
    const columns = [col(0, "Day 5"), col(1, "EOFU"), col(2, "LTFU")];
    const grouping = { visits: columns.map((c) => ({ name: c.header, source_idx: [c.idx] })) };
    const { schedule } = assembleVisitsFromGrouping(columns, grouping);
    expect(schedule.map((s) => s.study_day)).toEqual([5, 6, 7]); // 5 real, then 6,7 appended
  });
});

describe("deriveStudyDay — every visit gets a non-null day so the NOT-NULL persist never drops it", () => {
  it("prefers the explicit Day/Week keyword (cleaned name over terse header)", () => {
    expect(deriveStudyDay("Day 1", "D1 0", 5).study_day).toBe(1);
    expect(deriveStudyDay("Week 4", "Wk 4", 5).study_day).toBe(28);
  });

  it("reads a parenthetical day-with-window: CLR 'V3 2 (14±3)' → day 14, window 3", () => {
    const d = deriveStudyDay("V3 2 (14±3)", "V3 2 (14±3)", 2);
    expect(d.study_day).toBe(14);
    expect(d.window_minus_days).toBe(3);
    expect(d.window_plus_days).toBe(3);
    expect(d.approximate).toBe(false);
    expect(deriveStudyDay("Baseline V2 0 (0)", "", 1).study_day).toBe(0);
  });

  it("reads a bare 'D-28' / 'D-7' code that is not the word 'Day' (PledOx selection visits)", () => {
    expect(deriveStudyDay("SELECTION PHASE D-7 W-1", "", 1).study_day).toBe(-7);
    expect(deriveStudyDay("Visits in Month D-28 W-4", "", 0).study_day).toBe(-28);
  });

  it("reads a trailing day-number after a scheduling word: RVW101 'EOT 28', 'Follow-Up 42 ±2', 'Dosing 1'", () => {
    expect(deriveStudyDay("EOT 28", "", 9).study_day).toBe(28);
    expect(deriveStudyDay("EOS 280", "", 9).study_day).toBe(280);
    const fu = deriveStudyDay("Safety and PK Follow-Up 42 ±2", "", 9);
    expect(fu.study_day).toBe(42);
    expect(fu.window_plus_days).toBe(2);
    expect(deriveStudyDay("Dosing 1", "", 9).study_day).toBe(1);
  });

  it("does NOT misread a visit ordinal as a day (no scheduling word → falls back, not '3')", () => {
    const d = deriveStudyDay("Visit 3", "Visit 3", 7);
    expect(d.study_day).toBe(7); // column-order fallback, not 3
    expect(d.approximate).toBe(true);
  });

  it("falls back to column order for a genuinely dateless visit (CLR 'ED'), never null, sequence preserved", () => {
    const d = deriveStudyDay("ED", "ED", 12);
    expect(d.study_day).toBe(12);
    expect(d.approximate).toBe(true);
    expect(Number.isInteger(d.study_day)).toBe(true);
  });
});

describe("assembleVisitsFromGrouping — safety-critical preservation (PP06489)", () => {
  const { columns } = extractRawColumns(TABLES);
  it("preserves conditional (X) marks and keeps marked procedures null (for the safety-critical heuristic)", () => {
    const idGrouping = { visits: columns.map((c) => ({ name: c.header, source_idx: [c.idx] })) };
    const ps = assembleVisitsFromGrouping(columns, idGrouping).schedule.flatMap((s) => s.procedures_structured);
    const conditional = ps.filter((p) => p.classification === "conditional");
    expect(conditional.length).toBeGreaterThan(0); // PledOx has conditional "(X)" procedures
    expect(conditional.every((p) => /MRI of CNS/i.test(p.label))).toBe(true);
    // marked procedures stay classification=null so buildPersistPayloadForVisit's assignClassification
    // can still derive required / safety_critical / primary_endpoint from the label (never hardcoded)
    expect(ps.every((p) => p.classification === "conditional" || p.classification === null)).toBe(true);
  });
});

// =============================================================================
// Slice 3 — generalized, evidence-driven cohort scope. cohortsFromTableHeading +
// markerCohortScope resolve a visit's cohort set from the SoA table HEADING (the
// stable signal) ∪ "[X only]" markers, against the AUTHORITATIVE cohort list.
// Exercised on a SHARED-schedule fixture (BLKR201-like: S1–S6 share one table)
// AND a DIVERGENT fixture (per-cohort tables). Two guarantees:
//   (a) a heading that names ALL/NONE → shared (null) so every cohort sees it;
//   (b) NO leakage — a per-cohort visit is never bound to a cohort its
//       heading/marker doesn't name (and never to a label outside the list).
// =============================================================================
describe("cohortsFromTableHeading — heading → authoritative cohort subset", () => {
  const S6 = ["S1", "S2", "S3", "S4", "S5", "S6"];

  it("expands an enumerated + ellipsis heading to every listed cohort", () => {
    expect(cohortsFromTableHeading("Schedule of Activities — SAD Cohorts S1, S2, S3, S4 … S6", S6))
      .toEqual(["S1", "S2", "S3", "S4", "S5", "S6"]);
  });

  it("matches a labeled sub-schedule heading (MAD / CSF) by literal token", () => {
    const list = ["SAD", "MAD", "CSF"];
    expect(cohortsFromTableHeading("MAD Cohorts — Multiple Ascending Dose", list)).toEqual(["MAD"]);
    expect(cohortsFromTableHeading("CSF Sub-study Schedule", list)).toEqual(["CSF"]);
  });

  it("expands a numeric range with a generic descriptor (Cohorts 3–6 → S3..S6; 1 to 6 → all)", () => {
    expect(cohortsFromTableHeading("Assessments — Cohorts 3–6", S6)).toEqual(["S3", "S4", "S5", "S6"]);
    expect(cohortsFromTableHeading("Cohorts 1 to 6", S6)).toEqual(S6);
  });

  it("returns [] for a generic heading with no cohort token (never invents)", () => {
    expect(cohortsFromTableHeading("Schedule of Activities", S6)).toEqual([]);
    expect(cohortsFromTableHeading("Table 1", S6)).toEqual([]);
    expect(cohortsFromTableHeading("", S6)).toEqual([]);
  });

  it("never returns a label outside the list, and respects token boundaries", () => {
    expect(cohortsFromTableHeading("Cohort S12 only", S6)).toEqual([]); // S12 ∉ list; not "S1"
    expect(cohortsFromTableHeading("Nomadic exploratory arm", ["MAD"])).toEqual([]); // 'MAD' ∌ NOMADIC
  });
});

describe("markerCohortScope — exclusive marker → cohort set (range-aware)", () => {
  const S6 = ["S1", "S2", "S3", "S4", "S5", "S6"];
  it("resolves a single exclusive marker", () => {
    expect(markerCohortScope("D3/ET* (D4 [S4 Only])", S6)).toEqual(["S4"]);
  });
  it("expands a range-only marker against the list", () => {
    expect(markerCohortScope("Biopsy — Cohorts 3–6 only", S6)).toEqual(["S3", "S4", "S5", "S6"]);
  });
  it("is null when there is no exclusive marker", () => {
    expect(markerCohortScope("Day 1", S6)).toBeNull();
    expect(markerCohortScope("Schedule of Activities S1, S2 … S6", S6)).toBeNull(); // shared, not "only"
  });
});

describe("assembleVisitsFromGrouping — cohort binding with an authoritative list", () => {
  const col = (idx: number, header: string, section: string): import("../soaGridParser.ts").RawColumn => ({
    idx, header, page: 1, section,
    procedures: [{ label: `P${idx}`, note: null, mark: "marked" }],
    markCount: 1,
  });
  const idGroup = (cols: import("../soaGridParser.ts").RawColumn[]) => ({
    visits: cols.map((c) => ({ name: c.header, source_idx: [c.idx] })),
  });

  it("SHARED fixture (BLKR201-like): one table lists all 6 → every visit shared (null); the [S4 Only] visit → ['S4']", () => {
    const S6 = ["S1", "S2", "S3", "S4", "S5", "S6"];
    const HEADING = "Schedule of Activities — SAD Cohorts S1, S2, S3, S4 … S6";
    const cols = [
      col(0, "Screening", HEADING),
      col(1, "Day 1", HEADING),
      col(2, "D3/ET* (D4 [S4 Only])", HEADING),
    ];
    const { schedule } = assembleVisitsFromGrouping(cols, idGroup(cols), S6);
    const by = Object.fromEntries(schedule.map((s) => [s.visit_name, s.applies_to]));
    // heading names all 6 → shared → every cohort sees these (full list lives in protocol_cohorts)
    expect(by["Screening"]).toBeNull();
    expect(by["Day 1"]).toBeNull();
    // the exclusive marker narrows just this visit
    expect(schedule.find((s) => /S4 Only/.test(s.visit_name))!.applies_to).toEqual(["S4"]);
    // no-invention: every non-null tag is a real cohort from the list
    for (const s of schedule) for (const c of s.applies_to ?? []) expect(S6).toContain(c);
  });

  it("DIVERGENT fixture: per-cohort tables bind each visit to its cohort(s); NO leakage across cohorts", () => {
    const C6 = ["C1", "C2", "C3", "C4", "C5", "C6"];
    const cols = [
      col(0, "Screening", "Schedule of Activities (All Cohorts)"), // generic → shared
      col(1, "Intensive PK", "Cohort C1 — Intensive PK Schedule"), // → C1 only
      col(2, "Intensive PK", "Cohort C2 — Intensive PK Schedule"), // → C2 only
      col(3, "DLT Review", "Safety Reviews — Cohorts 3–6 only"),   // → C3..C6
    ];
    const { schedule } = assembleVisitsFromGrouping(cols, idGroup(cols), C6);
    const c1Visit = schedule.find((s) => s.column_order === 1)!;
    const c2Visit = schedule.find((s) => s.column_order === 2)!;
    const dlt = schedule.find((s) => s.visit_name === "DLT Review")!;
    expect(schedule.find((s) => s.visit_name === "Screening")!.applies_to).toBeNull(); // shared backbone
    expect(c1Visit.applies_to).toEqual(["C1"]);
    expect(c2Visit.applies_to).toEqual(["C2"]);
    // THE no-leakage guarantee: the C1 visit is NOT shown under C2 (and vice versa)
    expect(c1Visit.applies_to).not.toContain("C2");
    expect(c2Visit.applies_to).not.toContain("C1");
    expect(dlt.applies_to).toEqual(["C3", "C4", "C5", "C6"]);
    expect(dlt.applies_to).not.toContain("C1"); // the range excludes C1/C2 — no leakage
  });

  it("BACK-COMPAT: without a cohort list, section headings are IGNORED — markers-only (unchanged)", () => {
    const cols = [
      col(0, "Screening", "SAD Cohorts S1, S2 … S6"), // heading enumerates cohorts...
      col(1, "Day 1", "MAD Cohorts"),
      col(2, "D3 (D4 [S4 Only])", "SAD Cohorts S1 … S6"),
    ];
    const { schedule } = assembleVisitsFromGrouping(cols, idGroup(cols)); // no cohortList arg
    const by = Object.fromEntries(schedule.map((s) => [s.visit_name, s.applies_to]));
    expect(by["Screening"]).toBeNull(); // ...but ignored without an authoritative list
    expect(by["Day 1"]).toBeNull();
    expect(schedule.find((s) => /S4 Only/.test(s.visit_name))!.applies_to).toEqual(["S4"]); // marker still works
  });
});

// =============================================================================
// Slice 3.1 — binding when the extracted cohort list is MORE GRANULAR than the
// SoA labels: parent→period prefix expansion (S4 ↔ S4 Period 1/2), stated
// aliases (CSF ↔ "Cerebrospinal Fluid Cohort"), and the marker-resolve that
// stops emitting an orphan ["S4"]. Guards: a granular heading ("S4 Period 2")
// must NOT over-bind its sibling; the parent token still respects boundaries.
// =============================================================================
describe("leadingCohortToken — coarse parent of a granular label", () => {
  it("strips the period/segment qualifier; null for a single token", () => {
    expect(leadingCohortToken("S4 Period 1")).toBe("S4");
    expect(leadingCohortToken("S4 Period 2")).toBe("S4");
    expect(leadingCohortToken("Cohort 3 Expansion")).toBe("Cohort 3");
    expect(leadingCohortToken("Arm A")).toBe("Arm");
    expect(leadingCohortToken("S4")).toBeNull();
    expect(leadingCohortToken("MAD")).toBeNull();
  });
});

describe("cohortsFromTableHeading — alias + parent→period (Slice 3.1)", () => {
  const PERIODS = ["S4 Period 1", "S4 Period 2", "S6"];

  it("binds a coarse parent heading ('S4') to every granular label under it (not S6)", () => {
    expect(cohortsFromTableHeading("S4 dosing schedule", PERIODS)).toEqual(["S4 Period 1", "S4 Period 2"]);
  });

  it("does NOT over-bind when the heading is itself granular (sibling guard)", () => {
    expect(cohortsFromTableHeading("S4 Period 2 schedule", PERIODS)).toEqual(["S4 Period 2"]);
  });

  it("respects token boundaries on the parent ('S4' ∌ 'S40')", () => {
    expect(cohortsFromTableHeading("S40 cohort", PERIODS)).toEqual([]);
  });

  it("matches a cohort by a stated SoA alias (CSF ↔ 'Cerebrospinal Fluid Cohort')", () => {
    const alias = { CSF: ["Cerebrospinal Fluid Cohort"] };
    expect(cohortsFromTableHeading("Cerebrospinal Fluid Cohort — LP Schedule", ["CSF", "MAD"], alias))
      .toEqual(["CSF"]);
  });

  it("a numeric range reaches granular labels via the leading token (S1–S6 → both S4 periods)", () => {
    expect(cohortsFromTableHeading("Cohorts S1–S6", PERIODS)).toEqual(["S4 Period 1", "S4 Period 2", "S6"]);
  });
});

describe("markerCohortScope — resolves the raw restriction token against the list (Slice 3.1)", () => {
  it("[S4 only] with a granular list binds both periods, not the orphan ['S4']", () => {
    expect(markerCohortScope("(D4 [S4 Only])", ["S4 Period 1", "S4 Period 2", "S6"]))
      .toEqual(["S4 Period 1", "S4 Period 2"]);
  });
  it("falls back to the raw token when nothing resolves (surfaced by the reconcile)", () => {
    expect(markerCohortScope("[S9 Only]", ["S1", "S2"])).toEqual(["S9"]);
  });
});

describe("assembleVisitsFromGrouping — granular + alias binding end-to-end (Slice 3.1)", () => {
  const col = (idx: number, header: string, section: string): import("../soaGridParser.ts").RawColumn => ({
    idx, header, page: 1, section,
    procedures: [{ label: `P${idx}`, note: null, mark: "marked" }],
    markCount: 1,
  });
  const idGroup = (cols: import("../soaGridParser.ts").RawColumn[]) => ({
    visits: cols.map((c) => ({ name: c.header, source_idx: [c.idx] })),
  });

  it("an 'S4' heading binds both S4 periods; a CSF-alias heading binds CSF; no orphan tags", () => {
    const list = ["S4 Period 1", "S4 Period 2", "CSF"];
    const aliasMap = { CSF: ["Cerebrospinal Fluid Cohort"] };
    const cols = [
      col(0, "Screening", "Schedule of Activities — All Cohorts"), // generic → shared
      col(1, "S4 Dosing", "S4 dosing schedule"),                   // coarse parent → both periods
      col(2, "LP", "Cerebrospinal Fluid Cohort — LP Schedule"),    // alias → CSF
    ];
    const { schedule } = assembleVisitsFromGrouping(cols, idGroup(cols), list, aliasMap);
    const by = Object.fromEntries(schedule.map((s) => [s.visit_name, s.applies_to]));
    expect(by["S4 Dosing"]).toEqual(["S4 Period 1", "S4 Period 2"]);
    expect(by["LP"]).toEqual(["CSF"]);
    // no-invention: every non-null tag is a real cohort from the list
    for (const s of schedule) for (const t of s.applies_to ?? []) expect(list).toContain(t);
  });
});
