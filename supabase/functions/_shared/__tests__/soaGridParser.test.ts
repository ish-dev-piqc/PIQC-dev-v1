import { describe, it, expect } from "vitest";
import {
  parseSoaGrid,
  parseVisitHeader,
  classifyMark,
  gridToScheduleOfEvents,
  enrichScheduleFromLlm,
  evaluateSoaGate,
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
