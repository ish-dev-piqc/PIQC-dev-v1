import type { OrgEvent, OrgEventType } from '../../types/orgs';

// =============================================================================
// orgEventsAdapter — pure mapper from raw org_events row to OrgEvent +
// describe() helper that produces a human-readable sentence per event.
//
// Pure: no Supabase / network / React imports. Both functions are total
// (i.e. handle unknown event_type values defensively) so the API layer
// can pass rows through without try/catch.
// =============================================================================

interface RawOrgEventRow {
  id: string;
  org_id: string;
  event_type: string;
  actor_user_id: string | null;
  target_user_id: string | null;
  target_protocol_id: string | null;
  payload: Record<string, unknown> | null;
  created_at: string;
}

const KNOWN_EVENT_TYPES: ReadonlySet<OrgEventType> = new Set<OrgEventType>([
  'org_member_added',
  'org_member_removed',
  'org_member_role_changed',
  'protocol_member_added',
  'protocol_member_removed',
  'protocol_member_role_changed',
  'invite_created',
  'invite_cancelled',
  'access_request_approved',
]);

export function adaptOrgEvent(row: RawOrgEventRow): OrgEvent {
  // Unknown event_type → keep as-is in payload so the UI can render a
  // generic line. The union widening below is safe because the adapter
  // never asserts a value outside KNOWN_EVENT_TYPES is a member of the
  // union; describe() does its own runtime check.
  return {
    id: row.id,
    org_id: row.org_id,
    event_type: row.event_type as OrgEventType,
    actor_user_id: row.actor_user_id,
    target_user_id: row.target_user_id,
    target_protocol_id: row.target_protocol_id,
    payload: row.payload ?? {},
    created_at: row.created_at,
  };
}

// ---------------------------------------------------------------------------
// describe(event, ctx) — sentence renderer
// ---------------------------------------------------------------------------

export interface OrgEventDescribeContext {
  /** user_id → display name (first name only is fine). */
  userName: (userId: string | null) => string;
  /** protocol_id → display code (e.g. "PP06489"). */
  protocolCode: (protocolId: string | null) => string;
}

/** Read a string field from a JSONB payload with a fallback. */
function readStr(payload: Record<string, unknown>, key: string, fallback = ''): string {
  const v = payload[key];
  return typeof v === 'string' ? v : fallback;
}

export function describeOrgEvent(
  event: OrgEvent,
  ctx: OrgEventDescribeContext,
): string {
  const actor = ctx.userName(event.actor_user_id);
  const target = ctx.userName(event.target_user_id);
  const protocol = ctx.protocolCode(event.target_protocol_id);
  const sameActorTarget =
    event.actor_user_id !== null && event.actor_user_id === event.target_user_id;

  if (!KNOWN_EVENT_TYPES.has(event.event_type)) {
    return `${actor || 'Someone'} performed ${event.event_type}`;
  }

  switch (event.event_type) {
    case 'org_member_added': {
      // Subsumes invite-accept: actor == target means the new member is
      // the one who just accepted; otherwise an admin directly added them.
      const role = readStr(event.payload, 'role', 'member');
      if (sameActorTarget) return `${target} joined as ${role}`;
      return `${actor} added ${target} as ${role}`;
    }
    case 'org_member_removed': {
      const prev = readStr(event.payload, 'prev_role');
      if (sameActorTarget) return `${target} left the organization`;
      return prev
        ? `${actor} removed ${target} (was ${prev})`
        : `${actor} removed ${target}`;
    }
    case 'org_member_role_changed': {
      const from = readStr(event.payload, 'from');
      const to = readStr(event.payload, 'to');
      if (from && to) {
        // Promoted vs demoted — purely cosmetic; only matters for admin <-> member.
        if (from === 'member' && to === 'admin') {
          return `${actor} promoted ${target} from member to admin`;
        }
        if (from === 'admin' && to === 'member') {
          return `${actor} demoted ${target} from admin to member`;
        }
        return `${actor} changed ${target}'s role from ${from} to ${to}`;
      }
      return `${actor} changed ${target}'s role`;
    }
    case 'protocol_member_added': {
      const role = readStr(event.payload, 'role', 'member');
      const on = protocol ? ` on ${protocol}` : '';
      if (sameActorTarget) return `${target} joined ${protocol || 'a protocol'} as ${role}`;
      return `${actor} added ${target}${on} as ${role}`;
    }
    case 'protocol_member_removed': {
      const on = protocol ? ` from ${protocol}` : '';
      if (sameActorTarget) return `${target} left ${protocol || 'a protocol'}`;
      return `${actor} removed ${target}${on}`;
    }
    case 'protocol_member_role_changed': {
      const from = readStr(event.payload, 'from');
      const to = readStr(event.payload, 'to');
      const on = protocol ? ` on ${protocol}` : '';
      if (from && to) {
        return `${actor} changed ${target}'s role${on} from ${from} to ${to}`;
      }
      return `${actor} changed ${target}'s role${on}`;
    }
    case 'invite_created': {
      const email = readStr(event.payload, 'email', 'someone');
      const role = readStr(event.payload, 'role', 'member');
      return `${actor} invited ${email} as ${role}`;
    }
    case 'invite_cancelled': {
      const email = readStr(event.payload, 'email', 'an invite');
      return `${actor} cancelled invite to ${email}`;
    }
    case 'access_request_approved': {
      const on = protocol ? ` to ${protocol}` : '';
      return `${actor} approved ${target}'s access request${on}`;
    }
  }
}

// ---------------------------------------------------------------------------
// Filter groups — used by ActivityTab's chip filter row.
// ---------------------------------------------------------------------------

export type OrgEventGroup = 'members' | 'roles' | 'invites' | 'access';

export const ORG_EVENT_GROUP_LABEL: Record<OrgEventGroup, string> = {
  members: 'Members',
  roles: 'Roles',
  invites: 'Invites',
  access: 'Access',
};

export function eventGroup(event: OrgEvent): OrgEventGroup | null {
  switch (event.event_type) {
    case 'org_member_added':
    case 'org_member_removed':
    case 'protocol_member_added':
    case 'protocol_member_removed':
      return 'members';
    case 'org_member_role_changed':
    case 'protocol_member_role_changed':
      return 'roles';
    case 'invite_created':
    case 'invite_cancelled':
      return 'invites';
    case 'access_request_approved':
      return 'access';
    default:
      return null;
  }
}
