// =============================================================================
// ISA regulatory citation map — the CLOSED WORLD for the `reference` field.
//
// The finding writer SELECTS from this list; it never composes citations.
// Rationale: E6(R3) restructured the guideline (Principles + Annex 1,
// renumbered) — a free-generated section number will eventually hallucinate,
// and a wrong regulatory cite in an audit report is a credibility-ending
// error class. Closed-world selection makes that class impossible.
//
// Provenance of every entry:
//   - ICH E6(R3) cites: verified against the official Step 4 PDF
//     (adopted 06 Jan 2025), read section-by-section 2026-07-18.
//     Anchor: 2.12.2 carries ALCOA-C verbatim.
//   - 21 CFR cites: verified against the CFR full text (Cornell LII mirror
//     of 21 CFR Parts 50 and 312), section titles confirmed 2026-07-19.
//
// Keep entries display-ready — they render verbatim in finding cards and
// exported reports. Domain → applicable citations; the model may only pick
// from the row matching the draft's domain.
// =============================================================================

export const ISA_DOMAINS = [
  "INFORMED_CONSENT",
  "INVESTIGATOR_OVERSIGHT_DELEGATION",
  "INVESTIGATIONAL_PRODUCT",
  "SAFETY_AE_SAE",
  "SOURCE_DATA_VERIFICATION",
  "RECORDKEEPING_SOURCE_DOCS",
  "ESSENTIAL_DOCUMENTS",
  "IRB_EC",
  "STAFF_QUALIFICATIONS_TRAINING",
  "FACILITIES_EQUIPMENT",
  "ELECTRONIC_SYSTEMS",
  "STUDY_CONDUCT_GCP",
  "CLINICAL_MONITORING",
  "SOP_REVIEW",
  "OTHER",
] as const;

export type IsaDomainKey = (typeof ISA_DOMAINS)[number];

export const CITATION_MAP: Record<IsaDomainKey, string[]> = {
  INFORMED_CONSENT: [
    "ICH E6(R3) 2.8.1",   // consent process requirements
    "ICH E6(R3) 2.8.2",   // new information / re-consent
    "ICH E6(R3) 2.8.3",   // no coercion or undue influence
    "ICH E6(R3) 2.8.5",   // who conducts consent
    "ICH E6(R3) 2.8.6",   // ample time and opportunity
    "ICH E6(R3) 2.8.7",   // signatures and dating
    "ICH E6(R3) 2.8.10",  // required consent elements
    "ICH E6(R3) 2.8.11",  // copy provided to participant
    "ICH E6(R3) 2.8.12",  // minors / assent
    "ICH E6(R3) Principle 2",
    "21 CFR 50.20",       // general requirements for informed consent
    "21 CFR 50.25",       // elements of informed consent
    "21 CFR 50.27",       // documentation of informed consent
  ],
  INVESTIGATOR_OVERSIGHT_DELEGATION: [
    "ICH E6(R3) 2.3.1",   // oversight of delegated activities
    "ICH E6(R3) 2.3.2",   // qualified, informed delegates
    "ICH E6(R3) 2.3.3",   // delegation record
    "ICH E6(R3) 2.3.4",   // documented service-provider agreements
    "ICH E6(R3) Principle 10",
    "21 CFR 312.53",      // selecting investigators and monitors (Form FDA 1572)
    "21 CFR 312.60",      // general responsibilities of investigators
  ],
  INVESTIGATIONAL_PRODUCT: [
    "ICH E6(R3) 2.10.1",  // IP management responsibility
    "ICH E6(R3) 2.10.2",  // delegation to pharmacist
    "ICH E6(R3) 2.10.4",  // accountability records
    "ICH E6(R3) 2.10.5",  // storage per sponsor specification
    "ICH E6(R3) 2.10.6",  // use per approved protocol
    "ICH E6(R3) 2.10.7",  // participant use instructions
    "ICH E6(R3) 2.11",    // randomisation and unblinding
    "ICH E6(R3) Principle 11",
    "21 CFR 312.61",      // control of the investigational drug
    "21 CFR 312.62(a)",   // disposition of drug
  ],
  SAFETY_AE_SAE: [
    "ICH E6(R3) 2.7.1",   // medical care of trial participants
    "ICH E6(R3) 2.7.2(a)", // AE reporting per protocol
    "ICH E6(R3) 2.7.2(b)", // immediate SAE reporting + causality
    "ICH E6(R3) 2.7.2(c)", // deaths — additional information
    "ICH E6(R3) Principle 1.2",
    "ICH E6(R3) Principle 1.5",
    "21 CFR 312.64",      // investigator reports
    "21 CFR 312.66",      // assurance of IRB review (unanticipated problems)
  ],
  SOURCE_DATA_VERIFICATION: [
    "ICH E6(R3) 2.12.3",  // timely data review incl. eligibility
    "ICH E6(R3) 2.12.5",  // accuracy/completeness of reported data
    "ICH E6(R3) 2.12.6",  // source consistency, traceable corrections
    "ICH E6(R3) Principle 9",
    "21 CFR 312.62(b)",   // case histories
  ],
  RECORDKEEPING_SOURCE_DOCS: [
    "ICH E6(R3) 2.12.1",  // data integrity responsibility
    "ICH E6(R3) 2.12.2",  // source records ALCOA-C + audit trail
    "ICH E6(R3) 2.12.7",  // participant privacy protection
    "ICH E6(R3) 2.12.8",  // unambiguous participant code
    "ICH E6(R3) Principle 9.4",
    "21 CFR 312.62(b)",   // case histories
    "21 CFR 312.68",      // inspection of investigator's records and reports
  ],
  ESSENTIAL_DOCUMENTS: [
    "ICH E6(R3) 2.12.11", // maintain essential records (Appendix C)
    "ICH E6(R3) 2.12.12", // retention period + protection
    "ICH E6(R3) 2.12.14", // direct access on request
    "ICH E6(R3) Appendix C",
    "ICH E6(R3) Principle 9.5",
    "21 CFR 312.62(c)",   // record retention
    "21 CFR Part 54",     // financial disclosure by clinical investigators
  ],
  IRB_EC: [
    "ICH E6(R3) 2.4.2",   // documented approval before initiation
    "ICH E6(R3) 2.4.4",   // updates to participant information
    "ICH E6(R3) 2.4.5",   // trial status summaries
    "ICH E6(R3) 2.4.6",   // prompt communication of significant changes
    "ICH E6(R3) Principle 3",
    "21 CFR Part 56",     // institutional review boards
    "21 CFR 312.66",      // assurance of IRB review
  ],
  STAFF_QUALIFICATIONS_TRAINING: [
    "ICH E6(R3) 2.1.1",   // investigator qualifications + evidence
    "ICH E6(R3) 2.1.2",   // familiarity with IP
    "ICH E6(R3) 2.3.2",   // delegate training to task
    "ICH E6(R3) Principle 5.1",
    "21 CFR 312.53",      // selecting investigators and monitors
  ],
  FACILITIES_EQUIPMENT: [
    "ICH E6(R3) 2.2.2",   // adequate time, staff, facilities
    "ICH E6(R3) 2.12.4",  // sponsor-deployed tools used as specified
    "ICH E6(R3) Principle 7.1",
    "21 CFR 312.60",      // general responsibilities of investigators
  ],
  ELECTRONIC_SYSTEMS: [
    "ICH E6(R3) 2.12.9",  // protection from unauthorised access/loss
    "ICH E6(R3) 2.12.10", // computerised-system obligations (access, incidents)
    "ICH E6(R3) 4.3.3",   // security
    "ICH E6(R3) 4.3.4",   // validation
    "ICH E6(R3) 4.3.8",   // user management
    "ICH E6(R3) Principle 9.3",
    "21 CFR Part 11",     // electronic records; electronic signatures
  ],
  STUDY_CONDUCT_GCP: [
    "ICH E6(R3) 2.5.1",   // signed protocol agreement
    "ICH E6(R3) 2.5.2",   // comply with protocol, GCP, regulations
    "ICH E6(R3) 2.5.3",   // document + explain protocol deviations
    "ICH E6(R3) 2.5.4",   // deviate only to eliminate immediate hazard
    "ICH E6(R3) 2.9.1",   // end-of-participation handling
    "ICH E6(R3) Principle 6.3",
    "21 CFR 312.60",      // general responsibilities of investigators
  ],
  CLINICAL_MONITORING: [
    "ICH E6(R3) 2.3.5",   // permit monitoring, auditing, inspection
    "ICH E6(R3) 3.11.4",  // monitoring (sponsor-side context)
    "ICH E6(R3) Principle 10.3",
  ],
  SOP_REVIEW: [
    "Auditee SOP (cite the site's own procedure)",
    "ICH E6(R3) 2.3.2",   // training corresponding to delegated activities
    "ICH E6(R3) Principle 6",
  ],
  OTHER: [
    "ICH E6(R3) Principle 1",
    "ICH E6(R3) Principle 6",
    "ICH E6(R3) Principle 9",
    "21 CFR 312.60",
  ],
};

/** Flat set of every allowed citation string, for O(1) gate checks. */
export function allowedCitationSet(): Set<string> {
  const s = new Set<string>();
  for (const list of Object.values(CITATION_MAP)) {
    for (const c of list) s.add(c);
  }
  return s;
}
