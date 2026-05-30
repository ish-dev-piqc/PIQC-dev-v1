import type { ProtocolDocument } from '../../site/types';
import { DEMO_PROTOCOL_IDS } from '../ids';
import { addDays } from '../relativeDate';

// One protocol PDF per demo study. Metadata only — the file content never
// gets fetched in demo mode (Ask responses are pre-canned in askResponses.ts).
export function getDemoDocuments(): ProtocolDocument[] {
  return [
    {
      id: 'demo-doc-001',
      title: 'BRIGHTEN-2 — Protocol v4.0',
      source: 'Demo protocol PDF',
      filename: 'brighten-2_protocol_v4.0.pdf',
      created_at: addDays(-30),
      status: 'ready',
      extracted_fields: {
        protocol_number: 'BRIGHTEN-2',
        sponsor: 'Demo Sponsor A',
        phase: 'Phase 2',
        // Mirrors what Reducto would populate for the SOTR drawer.
        protocol_title:
          'BRIGHTEN-2: Phase 2 study evaluating investigational therapy in major depressive disorder',
      },
    },
    // BRIGHTEN-2 supplemental docs — cross-document references in
    // visit drawer cite these.
    {
      id: 'demo-doc-001-lab',
      title: 'BRIGHTEN-2 — Central Lab Manual v1.3',
      source: 'Demo supplemental PDF',
      filename: 'brighten-2_central_lab_manual_v1.3.pdf',
      created_at: addDays(-25),
      status: 'ready',
      extracted_fields: { protocol_number: 'BRIGHTEN-2' },
    },
    {
      id: 'demo-doc-001-pharm',
      title: 'BRIGHTEN-2 — Pharmacy Manual v1.1',
      source: 'Demo supplemental PDF',
      filename: 'brighten-2_pharmacy_manual_v1.1.pdf',
      created_at: addDays(-25),
      status: 'ready',
      extracted_fields: { protocol_number: 'BRIGHTEN-2' },
    },
    {
      id: 'demo-doc-002',
      title: 'CARDIAC-7 — Protocol v2.1',
      source: 'Demo protocol PDF',
      filename: 'cardiac-7_protocol_v2.1.pdf',
      created_at: addDays(-18),
      status: 'ready',
      extracted_fields: {
        protocol_number: 'CARDIAC-7',
        sponsor: 'Demo Sponsor B',
        phase: 'Phase 3',
        protocol_title: 'CARDIAC-7: Phase 3 outcomes trial in chronic heart failure',
      },
    },
    {
      id: 'demo-doc-003',
      title: 'IMMUNE-14 — Protocol v1.0',
      source: 'Demo protocol PDF',
      filename: 'immune-14_protocol_v1.0.pdf',
      created_at: addDays(-22),
      status: 'ready',
      extracted_fields: {
        protocol_number: 'IMMUNE-14',
        sponsor: 'Demo Sponsor C',
        phase: 'Phase 1',
        protocol_title: 'IMMUNE-14: Phase 1 first-in-human dose-escalation in autoimmune disease',
      },
    },
  ];
}

// Map demo protocol id → ids of documents tagged to it. Used by the demo repo
// to scope documents per protocol the way the documents.protocol_id column does
// in real mode.
export const DEMO_DOCS_BY_PROTOCOL: Record<string, string[]> = {
  [DEMO_PROTOCOL_IDS['BRIGHTEN-2']]: ['demo-doc-001', 'demo-doc-001-lab', 'demo-doc-001-pharm'],
  [DEMO_PROTOCOL_IDS['CARDIAC-7']]: ['demo-doc-002'],
  [DEMO_PROTOCOL_IDS['IMMUNE-14']]: ['demo-doc-003'],
};
