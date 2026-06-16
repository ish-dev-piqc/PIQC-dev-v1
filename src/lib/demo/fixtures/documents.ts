import type { ProtocolDocument } from '../../site/types';
import { DEMO_PROTOCOL_IDS } from '../ids';
import { addDays } from '../relativeDate';

// One protocol PDF per demo study (plus supplemental manuals for the primary
// study). Metadata only — the file content never gets fetched in demo mode
// (Ask responses are pre-canned in askResponses.ts). Document ids are stable
// so cross-document references in visitTemplates.ts resolve.
export function getDemoDocuments(): ProtocolDocument[] {
  return [
    {
      id: 'demo-doc-001',
      title: 'PP06489 — PledOx Protocol v5.0',
      source: 'Demo protocol PDF',
      filename: 'pp06489_pledox_protocol_v5.0.pdf',
      created_at: addDays(-30),
      status: 'ready',
      extracted_fields: {
        protocol_number: 'PP06489',
        sponsor: 'PledPharma AB',
        phase: 'Phase 3',
        // Mirrors what Reducto would populate for the SOTR drawer.
        protocol_title:
          'A Phase 3, double-blind, placebo-controlled study of PledOx on top of modified FOLFOX6 to prevent chemotherapy-induced peripheral neuropathy (CIPN) in adjuvant treatment of Stage III / high-risk Stage II colorectal cancer',
      },
    },
    // PP06489 supplemental docs — cross-document references in the visit drawer
    // cite these.
    {
      id: 'demo-doc-001-lab',
      title: 'PP06489 — Central Lab Manual v1.3',
      source: 'Demo supplemental PDF',
      filename: 'pp06489_central_lab_manual_v1.3.pdf',
      created_at: addDays(-25),
      status: 'ready',
      extracted_fields: { protocol_number: 'PP06489' },
    },
    {
      id: 'demo-doc-001-pharm',
      title: 'PP06489 — Pharmacy Manual v1.1 (PledOx preparation)',
      source: 'Demo supplemental PDF',
      filename: 'pp06489_pharmacy_manual_v1.1.pdf',
      created_at: addDays(-25),
      status: 'ready',
      extracted_fields: { protocol_number: 'PP06489' },
    },
    {
      id: 'demo-doc-002',
      title: 'CLR_18_06 — K0706 Protocol Amendment 02',
      source: 'Demo protocol PDF',
      filename: 'clr_18_06_k0706_protocol_amd02.pdf',
      created_at: addDays(-18),
      status: 'ready',
      extracted_fields: {
        protocol_number: 'CLR_18_06',
        sponsor: 'Sun Pharma Advanced Research Company (SPARC)',
        phase: 'Phase 2',
        protocol_title:
          'A Phase 2, randomized, double-blind, placebo-controlled study of K0706 in subjects with early Parkinson’s disease',
      },
    },
    {
      id: 'demo-doc-003',
      title: 'ND-L02-s0201-005 — Protocol Amendment 04',
      source: 'Demo protocol PDF',
      filename: 'nd-l02-s0201-005_protocol_amd04.pdf',
      created_at: addDays(-22),
      status: 'ready',
      extracted_fields: {
        protocol_number: 'ND-L02-s0201-005',
        sponsor: 'Nitto Denko Corporation',
        phase: 'Phase 2',
        protocol_title:
          'A Phase 2, randomized, double-blind, placebo-controlled study to evaluate the safety, tolerability, biological activity, and PK of ND-L02-s0201 in subjects with idiopathic pulmonary fibrosis (IPF)',
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
