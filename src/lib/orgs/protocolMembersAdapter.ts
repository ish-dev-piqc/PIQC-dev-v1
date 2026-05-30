// =============================================================================
// protocol_members — row → ProtocolMember pure mapper.
//
// Direct shape mirror; included for consistency with other mode adapters.
// No I/O, no side effects.
// =============================================================================

import type { ProtocolMember, ProtocolMemberRole } from '../../types/orgs';

interface ProtocolMemberRow {
  protocol_id: string;
  user_id: string;
  role: string;
  added_at: string;
  added_by: string | null;
}

function isProtocolMemberRole(value: string): value is ProtocolMemberRole {
  return value === 'coordinator' || value === 'member' || value === 'viewer';
}

export function adaptProtocolMember(row: ProtocolMemberRow): ProtocolMember {
  if (!isProtocolMemberRole(row.role)) {
    throw new Error(`Invalid protocol_member role from DB: ${row.role}`);
  }
  return {
    protocol_id: row.protocol_id,
    user_id: row.user_id,
    role: row.role,
    added_at: row.added_at,
    added_by: row.added_by,
  };
}

export function adaptProtocolMembers(rows: ProtocolMemberRow[]): ProtocolMember[] {
  return rows.map(adaptProtocolMember);
}
