// =============================================================================
// Demo entity IDs — stable, valid UUID v4 format so they round-trip through
// any place that expects a UUID. The `d000-4000` pattern in the middle
// segments makes them easy to spot in logs as demo (not real) rows.
// =============================================================================

// NOTE: the object keys below are stable *internal aliases* only — they never
// surface in the UI (the displayed study identity comes from `code`/`name` in
// fixtures/protocols.ts). They intentionally keep their original names so the
// many `DEMO_PROTOCOL_IDS['BRIGHTEN-2']` references across the demo + visit-
// execution fixtures don't have to churn. Current alias → real study mapping:
//   'BRIGHTEN-2' → PP06489            (PledOx, Ph3 colorectal CIPN) — primary
//   'CARDIAC-7'  → CLR_18_06          (K0706, Ph2 early Parkinson's)
//   'IMMUNE-14'  → ND-L02-s0201-005   (Ph2 idiopathic pulmonary fibrosis)
//   'GLYCEMIC-11' → EFC14833          (Sotagliflozin, Ph3 type 2 diabetes)
export const DEMO_PROTOCOL_IDS = {
  'BRIGHTEN-2': '00000001-d000-4000-8000-000000000001',
  'CARDIAC-7':  '00000002-d000-4000-8000-000000000002',
  'IMMUNE-14':  '00000003-d000-4000-8000-000000000003',
  'GLYCEMIC-11': '00000004-d000-4000-8000-000000000004',
} as const;

// Participant UUIDs — keyed by the human participant_code. Used for FK
// joins inside the demo repo (e.g. site_visits.participant_id → uuid).
export const DEMO_PARTICIPANT_UUIDS: Record<string, string> = {
  'P-0019': '00000019-d000-4000-8000-000000000001',
  'P-0023': '00000023-d000-4000-8000-000000000001',
  'P-0045': '00000045-d000-4000-8000-000000000001',
  'P-0051': '00000051-d000-4000-8000-000000000001',
  'P-0011': '00000011-d000-4000-8000-000000000001',
  'P-0005': '00000005-d000-4000-8000-000000000001',
  'P-0030': '00000030-d000-4000-8000-000000000001',
  'P-0061': '00000061-d000-4000-8000-000000000001',
  'P-0008': '00000008-d000-4000-8000-000000000002',
  'P-0012': '00000012-d000-4000-8000-000000000002',
  'P-0031': '00000031-d000-4000-8000-000000000003',
  'P-0072': '00000072-d000-4000-8000-000000000004',
  'P-0084': '00000084-d000-4000-8000-000000000004',
  'P-0093': '00000093-d000-4000-8000-000000000004',
  'P-0107': '00000107-d000-4000-8000-000000000004',
};
