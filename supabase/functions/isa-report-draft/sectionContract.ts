// =============================================================================
// isa-report-draft — the section contract: what each narrative section is,
// what the model must anchor verbatim, and the gate that enforces it.
//
// ANCHOR CONSTANTS are duplicated from src/lib/audit/isaReportModel.ts on
// purpose: edge functions can't import the client tree. The cross-tree test
// (src/lib/audit/__tests__/isaReportSectionContract.test.ts) asserts equality
// with the client constants — if either side drifts, a test fails. Keep both
// in sync deliberately, never silently.
//
// The exec-summary gate is mechanical, not vibes: the draft must contain,
// verbatim, (1) the compliance statement, (2) the verdict sentence for the
// audit's set verdict, (3) the response clause. A draft that drops or rewrites
// any of them is withheld — the register's stock sentences are the product.
//
// Pure module — no Deno APIs. Unit tested cross-tree like gates.ts.
// =============================================================================

export const SECTION_KEYS = [
  "exec_summary",
  "auditee_background",
  "opening_meeting",
  "closing_meeting",
] as const;
export type SectionKey = (typeof SECTION_KEYS)[number];

export function isSectionKey(v: unknown): v is SectionKey {
  return typeof v === "string" && (SECTION_KEYS as readonly string[]).includes(v);
}

export const MAX_SECTION_CHARS: Record<SectionKey, number> = {
  exec_summary: 4_000,
  auditee_background: 3_000,
  opening_meeting: 3_000,
  closing_meeting: 3_000,
};

// --- Anchor constants (client parity — see header) ---------------------------

export const COMPLIANCE_STATEMENT =
  "In general, the clinical trial has been conducted by the above noted investigator in compliance with the principles of ICH Good Clinical Practice, applicable regulatory requirements, and the applicable procedures, protocols and plans.";

export const VERDICT_SENTENCES: Record<string, string> = {
  CONTINUE:
    "None of the noted observations should prevent continued use of the site or warrant increased monitoring.",
  CONTINUE_INCREASED_MONITORING:
    "The noted observations do not prevent continued use of the site; increased monitoring is warranted.",
  DO_NOT_CONTINUE:
    "The noted observations warrant suspension of further enrolment at the site pending resolution.",
};

export function buildResponseClause(days: number, basis: "CALENDAR" | "BUSINESS"): string {
  const unit = basis === "CALENDAR" ? "calendar" : "business";
  return `A written response to the audit observations must be submitted within ${days} ${unit} days of receipt of this report.`;
}

/** Client parity with src/lib/audit/labels.ts — the exec summary's category
 *  beat needs human labels, not enum keys. */
export const ISA_DOMAIN_LABELS: Record<string, string> = {
  INFORMED_CONSENT: "Informed consent",
  INVESTIGATOR_OVERSIGHT_DELEGATION: "Investigator oversight & delegation",
  INVESTIGATIONAL_PRODUCT: "Investigational product",
  SAFETY_AE_SAE: "Safety — AE/SAE reporting",
  SOURCE_DATA_VERIFICATION: "Source data verification",
  RECORDKEEPING_SOURCE_DOCS: "Recordkeeping & source documents",
  ESSENTIAL_DOCUMENTS: "Essential documents",
  IRB_EC: "IRB / EC",
  STAFF_QUALIFICATIONS_TRAINING: "Staff qualifications & training",
  FACILITIES_EQUIPMENT: "Facilities & equipment",
  ELECTRONIC_SYSTEMS: "Electronic systems",
  STUDY_CONDUCT_GCP: "Study conduct & GCP",
  CLINICAL_MONITORING: "Clinical monitoring",
  SOP_REVIEW: "SOP review",
  OTHER: "Other",
};

// --- Per-section drafting instructions ---------------------------------------

/** What the section covers, per the S0 writing contract. Injected into the
 *  prompt; the model drafts ONLY from the material it is given. */
export const SECTION_INSTRUCTIONS: Record<SectionKey, string> = {
  exec_summary:
    "Compose the executive summary as flowing prose following the six-beat formula: " +
    "(1) the compliance statement, VERBATIM as given; " +
    "(2) the severity headline derived from the finding counts given; " +
    "(3) the observation categories as a short in-sentence list (no bullet characters); " +
    "(4) 'The specifics of all observations are detailed later in this report.'; " +
    "(5) the site-continuation sentence, VERBATIM as given; " +
    "(6) the response clause, VERBATIM as given. " +
    "Do not add findings, counts, or judgments beyond the given material.",
  auditee_background:
    "Draft the auditee background: the investigator's clinical-research experience, " +
    "the site team composition per the Delegation of Authority log, how participants " +
    "are recruited, and the site's regulatory inspection history — drawing ONLY on " +
    "facts present in the fieldwork notes.",
  opening_meeting:
    "Draft the opening-meeting record: who hosted, the date, who attended (by role), " +
    "and the review of audit objectives, scope, and agenda — drawing ONLY on facts " +
    "present in the fieldwork notes.",
  closing_meeting:
    "Draft the closing-meeting record: who attended (by role), the preliminary " +
    "observations presented, CAPA/response expectations communicated, and the " +
    "auditee's acknowledgment — drawing ONLY on facts present in the fieldwork notes.",
};

// --- Gate ---------------------------------------------------------------------

export interface SectionGateResult {
  ok: boolean;
  /** Human-readable names of missing verbatim anchors (exec only). */
  missing: string[];
}

/**
 * Gate a drafted section. Non-exec sections gate on emptiness/length only —
 * their truth check is the auditor reading them against their own notes.
 * The exec summary additionally requires every anchor verbatim.
 */
export function gateSection(
  section: SectionKey,
  text: string,
  anchors: { label: string; text: string }[],
): SectionGateResult {
  const trimmed = text.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_SECTION_CHARS[section]) {
    return { ok: false, missing: ["a non-empty draft within the length limit"] };
  }
  const missing = anchors.filter((a) => !trimmed.includes(a.text)).map((a) => a.label);
  return { ok: missing.length === 0, missing };
}
