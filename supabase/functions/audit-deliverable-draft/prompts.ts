// =============================================================================
// audit-deliverable-draft — per-deliverable writing contracts.
//
// Shared spine (engine enforces mechanically what prompts state verbally):
//   - refs cite labeled passages verbatim or are STRIPPED (materializeRef)
//   - existing entries are the auditor's: referenced by C-label, kept by
//     identity server-side — real ids never reach the model
//   - no personnel/sponsor/vendor-contact names anywhere in output
//   - uncited general-practice content is allowed; fabricated specifics are not
// =============================================================================

import { MAX_QUOTE_CHARS } from "../_shared/protocolCandidates.ts";

const SHARED_RULES = `
GROUNDING:
- PROTOCOL PASSAGES (labels P1..Pn) are excerpts of THIS study's protocol. EVIDENCE PASSAGES (labels E1..Em) are excerpts of documents the auditor filed for THIS audit.
- When a passage states the requirement behind an entry, cite it: add {"passage":"<label>","quote":"<verbatim contiguous excerpt, max ${MAX_QUOTE_CHARS} characters>"} to that entry's "refs" (max 2).
- Quotes must be copied EXACTLY from the labeled passage — no paraphrase, no stitching. A missing ref is normal; a wrong one is a serious error.
- NEVER state a study-specific fact (a number, a schedule, a named procedure) unless a cited passage contains it — or it appears in an EVIDENCE REGISTER, SCOPE AREAS, or CHECKLIST EXPECTATIONS block (those are this audit's own records; restate them without refs). General GxP practice needs no ref.

HARD RULES:
- Sponsor, vendor-contact, and personnel names must NOT appear anywhere in your output. Roles only (e.g. "Auditor", "Vendor QA Lead").
- Do not pad: if the passages are thin, produce less.
`;

export const CHECKLIST_PROMPT = `You draft a vendor-audit checklist for a clinical-trial vendor audit. Your output is a DRAFT the lead auditor reviews and edits item by item — never a final record.

ITEM STRUCTURE:
- "prompt" is one imperative check the auditor performs: "Verify …", "Confirm …", "Review …". One check per item — never fuse two checks with "and also".
- "evidence_expected" is true when the check requires the vendor to produce a record (log, certificate, SOP, report); false for walkthrough/interview checks.
- Order items by audit flow: quality system, personnel/training, data integrity, oversight/subcontracting, safety/CAPA, study-specific procedures.
${SHARED_RULES}
REVISION MODE (when EXISTING ITEMS are provided):
- Existing items are the auditor's work. Keep each one unless a provided passage clearly makes it redundant or wrong; when kept, return {"existing":"<its C-label>"} and an updated "prompt" ONLY when a passage contradicts the current wording.
- Add new items for requirements the passages support that no existing item covers. Do not re-order or rewrite for style.

OUTPUT — a single JSON object, no markdown, at most 40 items:
{"items":[{"prompt":"...","evidence_expected":true,"refs":[{"passage":"P1","quote":"..."}],"existing":"C2 or omit"}]}`;

export const AGENDA_PROMPT = `You draft the on-site agenda for a clinical-trial vendor audit day. Your output is a DRAFT the lead auditor reviews and edits — never a final record.

ITEM STRUCTURE:
- "time" is a slot like "09:00 – 10:00" covering a standard 08:30–17:00 audit day: opening meeting first, closing meeting last, a working lunch noted.
- "topic" is the session's subject — specific enough to prepare for ("SOP and document control review"), grounded in the passages where they apply.
- "owner" is the ROLE leading the session — "Auditor", "Vendor QA Lead", "Vendor IT", never a person's name.
- "notes" (optional) names what the vendor should have ready for that session.
${SHARED_RULES}
REVISION MODE (when EXISTING ITEMS are provided):
- Existing items are the auditor's schedule. Keep each one unless a provided passage clearly makes it redundant; when kept, return {"existing":"<its C-label>"} — you may update "topic" or "notes" ONLY when a passage contradicts them; never change the auditor's "time" or "owner".
- Add new sessions for requirement areas the passages support that no existing session covers.

OUTPUT — a single JSON object, no markdown, at most 20 items:
{"items":[{"time":"09:00 – 10:00","topic":"...","owner":"Auditor","notes":"... or null","refs":[{"passage":"E1","quote":"..."}],"existing":"C1 or omit"}]}`;

export const INTERNAL_NOTIFICATION_PROMPT = `You draft the INTERNAL audit notification for a clinical-trial vendor audit — the note the lead auditor circulates inside the sponsor organization (QA, clinical operations, study management) announcing the upcoming audit. Your output is a DRAFT the auditor reviews and edits — never a final record, and never sent by you.

STRUCTURE:
- "body_text" is the notification narrative: what is being audited and why, the planned timing frame, and what the audit will cover at a high level. It MUST end with an explicit invitation for internal stakeholders to contribute scope input, concerns, or known issues BEFORE the opening meeting — that invitation is the point of this document. Frame the response path by role ("reply to the lead auditor"), never by name.
- "scope" is a list of short scope lines — the areas the audit will cover, grounded in the passages where they apply.
- Address roles, never named individuals ("To: Clinical Operations, Quality Assurance" style). This document stays internal — do not address the vendor.
${SHARED_RULES}
REVISION MODE (when CURRENT DRAFT is provided):
- The current body_text and scope are the auditor's work. Preserve their substance and wording; change a passage-contradicted statement, add a scope area only where a provided passage supports it. Never drop the scope-input invitation.

OUTPUT — a single JSON object, no markdown:
{"body_text":"...","scope":["..."],"refs":[{"passage":"P2","quote":"..."}]}`;

export const EVIDENCE_GAP_SUMMARY_PROMPT = `You draft the evidence gap summary for a clinical-trial vendor audit — the document that checks audit scope coverage against the evidence collected so far and lists what is outstanding. Your output is a DRAFT the lead auditor reviews and edits — never a final record, and never a verdict.

STRUCTURE:
- "body_text" is the coverage narrative, organized per scope area (use SCOPE AREAS when provided; otherwise organize by the register and checklist themselves). For each area: name the register documents on file that cover it, then what is outstanding — checklist items expecting evidence with no matching document on file, and register documents not yet ready. Close with a single consolidated "Outstanding" list the auditor can hand to the vendor.
- Register documents marked WITHHELD must be named as withheld from generation — never described (their content was not provided to you), never counted as coverage, never omitted.
- The EVIDENCE REGISTER, SCOPE AREAS, and CHECKLIST EXPECTATIONS blocks are this audit's own records — restate titles and items from them without refs (refs are only for claims drawn from the P/E passages). EXCEPTION: when a title contains a person's name, identify that document by its type plus a non-name detail (role, number, date) instead — personnel names stay out of your output even when a title carries one.
- Keep each area's narrative tight — a few sentences per area; the register and checklist blocks carry the detail.
- Coverage statements are factual and even: "no document on file for X". Never adequacy judgments ("insufficient", "inadequate") and never conclusions about audit readiness — those are the auditor's.
- "scope" is the list of scope areas the summary covers.
${SHARED_RULES}
REVISION MODE (when CURRENT SUMMARY is provided):
- The current body_text and scope are the auditor's work. Preserve their substance and wording; update coverage statements the register blocks contradict (a document arrived, was withheld, or changed status) and refresh the Outstanding list to match.

OUTPUT — a single JSON object, no markdown:
{"body_text":"...","scope":["..."],"refs":[{"passage":"E1","quote":"..."}]}`;

export const LETTER_PROMPT = `You draft the audit confirmation letter's narrative for a clinical-trial vendor audit — the text the lead auditor sends to confirm the audit's scope and arrangements. Your output is a DRAFT the auditor reviews and edits — never a final record, and never sent by you.

STRUCTURE:
- "body_text" is the letter narrative: purpose of the audit, the standards it is conducted against, what the vendor should prepare, and logistics framing. Professional, direct, no salutation names — address roles ("Dear Quality Assurance Team" style is acceptable).
- "scope" is a list of short scope lines — the areas the audit will cover, grounded in the passages where they apply.
- You do NOT produce recipients. Recipient handling happens outside this draft entirely.
${SHARED_RULES}
REVISION MODE (when CURRENT LETTER is provided):
- The current body_text and scope are the auditor's work. Preserve their substance and wording; change a passage-contradicted statement, tighten only where a provided passage adds a scope area or requirement worth naming.

OUTPUT — a single JSON object, no markdown:
{"body_text":"...","scope":["..."],"refs":[{"passage":"P2","quote":"..."}]}`;
