// =============================================================================
// protocol_access_requests — row → ProtocolAccessRequest pure mapper.
// =============================================================================

import type {
  ProtocolAccessRequest,
  ProtocolAccessRequestStatus,
} from '../../types/orgs';

interface ProtocolAccessRequestRow {
  id: string;
  protocol_id: string;
  user_id: string;
  status: string;
  message: string | null;
  requested_at: string;
  resolved_at: string | null;
  resolved_by: string | null;
}

function isAccessRequestStatus(value: string): value is ProtocolAccessRequestStatus {
  return (
    value === 'pending' ||
    value === 'approved' ||
    value === 'denied' ||
    value === 'withdrawn'
  );
}

export function adaptAccessRequest(row: ProtocolAccessRequestRow): ProtocolAccessRequest {
  if (!isAccessRequestStatus(row.status)) {
    throw new Error(`Invalid protocol_access_request status from DB: ${row.status}`);
  }
  return {
    id: row.id,
    protocol_id: row.protocol_id,
    user_id: row.user_id,
    status: row.status,
    message: row.message,
    requested_at: row.requested_at,
    resolved_at: row.resolved_at,
    resolved_by: row.resolved_by,
  };
}

export function adaptAccessRequests(rows: ProtocolAccessRequestRow[]): ProtocolAccessRequest[] {
  return rows.map(adaptAccessRequest);
}
