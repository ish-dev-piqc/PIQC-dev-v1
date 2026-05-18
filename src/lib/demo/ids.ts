// =============================================================================
// Demo entity IDs — stable, valid UUID v4 format so they round-trip through
// any place that expects a UUID. The `d000-4000` pattern in the middle
// segments makes them easy to spot in logs as demo (not real) rows.
// =============================================================================

export const DEMO_PROTOCOL_IDS = {
  'BRIGHTEN-2': '00000001-d000-4000-8000-000000000001',
  'CARDIAC-7':  '00000002-d000-4000-8000-000000000002',
  'IMMUNE-14':  '00000003-d000-4000-8000-000000000003',
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
};
