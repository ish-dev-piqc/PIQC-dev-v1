import { describe, it, expect } from "vitest";
import {
  parseStudyCohorts,
  parseStatedCohortCount,
  reconcileCohorts,
  type ExtractedCohort,
} from "../cohortExtraction.ts";

// =============================================================================
// cohortExtraction — turn Reducto-Extract `study_cohorts` (+ citations) into
// authoritative cohort rows, and reconcile against schedule coverage + a
// prose-stated count. Guarantees: all cohorts appear or the gap is flagged;
// evidence-gated (no citation → kept but flagged, never invented).
// =============================================================================

describe("parseStudyCohorts", () => {
  it("maps the reshaped extract shape to rows with per-cohort dose + evidence, in order", () => {
    const fields = {
      study_cohorts: [
        { label: "S1", dose_regimen: "10 mg IV", description: "lowest dose" },
        { label: "S2", dose_regimen: "30 mg IV", description: null },
      ],
      _reducto_citations: {
        study_cohorts: [
          { text: "Cohort S1 will receive 10 mg", pages: [12] },
          { text: "Cohort S2 will receive 30 mg", pages: [12] },
        ],
      },
    };
    const cohorts = parseStudyCohorts(fields);
    expect(cohorts.map((c) => c.label)).toEqual(["S1", "S2"]);
    expect(cohorts[0]).toMatchObject({
      label: "S1", dose_regimen: "10 mg IV", description: "lowest dose",
      source_page: 12, has_evidence: true,
    });
    expect(cohorts[0].source_quote).toMatch(/10 mg/);
  });

  it("dedups by normalized label and drops entries with no label", () => {
    const fields = {
      study_cohorts: [
        { label: "S1" }, { label: " s1 " }, { label: "" }, { dose_regimen: "x" }, { label: "MAD" },
      ],
    };
    expect(parseStudyCohorts(fields).map((c) => c.label)).toEqual(["S1", "MAD"]);
  });

  it("marks has_evidence=false when no citation is attached (kept, never invented)", () => {
    const cohorts = parseStudyCohorts({ study_cohorts: [{ label: "S1", dose_regimen: "10 mg" }] });
    expect(cohorts).toHaveLength(1);
    expect(cohorts[0]).toMatchObject({ has_evidence: false, source_page: null, source_quote: null });
  });

  it("returns [] when the protocol has no study_cohorts (single-schedule → no cohort UI)", () => {
    expect(parseStudyCohorts({})).toEqual([]);
    expect(parseStudyCohorts({ study_cohorts: "not an array" })).toEqual([]);
    expect(parseStudyCohorts(null)).toEqual([]);
  });

  it("reads soa_aliases (trim, dedup, drop label-restatements); defaults to [] when absent", () => {
    const fields = {
      study_cohorts: [
        { label: "CSF", soa_aliases: ["Cerebrospinal Fluid Cohort", " cerebrospinal fluid cohort ", "CSF"] },
        { label: "S4", soa_aliases: "not an array" },
        { label: "MAD" },
      ],
    };
    const cohorts = parseStudyCohorts(fields);
    expect(cohorts.find((c) => c.label === "CSF")!.soa_aliases).toEqual(["Cerebrospinal Fluid Cohort"]);
    expect(cohorts.find((c) => c.label === "S4")!.soa_aliases).toEqual([]);
    expect(cohorts.find((c) => c.label === "MAD")!.soa_aliases).toEqual([]);
  });
});

describe("parseStatedCohortCount", () => {
  it("reads a stated cohort/arm count from prose (digit or number word)", () => {
    expect(parseStatedCohortCount("The study enrolls six dose cohorts (S1–S6).")).toBe(6);
    expect(parseStatedCohortCount("There are 6 ascending-dose cohorts.")).toBe(6);
    expect(parseStatedCohortCount("randomized into three treatment arms")).toBe(3);
    expect(parseStatedCohortCount("4 cohorts")).toBe(4);
  });
  it("returns null when no count is clearly stated near cohorts/arms", () => {
    expect(parseStatedCohortCount("A total of 200 patients will be enrolled.")).toBeNull();
    expect(parseStatedCohortCount("The schedule of activities is in Table 1.")).toBeNull();
    expect(parseStatedCohortCount("")).toBeNull();
    expect(parseStatedCohortCount(null)).toBeNull();
  });
  it("does NOT read a sectioning ordinal as a count (the over-fire fix)", () => {
    // "Part 1" is a section label, not "1 cohort" — must not flag a bogus mismatch.
    expect(parseStatedCohortCount("In Part 1 the treatment arms differ across sites.")).toBeNull();
    expect(parseStatedCohortCount("See Table 2 for the cohorts.")).toBeNull();
    expect(parseStatedCohortCount("During Phase 3 the dose cohorts are unblinded.")).toBeNull();
  });
  it("does NOT read a figure separated from the cohort noun by multiple words", () => {
    // tightened intervening window: >1 descriptive word between number and noun
    expect(parseStatedCohortCount("we identified 1 previously unreported exploratory cohorts")).toBeNull();
  });
});

describe("reconcileCohorts — flag divergence, never hide", () => {
  const c = (label: string, has_evidence = true): ExtractedCohort => ({
    label, dose_regimen: null, description: null, source_page: has_evidence ? 1 : null,
    source_quote: has_evidence ? "q" : null, has_evidence, soa_aliases: [],
  });
  const SIX = ["S1", "S2", "S3", "S4", "S5", "S6"].map((l) => c(l));

  it("consistent: shared backbone covers all + stated count matches", () => {
    const r = reconcileCohorts(SIX, ["S4"], true, 6); // BLKR201-like: shared backbone + S4 exception
    expect(r.consistent).toBe(true);
    expect(r.covered_count).toBe(6);
    expect(r.notes).toEqual([]);
  });

  it("flags under-coverage: 6 extracted, schedule (no shared backbone) covers 4", () => {
    const r = reconcileCohorts(SIX, ["S1", "S2", "S3", "S4"], false, null);
    expect(r.consistent).toBe(false);
    expect(r.covered_count).toBe(4);
    expect(r.notes.join(" ")).toMatch(/2 of 6 cohort\(s\) have no schedule coverage/);
  });

  it("flags a stated-count mismatch", () => {
    const r = reconcileCohorts(SIX, [], true, 4); // prose says 4, extraction found 6
    expect(r.consistent).toBe(false);
    expect(r.notes.join(" ")).toMatch(/states 4 cohort\(s\); extraction found 6/);
  });

  it("flags cohorts lacking a citation (evidence gate)", () => {
    const r = reconcileCohorts([c("S1"), c("S2", false)], [], true, null);
    expect(r.consistent).toBe(false);
    expect(r.notes.join(" ")).toMatch(/1 cohort\(s\) lack a source citation/);
  });

  it("flags an ORPHAN schedule ref EVEN WITH a shared backbone (the false-pass fix)", () => {
    // 'S4' is a real cohort; 'Sky' is a mis-bound/unknown scope. The old blanket
    // shared-backbone shortcut set covered=all → consistent=true, silently hiding it.
    const r = reconcileCohorts(SIX, ["S4", "Sky"], true, 6);
    expect(r.consistent).toBe(false);
    expect(r.notes.join(" ")).toMatch(/references 1 cohort scope\(s\) not in the extracted list: Sky/);
  });

  it("does NOT over-flag a clean shared design: backbone + all refs are real cohorts", () => {
    const r = reconcileCohorts([c("A"), c("B"), c("C")], ["A"], true, 3);
    expect(r.consistent).toBe(true);
    expect(r.notes).toEqual([]);
  });
});
