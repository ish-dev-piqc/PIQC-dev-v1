// =============================================================================
// protocol_guests — row → ProtocolGuest pure mapper.
// =============================================================================

import type { ProtocolGuest } from '../../types/orgs';

interface ProtocolGuestRow {
  id: string;
  protocol_id: string;
  invited_email: string;
  invited_by: string;
  user_id: string | null;
  invite_token: string;
  accepted_at: string | null;
  expires_at: string;
  is_paid_seat: boolean;
  created_at: string;
}

export function adaptGuest(row: ProtocolGuestRow): ProtocolGuest {
  return {
    id: row.id,
    protocol_id: row.protocol_id,
    invited_email: row.invited_email,
    invited_by: row.invited_by,
    user_id: row.user_id,
    invite_token: row.invite_token,
    accepted_at: row.accepted_at,
    expires_at: row.expires_at,
    is_paid_seat: row.is_paid_seat,
    created_at: row.created_at,
  };
}

export function adaptGuests(rows: ProtocolGuestRow[]): ProtocolGuest[] {
  return rows.map(adaptGuest);
}

/** Number of accepted, non-expired, non-paid guests on a protocol — for cap checks. */
export function countActiveFreeGuests(rows: ProtocolGuestRow[]): number {
  const now = Date.now();
  return rows.filter(
    (r) =>
      r.accepted_at !== null &&
      !r.is_paid_seat &&
      (r.expires_at === null || new Date(r.expires_at).getTime() > now),
  ).length;
}
