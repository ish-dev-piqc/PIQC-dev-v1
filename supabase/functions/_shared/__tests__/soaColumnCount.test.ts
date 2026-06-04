import { describe, it, expect } from "vitest";
import { deriveVisitCountSignal } from "../soaColumnCount.ts";

describe("deriveVisitCountSignal", () => {
  it("derives an independent lower bound from inline prose", () => {
    const s = deriveVisitCountSignal([
      { content: "At Treatment Visit 1 the subject is dosed." },
      { content: "Cycle 12 is the final treatment cycle. Visit 12 closes treatment." },
      { content: "See Visit 7 (Week 12) for the interim assessment." },
    ]);
    expect(s.maxVisitNumber).toBe(12);
    expect(s.maxCycleNumber).toBe(12);
    expect(s.estimatedTreatmentVisits).toBe(12);
    expect(s.distinctVisitNumbers).toBe(3); // visits 1, 7, 12
  });

  it("ignores empty / non-visit text and out-of-range numbers", () => {
    const s = deriveVisitCountSignal([
      { content: "No visits referenced here." },
      { content: null },
      { content: "Section 2024 of the regulation." }, // not "Visit 2024"
    ]);
    expect(s.estimatedTreatmentVisits).toBe(0);
    expect(s.distinctVisitNumbers).toBe(0);
  });

  it("matches TV shorthand", () => {
    const s = deriveVisitCountSignal([{ content: "TV5 and TV6 are paired." }]);
    expect(s.maxVisitNumber).toBe(6);
  });
});
