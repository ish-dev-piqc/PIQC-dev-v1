// =============================================================================
// Orgs API (plural) — Result<T> facade over Supabase for the org-workspaces
// domain. Complementary to `orgApi.ts` (singular), which covers org-level
// operations (fetchCurrentUserOrg, listOrgMembers-with-joined-names, invites).
// This file handles the *new* protocol-level surface introduced by the
// org-workspaces feature: protocol_members, access_requests, guests, plus a
// listMyOrgs helper for multi-org users (extends fetchCurrentUserOrg's
// single-primary-org reply).
//
// Surface:
//   Multi-org helper ................ listMyOrgs
//   Protocol members (CRUD) ......... listProtocolMembers, addProtocolMember,
//                                     updateProtocolMemberRole, removeProtocolMember
//   Access requests ................. listMyAccessRequests, listProtocolAccessRequests,
//                                     createAccessRequest, withdrawAccessRequest,
//                                     denyAccessRequest, approveAccessRequest (RPC)
//   Guests .......................... listProtocolGuests, inviteGuest, revokeGuest,
//                                     acceptGuestInvite (RPC)
//
// For org member rosters with name/email joined, use `orgApi.listOrgMembers`.
// This file's `OrgMember` type intentionally mirrors only the raw row.
//
// Result<T> shape matches src/lib/site/repos/types.ts so consumers can use
// uniform `if (!res.ok) return …` patterns.
//
// Token generation for guest invites uses crypto.randomUUID() client-side.
// For v1 this is sufficient — invites expire in 30 days and aren't
// privilege-bearing beyond the protocol they're scoped to. If we tighten
// security later, move generation to a server-side RPC.
// =============================================================================

import { supabase } from '../supabase';
import type {
  AcceptedGuestInvite,
  NewProtocolGuestInput,
  NewProtocolMemberInput,
  Org,
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


// ---------------------------------------------------------------------------
// Orgs (reads — Ishika's existing tables, no writes from this domain)
// ---------------------------------------------------------------------------

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
    role: 'admin' | 'member';
    orgs: Org | null;
  }>;

  const orgs: OrgWithMembership[] = rows
    .filter((r): r is { role: 'admin' | 'member'; orgs: Org } => r.orgs !== null)
    .map((r) => ({ ...r.orgs, my_role: r.role }));

  return { ok: true, data: orgs };
}

// For listOrgMembers (with joined name/email), use `orgApi.listOrgMembers`.


// ---------------------------------------------------------------------------
// Protocol members
// ---------------------------------------------------------------------------

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


// ---------------------------------------------------------------------------
// Access requests
// ---------------------------------------------------------------------------

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


// ---------------------------------------------------------------------------
// Guests
// ---------------------------------------------------------------------------

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
  // supabase-js's inferred row type carries GenericStringError when select
  // is built from a string literal; cast through unknown to the adapter's
  // expected shape.
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

  // Token generation is client-side for v1. crypto.randomUUID is 122 bits
  // of entropy — enough for a 30-day, single-protocol-scoped invite.
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
