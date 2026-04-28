// =============================================================================
// Mock data for PRE_AUDIT_DRAFTING stage.
//
// Three 1:1 deliverables per audit (D-010 step 7):
//   - ConfirmationLetterObject — sent to vendor confirming dates/scope
//   - AgendaObject              — multi-day audit plan
//   - ChecklistObject           — auditor's working checklist
//
// All three share the DRAFT/APPROVED lifecycle; editing demotes APPROVED → DRAFT.
// All three must be APPROVED to unlock AUDIT_CONDUCT.
//
// Sponsor-name-free by rule.
// =============================================================================

import type { DeliverableApprovalStatus } from '../../types/audit';

// -----------------------------------------------------------------------------
// Confirmation letter
// -----------------------------------------------------------------------------
export interface MockConfirmationLetterContent {
  body_text: string;
  recipients: string[];
  scope: string[];
}

export interface MockConfirmationLetter {
  id: string;
  audit_id: string;
  content: MockConfirmationLetterContent;
  approval_status: DeliverableApprovalStatus;
  approved_by_name: string | null;
  approved_at: string | null;
}

// -----------------------------------------------------------------------------
// Agenda
// -----------------------------------------------------------------------------
export interface MockAgendaItem {
  id: string;
  time: string;        // e.g. "09:00 – 10:00"
  topic: string;
  owner: string;       // e.g. "Auditor", "Vendor QA Lead"
  notes: string | null;
}

export interface MockAgendaContent {
  items: MockAgendaItem[];
}

export interface MockAgenda {
  id: string;
  audit_id: string;
  content: MockAgendaContent;
  approval_status: DeliverableApprovalStatus;
  approved_by_name: string | null;
  approved_at: string | null;
}

// -----------------------------------------------------------------------------
// Checklist
// -----------------------------------------------------------------------------
export interface MockChecklistItem {
  id: string;
  prompt: string;
  checkpoint_ref: string | null;   // [D-004 STUB] plain text until SOP parsing
  evidence_expected: boolean;
}

export interface MockChecklistContent {
  items: MockChecklistItem[];
}

export interface MockChecklist {
  id: string;
  audit_id: string;
  content: MockChecklistContent;
  approval_status: DeliverableApprovalStatus;
  approved_by_name: string | null;
  approved_at: string | null;
}

// -----------------------------------------------------------------------------
// Per-audit bundle
// -----------------------------------------------------------------------------
export interface MockPreAuditBundle {
  confirmation_letter: MockConfirmationLetter | null;
  agenda: MockAgenda | null;
  checklist: MockChecklist | null;
}

export const MOCK_PRE_AUDIT: Record<string, MockPreAuditBundle> = {
  // BRIGHTEN-2 — Stage 3, no drafting yet.
  'audit-001': {
    confirmation_letter: null,
    agenda: null,
    checklist: null,
  },
  // CARDIAC-7 — Stage 1, no drafting yet.
  'audit-002': {
    confirmation_letter: null,
    agenda: null,
    checklist: null,
  },
  // IMMUNE-14 — Stage 5 in progress: confirmation letter + agenda APPROVED,
  // checklist still DRAFT.
  'audit-003': {
    confirmation_letter: {
      id: 'cl-003',
      audit_id: 'audit-003',
      content: {
        body_text:
          "Thank you for your continued partnership on this study. This letter confirms the upcoming audit of your electronic patient-reported outcome platform and patient device fleet.\n\n" +
          "Audit dates: 22 May 2026 – 23 May 2026 (remote pre-audit calls), with onsite engagement at your primary office on 26 May 2026.\n\n" +
          "Audit scope is summarized below. Please confirm receipt and the proposed attendees from your side by reply.",
        recipients: [
          'Aman Patel (Compliance Lead)',
          'Mei Tanaka (QA Director)',
          'patientpulse-audits@patientpulse.example',
        ],
        scope: [
          'Platform validation evidence for the scoring engine',
          '21 CFR Part 11 conformance — system controls + audit trail review',
          'Device provisioning + hygiene SOPs',
          'Outage handling and data recovery procedures',
        ],
      },
      approval_status: 'APPROVED',
      approved_by_name: 'Kiara Patel',
      approved_at: '2026-04-26T14:18:00Z',
    },
    agenda: {
      id: 'ag-003',
      audit_id: 'audit-003',
      content: {
        items: [
          {
            id: 'ai-003-1',
            time: 'Day 1 · 09:00 – 09:30',
            topic: 'Opening meeting — introductions, scope confirmation',
            owner: 'Auditor + Vendor leadership',
            notes: 'Capture attendee list. Confirm any last-minute scope adjustments.',
          },
          {
            id: 'ai-003-2',
            time: 'Day 1 · 09:30 – 11:30',
            topic: 'Platform validation lifecycle review',
            owner: 'Vendor QA + Engineering',
            notes: 'Walk-through of validation evidence for the scoring engine on the endpoint critical path.',
          },
          {
            id: 'ai-003-3',
            time: 'Day 1 · 13:00 – 15:00',
            topic: '21 CFR Part 11 controls demonstration',
            owner: 'Vendor Compliance',
            notes: 'Live demo of audit-trail capture, e-signature, and access controls.',
          },
          {
            id: 'ai-003-4',
            time: 'Day 2 · 09:00 – 11:00',
            topic: 'Device fleet hygiene + provisioning',
            owner: 'Vendor Operations',
            notes: 'Review SOPs, sample device chain-of-custody records.',
          },
          {
            id: 'ai-003-5',
            time: 'Day 2 · 14:00 – 15:00',
            topic: 'Closing meeting — preliminary observations',
            owner: 'Auditor',
            notes: 'Share verbal preliminary observations; final report follows in 30 days.',
          },
        ],
      },
      approval_status: 'APPROVED',
      approved_by_name: 'Kiara Patel',
      approved_at: '2026-04-27T10:42:00Z',
    },
    checklist: {
      id: 'ch-003',
      audit_id: 'audit-003',
      content: {
        items: [
          {
            id: 'ci-003-1',
            prompt: 'Verify platform validation master plan is current and signed.',
            checkpoint_ref: '[D-004 STUB] SOP-VAL-001 §2.3',
            evidence_expected: true,
          },
          {
            id: 'ci-003-2',
            prompt: 'Confirm scoring algorithm change-control records for last 12 months.',
            checkpoint_ref: '[D-004 STUB] SOP-VAL-001 §4.1',
            evidence_expected: true,
          },
          {
            id: 'ci-003-3',
            prompt: 'Review audit trail samples for representative patient device sessions.',
            checkpoint_ref: '[D-004 STUB] SOP-21CFR-002',
            evidence_expected: true,
          },
          {
            id: 'ci-003-4',
            prompt: 'Inspect device-hygiene cleaning logs from the most recent two months.',
            checkpoint_ref: null,
            evidence_expected: true,
          },
          {
            id: 'ci-003-5',
            prompt: 'Walk through outage handling SOP — confirm step ownership and notifications.',
            checkpoint_ref: '[D-004 STUB] SOP-OPS-014',
            evidence_expected: false,
          },
        ],
      },
      // Still DRAFT — auditor is iterating
      approval_status: 'DRAFT',
      approved_by_name: null,
      approved_at: null,
    },
  },
};
