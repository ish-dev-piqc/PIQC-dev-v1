// =============================================================================
// Pre-Audit Drafting deliverable types (D-010, step 7 follow-up)
//
// Three deliverables (Confirmation Letter, Agenda, Checklist) share the same
// approval lifecycle (DeliverableApprovalStatus = DRAFT | APPROVED) and the
// same delta-tracked write pattern, but each has a distinct `content` shape.
//
// All Json `content` blobs validated through these Zod schemas before write.
// `approveDeliverable` applies a per-kind validity check (see lib/deliverables.ts)
// so empty / structurally invalid content cannot be approved.
//
// Sponsor-name-free by rule. Auditors add branding externally on export.
// =============================================================================

import { DeliverableApprovalStatus } from "@prisma/client";
import { z } from "zod";

// -----------------------------------------------------------------------------
// Discriminator
// -----------------------------------------------------------------------------
export const DELIVERABLE_KINDS = ["confirmationLetter", "agenda", "checklist"] as const;
export type DeliverableKind = (typeof DELIVERABLE_KINDS)[number];

export const DeliverableKindSchema = z.enum(DELIVERABLE_KINDS);

// -----------------------------------------------------------------------------
// Confirmation Letter content
// Sent to the vendor confirming dates, attendees, and scope.
//
// New fields (from real confirmation-letter.md template):
//   vendorContactTitle   — recipient's job title (appears in the address block)
//   vendorContactAddress — full address block, free-text multi-line
//   auditStartTime       — e.g. "09:00" — referenced in bodyText; separate
//                          field so the auditor can update without rewriting prose
//   auditEndTime         — e.g. "16:00"
//   preAuditDocuments    — structured, editable list of documents requested
//                          before the audit; scope varies per vendor service
// -----------------------------------------------------------------------------
export interface ConfirmationLetterContent {
  to: string;                    // Vendor primary contact name
  vendorContactTitle: string;    // Recipient's job title
  vendorContactAddress: string;  // Full address block (multi-line free text)
  from: string;                  // Lead auditor name
  subject: string;
  auditStartTime: string;        // e.g. "09:00"
  auditEndTime: string;          // e.g. "16:00"
  preAuditDocuments: string[];   // Editable list — varies by vendor service contract
  bodyText: string;              // Letter narrative — the main editable surface
  ccRecipients: string[];
}

export const ConfirmationLetterContentSchema = z.object({
  to:                   z.string(),
  vendorContactTitle:   z.string(),
  vendorContactAddress: z.string(),
  from:                 z.string(),
  subject:              z.string(),
  auditStartTime:       z.string(),
  auditEndTime:         z.string(),
  preAuditDocuments:    z.array(z.string()),
  bodyText:             z.string(),
  ccRecipients:         z.array(z.string()),
});

// -----------------------------------------------------------------------------
// Agenda content
// Audit-day plan matching the real audit-agenda.md template structure.
//
// Multi-day structure: `days` replaces the former flat `items` + `auditDate`.
// Standard audit = 2 days; auditors add/remove days as needed.
//
// Header fields (from template's header table):
//   auditeeAddress  — vendor location / address
//   projects        — protocol or study identifiers in scope
//   auditScope      — scope text (what is and isn't covered)
//   conductSummary  — short prose: how the audit will take place (remote / on-site)
// -----------------------------------------------------------------------------
export interface AgendaItem {
  time?: string;    // e.g. "09:00–09:30" — free text, audit teams format their own
  topic: string;
  owner?: string;   // Free text — e.g. "Lead Auditor", "Vendor QA"
  notes?: string;
}

export interface AgendaDay {
  date: string | null; // ISO date, e.g. "2026-09-01"
  label?: string;      // e.g. "Day 1", "Day 2"
  items: AgendaItem[];
}

export interface AgendaContent {
  auditeeAddress: string;   // Vendor location — auditor revises
  projects: string;         // Protocol / study number(s)
  auditScope: string;       // Scope summary — auditor revises
  conductSummary: string;   // How audit will run (remote / on-site narrative)
  attendees: string[];      // All participants (auditors + vendor reps)
  objectives: string[];     // Pulled from approved risk summary focus areas at stub time
  days: AgendaDay[];        // Multi-day structure; standard stub = 2 days
}

export const AgendaItemSchema = z.object({
  time:  z.string().optional(),
  topic: z.string(),
  owner: z.string().optional(),
  notes: z.string().optional(),
});

export const AgendaDaySchema = z.object({
  date:  z.string().nullable(),
  label: z.string().optional(),
  items: z.array(AgendaItemSchema),
});

export const AgendaContentSchema = z.object({
  auditeeAddress:  z.string(),
  projects:        z.string(),
  auditScope:      z.string(),
  conductSummary:  z.string(),
  attendees:       z.array(z.string()),
  objectives:      z.array(z.string()),
  days:            z.array(AgendaDaySchema),
});

// -----------------------------------------------------------------------------
// Checklist content
// Auditor's working checklist — what to observe, evidence to collect,
// checkpoints to verify. Phase 1 has no SOP linkage (D-004); checkpointRef
// stays plain text until D-004 lands.
// -----------------------------------------------------------------------------
export interface ChecklistItem {
  id: string;                  // Stable ID for client-side reorder/delete
  prompt: string;
  checkpointRef?: string;      // [D-004 STUB] free text until SOP linkage lands
  evidenceExpected: boolean;
  notes?: string;
}

export interface ChecklistContent {
  auditContext: string;        // "Vendor + service" — copied from Audit at stub time
  focusAreas: string[];        // Pulled from approved risk summary at stub time
  items: ChecklistItem[];
}

export const ChecklistItemSchema = z.object({
  id:               z.string().min(1),
  prompt:           z.string(),
  checkpointRef:    z.string().optional(),
  evidenceExpected: z.boolean(),
  notes:            z.string().optional(),
});

export const ChecklistContentSchema = z.object({
  auditContext: z.string(),
  focusAreas:   z.array(z.string()),
  items:        z.array(ChecklistItemSchema),
});

// -----------------------------------------------------------------------------
// Discriminated union of contents (per-kind type narrowing)
// -----------------------------------------------------------------------------
export type DeliverableContent =
  | { kind: "confirmationLetter"; content: ConfirmationLetterContent }
  | { kind: "agenda";             content: AgendaContent }
  | { kind: "checklist";          content: ChecklistContent };

// -----------------------------------------------------------------------------
// Library inputs
// -----------------------------------------------------------------------------
export interface CreateDeliverableStubInput {
  auditId: string;
  kind:    DeliverableKind;
  actorId: string;
}

export const CreateDeliverableStubSchema = z.object({});

export interface UpdateDeliverableInput {
  auditId: string;
  kind:    DeliverableKind;
  actorId: string;
  content: ConfirmationLetterContent | AgendaContent | ChecklistContent;
}

// PATCH body: content (actorId comes from Clerk session).
export const UpdateDeliverableBodySchema = z.object({
  content: z.unknown(), // narrowed via per-kind schema after dispatch
});

export interface ApproveDeliverableInput {
  auditId: string;
  kind:    DeliverableKind;
  actorId: string;
}

export const ApproveDeliverableSchema = z.object({});

// -----------------------------------------------------------------------------
// Display helpers
// -----------------------------------------------------------------------------
export function formatDeliverableKind(kind: DeliverableKind): string {
  switch (kind) {
    case "confirmationLetter": return "confirmation letter";
    case "agenda":             return "agenda";
    case "checklist":          return "checklist";
  }
}

// -----------------------------------------------------------------------------
// Read shape — what the workspace renders
// -----------------------------------------------------------------------------
export interface RenderedDeliverable {
  id:             string;
  auditId:        string;
  kind:           DeliverableKind;
  content:        ConfirmationLetterContent | AgendaContent | ChecklistContent;
  approvalStatus: DeliverableApprovalStatus;
  approvedAt:     string | null;
  approvedBy:     string | null;
  createdAt:      string;
  updatedAt:      string;
}
