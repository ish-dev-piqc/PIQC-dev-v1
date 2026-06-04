import { describe, it, expect } from "vitest";
import {
  parseSoaGrid,
  parseVisitHeader,
  classifyMark,
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
