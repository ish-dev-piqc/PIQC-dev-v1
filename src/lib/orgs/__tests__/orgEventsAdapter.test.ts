import { describe, expect, it } from 'vitest';
import {
  adaptOrgEvent,
  describeOrgEvent,
  eventGroup,
  ORG_EVENT_GROUP_LABEL,
  type OrgEventDescribeContext,
} from '../orgEventsAdapter';
import type { OrgEvent } from '../../../types/orgs';

// =============================================================================
// orgEventsAdapter — pure mapper + describe() smoke tests.
//
// Verifies the row→domain mapping handles missing payload, every known
// event_type produces a sentence containing the actor / target / protocol
// (when those are meaningful), and the same-actor-as-target branches read
// as "joined" / "left" rather than third-person.
// =============================================================================

const ctx: OrgEventDescribeContext = {
  userName: (uid) => {
    if (uid === 'u-1') return 'Kiara';
    if (uid === 'u-2') return 'Karl';
    return uid ? `User<${uid}>` : 'Someone';
  },
  protocolCode: (pid) => (pid === 'p-1' ? 'PP06489' : ''),
};

const baseRow = {
  id: 'ev-1',
  org_id: 'org-1',
  actor_user_id: 'u-1' as string | null,
  target_user_id: 'u-2' as string | null,
  target_protocol_id: null as string | null,
  payload: {} as Record<string, unknown> | null,
  created_at: '2026-06-04T12:00:00Z',
};

describe('adaptOrgEvent', () => {
  it('passes through every known field unchanged', () => {
    const e = adaptOrgEvent({
      ...baseRow,
      event_type: 'org_member_added',
      payload: { role: 'member' },
    });
    expect(e.id).toBe('ev-1');
    expect(e.org_id).toBe('org-1');
    expect(e.event_type).toBe('org_member_added');
    expect(e.actor_user_id).toBe('u-1');
    expect(e.target_user_id).toBe('u-2');
    expect(e.payload).toEqual({ role: 'member' });
  });

  it('defaults a null payload to an empty object', () => {
    const e = adaptOrgEvent({
      ...baseRow,
      event_type: 'org_member_removed',
      payload: null,
    });
    expect(e.payload).toEqual({});
  });
});

describe('describeOrgEvent', () => {
  it('renders an org_member_added as an "added by" sentence', () => {
    const sentence = describeOrgEvent(
      adaptOrgEvent({
        ...baseRow,
        event_type: 'org_member_added',
        payload: { role: 'admin' },
      }),
      ctx,
    );
    expect(sentence).toMatch(/Kiara/);
    expect(sentence).toMatch(/Karl/);
    expect(sentence).toMatch(/admin/);
  });

  it('renders an org_member_added with actor==target as "joined"', () => {
    const sentence = describeOrgEvent(
      adaptOrgEvent({
        ...baseRow,
        actor_user_id: 'u-2',
        target_user_id: 'u-2',
        event_type: 'org_member_added',
        payload: { role: 'member' },
      }),
      ctx,
    );
    expect(sentence).toContain('joined');
    expect(sentence).toContain('Karl');
  });

  it('renders org_member_role_changed with "promoted" for member→admin', () => {
    const sentence = describeOrgEvent(
      adaptOrgEvent({
        ...baseRow,
        event_type: 'org_member_role_changed',
        payload: { from: 'member', to: 'admin' },
      }),
      ctx,
    );
    expect(sentence).toContain('promoted');
    expect(sentence).toContain('Karl');
  });

  it('renders protocol_member_added with protocol code', () => {
    const sentence = describeOrgEvent(
      adaptOrgEvent({
        ...baseRow,
        event_type: 'protocol_member_added',
        target_protocol_id: 'p-1',
        payload: { role: 'coordinator' },
      }),
      ctx,
    );
    expect(sentence).toContain('PP06489');
    expect(sentence).toContain('coordinator');
  });

  it('renders invite_created with email + role from payload', () => {
    const sentence = describeOrgEvent(
      adaptOrgEvent({
        ...baseRow,
        event_type: 'invite_created',
        target_user_id: null,
        payload: { email: 'new@example.com', role: 'member' },
      }),
      ctx,
    );
    expect(sentence).toContain('new@example.com');
    expect(sentence).toContain('Kiara');
  });

  it('falls back gracefully on an unknown event_type', () => {
    const sentence = describeOrgEvent(
      adaptOrgEvent({
        ...baseRow,
        // Cast through unknown — we explicitly test the unknown-type branch.
        event_type: 'something_new' as unknown as 'org_member_added',
      }),
      ctx,
    );
    expect(sentence).toContain('Kiara');
    expect(sentence).toContain('something_new');
  });
});

describe('eventGroup', () => {
  it('groups added/removed events as "members"', () => {
    const e = adaptOrgEvent({ ...baseRow, event_type: 'org_member_added' });
    expect(eventGroup(e)).toBe('members');
  });

  it('groups role_changed events as "roles"', () => {
    const e = adaptOrgEvent({
      ...baseRow,
      event_type: 'protocol_member_role_changed',
    });
    expect(eventGroup(e)).toBe('roles');
  });

  it('groups invite events as "invites"', () => {
    const e = adaptOrgEvent({ ...baseRow, event_type: 'invite_cancelled' });
    expect(eventGroup(e)).toBe('invites');
  });

  it('groups access_request_approved as "access"', () => {
    const e = adaptOrgEvent({
      ...baseRow,
      event_type: 'access_request_approved',
    });
    expect(eventGroup(e)).toBe('access');
  });
});

describe('ORG_EVENT_GROUP_LABEL', () => {
  it('exports a label per group', () => {
    expect(ORG_EVENT_GROUP_LABEL.members).toBe('Members');
    expect(ORG_EVENT_GROUP_LABEL.roles).toBe('Roles');
    expect(ORG_EVENT_GROUP_LABEL.invites).toBe('Invites');
    expect(ORG_EVENT_GROUP_LABEL.access).toBe('Access');
  });
});

// Help TS narrow when assigning to OrgEvent — the adapter returns
// the union type, and these tests rely on that. Sanity check the
// imported type compiles in this position.
const _typeCheck: OrgEvent | null = null;
void _typeCheck;
