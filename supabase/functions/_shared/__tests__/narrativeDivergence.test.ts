import { describe, it, expect } from "vitest";
import { detectNarrativeGridDivergences } from "../narrativeDivergence.ts";
import type { ScheduleOfEventsItem } from "../soaGridParser.ts";

const mkVisit = (
  name: string,
  day: number | null,
  labels: string[],
  window: [number, number] = [0, 0],
  header?: string,
): ScheduleOfEventsItem => ({
  visit_name: name,
  study_day: day,
  window_minus_days: window[0],
  window_plus_days: window[1],
  column_order: 0,
  procedures: [...labels],
  procedures_structured: labels.map((label) => ({
    label,
    description: null,
    phase: null,
    classification: null,
    role_hint: null,
    soa_column: name,
    protocol_section: "Schedule of Assessments",
    protocol_page: null,
    conditions: [],
    timing: null,
    source_fields: [],
  })),
  visit_purpose: "",
  schedule_variant: "",
  cross_references: [],
  applies_to: null,
  ...(header ? { source_header: header } : {}),
});

describe("detectNarrativeGridDivergences — window_mismatch", () => {
  it("fires when both readings state a nonzero window and any component differs", () => {
    const grid = [mkVisit("Visit 3", 15, ["ECG"], [2, 2], "Visit 3 Day 15 (±2 days)")];
    const llm = [{ visit_name: "Visit 3", study_day: 15, window_minus_days: 3, window_plus_days: 3, procedures_structured: [] }];
    const out = detectNarrativeGridDivergences(grid, llm);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ class: "window_mismatch", visit_name: "Visit 3" });
    expect(out[0].reading_a.quote).toBe("Visit 3 Day 15 (±2 days)"); // verbatim header
    expect(out[0].reading_a.verbatim).toBe(true);
    expect(out[0].reading_b.verbatim).toBe(false); // extraction-recorded, honestly labeled
    expect(out[0].detail).toContain("±2");
    expect(out[0].detail).toContain("±3");
    // wording honesty: states what was compared, asserts no verdict
    expect(out[0].detail).not.toMatch(/wrong|incorrect|error\b/i);
  });

  it("NEVER fires 0-vs-N — absence is not a divergence (grid 0/0 = header stated none)", () => {
    const grid = [mkVisit("Visit 3", 15, ["ECG"], [0, 0])];
    const llm = [{ visit_name: "Visit 3", study_day: 15, window_minus_days: 3, window_plus_days: 3, procedures_structured: [] }];
    expect(detectNarrativeGridDivergences(grid, llm)).toHaveLength(0);
  });

  it("stays silent when the readings agree", () => {
    const grid = [mkVisit("Visit 3", 15, ["ECG"], [3, 3])];
    const llm = [{ visit_name: "Visit 3", study_day: 15, window_minus_days: 3, window_plus_days: 3, procedures_structured: [] }];
    expect(detectNarrativeGridDivergences(grid, llm)).toHaveLength(0);
  });
});

describe("detectNarrativeGridDivergences — presence (one-directional)", () => {
  const llmWithEcgAtV2 = [
    { visit_name: "Visit 1", study_day: 1, procedures_structured: [{ label: "ECG" }] },
    { visit_name: "Visit 2", study_day: 8, procedures_structured: [{ label: "ECG" }] },
  ];

  it("fires when the narrative lists a grid-known procedure at a visit the grid does not mark", () => {
    const grid = [mkVisit("Visit 1", 1, ["ECG"]), mkVisit("Visit 2", 8, ["Hematology"])];
    const out = detectNarrativeGridDivergences(grid, llmWithEcgAtV2);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ class: "presence", visit_name: "Visit 2", procedure_label: "ECG" });
    expect(out[0].detail).toContain("Visit 1"); // names where the grid does mark it
  });

  it("is granularity-silent when the grid has the label NOWHERE (outside the shared vocabulary)", () => {
    const grid = [mkVisit("Visit 1", 1, ["Hematology"]), mkVisit("Visit 2", 8, ["Hematology"])];
    expect(detectNarrativeGridDivergences(grid, llmWithEcgAtV2)).toHaveLength(0);
  });

  it("is silent when a sibling variant is marked at the visit (paren-stripped kinship)", () => {
    const grid = [mkVisit("Visit 1", 1, ["Vital signs"]), mkVisit("Visit 2", 8, ["Vital signs (supine)"])];
    const llm = [
      { visit_name: "Visit 1", study_day: 1, procedures_structured: [{ label: "Vital signs" }] },
      { visit_name: "Visit 2", study_day: 8, procedures_structured: [{ label: "Vital signs" }] },
    ];
    expect(detectNarrativeGridDivergences(grid, llm)).toHaveLength(0);
  });

  it("never fires in the reverse direction (grid marks it; narrative silent)", () => {
    const grid = [mkVisit("Visit 1", 1, ["ECG", "Hematology"])];
    const llm = [{ visit_name: "Visit 1", study_day: 1, procedures_structured: [{ label: "ECG" }] }];
    expect(detectNarrativeGridDivergences(grid, llm)).toHaveLength(0);
  });

  it("skips unaligned visits entirely (no confident pair → no comparison)", () => {
    const grid = [mkVisit("Some Column", null, ["Hematology"])];
    const llm = [{ visit_name: "Visit 1", study_day: 1, procedures_structured: [{ label: "Hematology" }] }];
    expect(detectNarrativeGridDivergences(grid, llm)).toHaveLength(0);
  });
});

describe("detectNarrativeGridDivergences — cohort_scope note promotion", () => {
  it("promotes divergence-shaped reconcile notes and excludes extraction-quality ones", () => {
    const notes = [
      "schedule references 1 cohort scope(s) not in the extracted list: S9",
      "2 of 5 cohort(s) have no schedule coverage",
      "1 cohort(s) lack a source citation", // extraction-quality — excluded
      "protocol prose states 6 cohort(s); extraction found 5", // excluded
    ];
    const out = detectNarrativeGridDivergences([], null, notes);
    expect(out).toHaveLength(2);
    expect(out.every((d) => d.class === "cohort_scope")).toBe(true);
    expect(out[0].locus_key).toContain("c:");
    expect(out[0].detail).toContain("verify against the protocol");
  });

  it("locus keys are stable across identical re-detections (re-ingest upsert identity)", () => {
    const grid = [mkVisit("Visit 3", 15, ["ECG"], [2, 2])];
    const llm = [{ visit_name: "Visit 3", study_day: 15, window_minus_days: 3, window_plus_days: 3, procedures_structured: [] }];
    const a = detectNarrativeGridDivergences(grid, llm);
    const b = detectNarrativeGridDivergences(grid, llm);
    expect(a[0].locus_key).toBe(b[0].locus_key);
  });
});
