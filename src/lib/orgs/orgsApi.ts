// =============================================================================
// Orgs API — Result<T> facade over Supabase for org membership + protocol-
// level access control.
//
// Consolidates the previous orgApi.ts (org-level: fetchCurrentUserOrg,
// listOrgMembers-with-profile-join, invites, role management) and the
// org-workspaces additions (multi-org listing, protocol_members, access
// requests, guests). One canonical API file for the orgs domain.
//
// Surface:
//   Org-level
//     fetchCurrentUserOrg, listMyOrgs, listOrgMembersWithProfile,
//     currentUserIsOrgAdmin, updateOrgMemberRole, removeOrgMember
//   Org invites (legacy email-token flow)
//     createOrgInvite, acceptOrgInvite, listOrgInvites, buildInviteUrl
//   Protocol members
//     listProtocolMembers, addProtocolMember,
//     updateProtocolMemberRole, removeProtocolMember
//   Access requests
//     listMyAccessRequests, listProtocolAccessRequests,
//     createAccessRequest, withdrawAccessRequest,
//     denyAccessRequest, approveAccessRequest (RPC)
//   Guests
//     listProtocolGuests, inviteGuest, revokeGuest,
//     acceptGuestInvite (RPC)
//
// Token generation for guest invites uses crypto.randomUUID() client-side.
// Sufficient for 30-day single-protocol-scoped invites; move to server-side
// RPC if we tighten security later.
// =============================================================================

import { supabase } from '../supabase';
import type {
  AcceptedGuestInvite,
  NewProtocolGuestInput,
  NewProtocolMemberInput,
  Org,
  OrgInvite,
  OrgMemberWithProfile,
  OrgRole,
  OrgRow,
  OrgWithMembership,
  ProtocolAccessRequest,
  ProtocolGuest,
  ProtocolMember,
  ProtocolMemberPatch,
} from '../../types/orgs';
import { adaptAccessRequest, adaptAccessRequests } from './accessRequestsAdapter';
import { adaptGuest, adaptGuests } from './guestsAdapter';
import { adaptProtocolMember, adaptProtocolMembers } from './protocolMembersAdapter';

export type Result<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };

function err<T>(message: string): Result<T> {
  return { ok: false, error: message };
}

function fail<T>(label: string, error: unknown): Result<T> {
  const msg = error instanceof Error ? error.message : String(error);
  console.error(`[orgsApi] ${label}:`, error);
  return { ok: false, error: msg };
}


// ===========================================================================
// Org-level
// ===========================================================================

/** Fetch the single org linked from user_profiles.org_id. Legacy single-org path. */
export async function fetchCurrentUserOrg(): Promise<Result<OrgRow | null>> {
  try {
    const { data: sessionData } = await supabase.auth.getUser();
    const userId = sessionData?.user?.id;
    if (!userId) return err('Not authenticated.');

    const { data: profile, error: profileError } = await supabase
      .from('user_profiles')
      .select('org_id')
      .eq('id', userId)
      .maybeSingle();
    if (profileError) throw profileError;
    if (!profile?.org_id) return { ok: true, data: null };

    const { data: org, error: orgError } = await supabase
      .from('orgs')
      .select('id, name, slug, created_at')
      .eq('id', profile.org_id)
      .maybeSingle();
    if (orgError) throw orgError;
    return { ok: true, data: org as OrgRow | null };
  } catch (e) {
    return fail('fetchCurrentUserOrg', e);
  }
}

/** List every org the caller is a member of (multi-org support). */
export async function listMyOrgs(): Promise<Result<OrgWithMembership[]>> {
  const { data, error } = await supabase
    .from('org_members')
    .select('role, orgs(id, name, slug, created_by, created_at, updated_at)');

  if (error) return err(error.message);
  if (!data) return { ok: true, data: [] };

  // Supabase's inferred type widens orgs to a possible array; this join is
  // 1:1 (org_members.org_id → orgs.id), so cast through unknown to land on
  // the actual single-org shape.
  const rows = data as unknown as Array<{
    role: OrgRole;
    orgs: Org | null;
  }>;

  const orgs: OrgWithMembership[] = rows
    .filter((r): r is { role: OrgRole; orgs: Org } => r.orgs !== null)
    .map((r) => ({ ...r.orgs, my_role: r.role }));

  return { ok: true, data: orgs };
}

/** List org members with user_profiles.name joined. RLS scopes to org members only. */
export async function listOrgMembersWithProfile(
  orgId: string,
): Promise<Result<OrgMemberWithProfile[]>> {
  try {
    const { data, error } = await supabase
      .from('org_members')
      .select('org_id, user_id, role, joined_at, user_profiles!inner(name)')
      .eq('org_id', orgId);
    if (error) throw error;

    // user_profiles doesn't expose email — auth.users.email lives elsewhere.
    // Future: pull from auth.users via an RPC.
    const rows: OrgMemberWithProfile[] = (data ?? []).map((row) => {
      const profile = Array.isArray(row.user_profiles) ? row.user_profiles[0] : row.user_profiles;
      return {
        org_id: row.org_id as string,
        user_id: row.user_id as string,
        role: row.role as OrgRole,
        joined_at: row.joined_at as string,
        name: (profile as { name: string } | null)?.name ?? '(unknown user)',
        email: null,
      };
    });
    return { ok: true, data: rows };
  } catch (e) {
    return fail('listOrgMembersWithProfile', e);
  }
}

export async function currentUserIsOrgAdmin(orgId: string): Promise<boolean> {
  const { data: sessionData } = await supabase.auth.getUser();
  const userId = sessionData?.user?.id;
  if (!userId) return false;
  const { data } = await supabase
    .from('org_members')
    .select('role')
    .eq('org_id', orgId)
    .eq('user_id', userId)
    .maybeSingle();
  return data?.role === 'admin';
}

export async function updateOrgMemberRole(
  orgId: string,
  userId: string,
  role: OrgRole,
): Promise<Result<void>> {
  try {
    const { error } = await supabase
      .from('org_members')
      .update({ role })
      .eq('org_id', orgId)
      .eq('user_id', userId);
    if (error) throw error;
    return { ok: true, data: undefined };
  } catch (e) {
    return fail('updateOrgMemberRole', e);
  }
}

export async function removeOrgMember(
  orgId: string,
  userId: string,
): Promise<Result<void>> {
  try {
    const { error } = await supabase
      .from('org_members')
      .delete()
      .eq('org_id', orgId)
      .eq('user_id', userId);
    if (error) throw error;
    return { ok: true, data: undefined };
  } catch (e) {
    return fail('removeOrgMember', e);
  }
}


// ===========================================================================
// Org invites (legacy email-token flow from PR #95)
// ===========================================================================

export async function createOrgInvite(
  orgId: string,
  email: string,
  role: OrgRole,
): Promise<Result<{ id: string; token: string; expires_at: string }>> {
  try {
    const { data, error } = await supabase.rpc('create_org_invite', {
      p_org_id: orgId,
      p_email: email,
      p_role: role,
    });
    if (error) throw error;
    const row = Array.isArray(data) ? data[0] : data;
    if (!row?.token) throw new Error('RPC returned no token');
    return {
      ok: true,
      data: { id: row.id, token: row.token, expires_at: row.expires_at },
    };
  } catch (e) {
    return fail('createOrgInvite', e);
  }
}

export async function acceptOrgInvite(
  token: string,
): Promise<Result<{ org_id: string; org_name: string; role: OrgRole }>> {
  try {
    const { data, error } = await supabase.rpc('accept_org_invite', { p_token: token });
    if (error) throw error;
    const row = Array.isArray(data) ? data[0] : data;
    if (!row?.org_id) throw new Error('RPC returned no org_id');
    return {
      ok: true,
      data: {
        org_id: row.org_id,
        org_name: row.org_name,
        role: row.role as OrgRole,
      },
    };
  } catch (e) {
    return fail('acceptOrgInvite', e);
  }
}

export async function listOrgInvites(orgId: string): Promise<Result<OrgInvite[]>> {
  try {
    const { data, error } = await supabase.rpc('list_org_invites', { p_org_id: orgId });
    if (error) throw error;
    return { ok: true, data: (data ?? []) as OrgInvite[] };
  } catch (e) {
    return fail('listOrgInvites', e);
  }
}

/** Build a shareable invite URL from a token. Uses location.origin so it
 *  works in dev, staging, and prod automatically. */
export function buildInviteUrl(token: string): string {
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const base = typeof window !== 'undefined' ? window.location.pathname : '/';
  const rootPath = base.replace(/\/+$/, '').replace(/\/[^/]+$/, '/');
  return `${origin}${rootPath}?invite=${encodeURIComponent(token)}`;
}


// ===========================================================================
// Protocol members
// ===========================================================================

export async function listProtocolMembers(
  protocolId: string,
): Promise<Result<ProtocolMember[]>> {
  const { data, error } = await supabase
    .from('protocol_members')
    .select('protocol_id, user_id, role, added_at, added_by')
    .eq('protocol_id', protocolId);

  if (error) return err(error.message);
  return { ok: true, data: adaptProtocolMembers(data ?? []) };
}

export async function addProtocolMember(
  input: NewProtocolMemberInput,
): Promise<Result<ProtocolMember>> {
  const { data, error } = await supabase
    .from('protocol_members')
    .insert({
      protocol_id: input.protocol_id,
      user_id: input.user_id,
      role: input.role,
    })
    .select('protocol_id, user_id, role, added_at, added_by')
    .single();

  if (error) return err(error.message);
  if (!data) return err('Insert returned no row');
  return { ok: true, data: adaptProtocolMember(data) };
}

export async function updateProtocolMemberRole(
  protocolId: string,
  userId: string,
  patch: ProtocolMemberPatch,
): Promise<Result<ProtocolMember>> {
  const { data, error } = await supabase
    .from('protocol_members')
    .update({ role: patch.role })
    .eq('protocol_id', protocolId)
    .eq('user_id', userId)
    .select('protocol_id, user_id, role, added_at, added_by')
    .single();

  if (error) return err(error.message);
  if (!data) return err('Update returned no row');
  return { ok: true, data: adaptProtocolMember(data) };
}

export async function removeProtocolMember(
  protocolId: string,
  userId: string,
): Promise<Result<void>> {
  const { error } = await supabase
    .from('protocol_members')
    .delete()
    .eq('protocol_id', protocolId)
    .eq('user_id', userId);

  if (error) return err(error.message);
  return { ok: true, data: undefined };
}


// ===========================================================================
// Access requests
// ===========================================================================

export async function listMyAccessRequests(): Promise<Result<ProtocolAccessRequest[]>> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return err('Not authenticated');

  const { data, error } = await supabase
    .from('protocol_access_requests')
    .select('id, protocol_id, user_id, status, message, requested_at, resolved_at, resolved_by')
    .eq('user_id', user.id)
    .order('requested_at', { ascending: false });

  if (error) return err(error.message);
  return { ok: true, data: adaptAccessRequests(data ?? []) };
}

export async function listProtocolAccessRequests(
  protocolId: string,
): Promise<Result<ProtocolAccessRequest[]>> {
  const { data, error } = await supabase
    .from('protocol_access_requests')
    .select('id, protocol_id, user_id, status, message, requested_at, resolved_at, resolved_by')
    .eq('protocol_id', protocolId)
    .order('requested_at', { ascending: false });

  if (error) return err(error.message);
  return { ok: true, data: adaptAccessRequests(data ?? []) };
}

export async function createAccessRequest(
  protocolId: string,
  message?: string,
): Promise<Result<ProtocolAccessRequest>> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return err('Not authenticated');

  const { data, error } = await supabase
    .from('protocol_access_requests')
    .insert({ protocol_id: protocolId, user_id: user.id, message: message ?? null })
    .select('id, protocol_id, user_id, status, message, requested_at, resolved_at, resolved_by')
    .single();

  if (error) return err(error.message);
  if (!data) return err('Insert returned no row');
  return { ok: true, data: adaptAccessRequest(data) };
}

export async function withdrawAccessRequest(
  requestId: string,
): Promise<Result<ProtocolAccessRequest>> {
  const { data, error } = await supabase
    .from('protocol_access_requests')
    .update({ status: 'withdrawn' })
    .eq('id', requestId)
    .eq('status', 'pending')
    .select('id, protocol_id, user_id, status, message, requested_at, resolved_at, resolved_by')
    .single();

  if (error) return err(error.message);
  if (!data) return err('Update returned no row (already resolved?)');
  return { ok: true, data: adaptAccessRequest(data) };
}

export async function denyAccessRequest(
  requestId: string,
): Promise<Result<ProtocolAccessRequest>> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return err('Not authenticated');

  const { data, error } = await supabase
    .from('protocol_access_requests')
    .update({ status: 'denied', resolved_at: new Date().toISOString(), resolved_by: user.id })
    .eq('id', requestId)
    .eq('status', 'pending')
    .select('id, protocol_id, user_id, status, message, requested_at, resolved_at, resolved_by')
    .single();

  if (error) return err(error.message);
  if (!data) return err('Update returned no row');
  return { ok: true, data: adaptAccessRequest(data) };
}

interface ApproveAccessRpcResponse {
  ok: boolean;
  error?: string;
  request_id?: string;
  protocol_id?: string;
  user_id?: string;
}

export async function approveAccessRequest(
  requestId: string,
): Promise<Result<{ requestId: string; protocolId: string; userId: string }>> {
  const { data, error } = await supabase.rpc('approve_protocol_access_request', {
    p_request_id: requestId,
  });

  if (error) return err(error.message);
  const payload = data as ApproveAccessRpcResponse;
  if (!payload?.ok) return err(payload?.error ?? 'unknown_error');
  return {
    ok: true,
    data: {
      requestId: payload.request_id!,
      protocolId: payload.protocol_id!,
      userId: payload.user_id!,
    },
  };
}


// ===========================================================================
// Guests
// ===========================================================================

export async function listProtocolGuests(
  protocolId: string,
): Promise<Result<ProtocolGuest[]>> {
  const { data, error } = await supabase
    .from('protocol_guests')
    .select(
      'id, protocol_id, invited_email, invited_by, user_id, invite_token, ' +
        'accepted_at, expires_at, is_paid_seat, created_at',
    )
    .eq('protocol_id', protocolId)
    .order('created_at', { ascending: false });

  if (error) return err(error.message);
  return {
    ok: true,
    data: adaptGuests((data ?? []) as unknown as Parameters<typeof adaptGuests>[0]),
  };
}

export async function inviteGuest(
  input: NewProtocolGuestInput,
): Promise<Result<ProtocolGuest>> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return err('Not authenticated');

  const token = crypto.randomUUID();

  const { data, error } = await supabase
    .from('protocol_guests')
    .insert({
      protocol_id: input.protocol_id,
      invited_email: input.invited_email,
      invited_by: user.id,
      invite_token: token,
      expires_at: input.expires_at ?? undefined,
      is_paid_seat: input.is_paid_seat ?? false,
    })
    .select(
      'id, protocol_id, invited_email, invited_by, user_id, invite_token, ' +
        'accepted_at, expires_at, is_paid_seat, created_at',
    )
    .single();

  if (error) return err(error.message);
  if (!data) return err('Insert returned no row');
  return { ok: true, data: adaptGuest(data as unknown as Parameters<typeof adaptGuest>[0]) };
}

export async function revokeGuest(guestId: string): Promise<Result<void>> {
  const { error } = await supabase.from('protocol_guests').delete().eq('id', guestId);
  if (error) return err(error.message);
  return { ok: true, data: undefined };
}

interface AcceptGuestRpcResponse {
  ok: boolean;
  error?: string;
  guest_id?: string;
  protocol_id?: string;
  accepted_at?: string;
}

export async function acceptGuestInvite(
  token: string,
): Promise<Result<AcceptedGuestInvite>> {
  const { data, error } = await supabase.rpc('accept_protocol_guest_invite', {
    p_token: token,
  });

  if (error) return err(error.message);
  const payload = data as AcceptGuestRpcResponse;
  if (!payload?.ok) return err(payload?.error ?? 'unknown_error');
  return {
    ok: true,
    data: {
      guest_id: payload.guest_id!,
      protocol_id: payload.protocol_id!,
      accepted_at: payload.accepted_at!,
    },
  };
}
