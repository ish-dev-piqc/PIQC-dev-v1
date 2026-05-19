// =============================================================================
// orgs API — wrappers around the Supabase RPCs / direct table reads for the
// org membership + invite flow. Doesn't go through the SiteRepo dispatcher
// because demo mode doesn't simulate orgs (the drawer is read-only in demo).
// =============================================================================

import { supabase } from '../supabase';

export type Result<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };

export interface OrgRow {
  id: string;
  name: string;
  slug: string;
  created_at: string;
}

export interface OrgMember {
  org_id: string;
  user_id: string;
  role: 'admin' | 'member';
  joined_at: string;
  // Joined fields from user_profiles
  name: string;
  email: string | null;
}

export interface OrgInvite {
  id: string;
  email: string;
  role: 'admin' | 'member';
  token: string;
  expires_at: string;
  created_at: string;
}

function fail<T>(label: string, error: unknown): Result<T> {
  const msg = error instanceof Error ? error.message : String(error);
  console.error(`[orgApi] ${label}:`, error);
  return { ok: false, error: msg };
}

// -----------------------------------------------------------------------------
// Fetch the current user's primary org (the one linked from user_profiles).
// -----------------------------------------------------------------------------
export async function fetchCurrentUserOrg(): Promise<Result<OrgRow | null>> {
  try {
    const { data: sessionData } = await supabase.auth.getUser();
    const userId = sessionData?.user?.id;
    if (!userId) return { ok: false, error: 'Not authenticated.' };

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

// -----------------------------------------------------------------------------
// List members of an org with their display name + email joined from
// user_profiles. RLS scopes the org_members read to members of the org.
// -----------------------------------------------------------------------------
export async function listOrgMembers(orgId: string): Promise<Result<OrgMember[]>> {
  try {
    const { data, error } = await supabase
      .from('org_members')
      .select('org_id, user_id, role, joined_at, user_profiles!inner(name)')
      .eq('org_id', orgId);
    if (error) throw error;

    // user_profiles doesn't expose email — auth.users.email lives elsewhere.
    // For v1 we read just the name; email shows up if/when ProfileCompletion
    // captures it (currently it doesn't). Future: pull from auth.users via
    // an RPC, since RLS on auth.users is restrictive.
    const rows: OrgMember[] = (data ?? []).map((row) => {
      const profile = Array.isArray(row.user_profiles) ? row.user_profiles[0] : row.user_profiles;
      return {
        org_id: row.org_id,
        user_id: row.user_id,
        role: row.role as 'admin' | 'member',
        joined_at: row.joined_at,
        name: (profile as { name: string } | null)?.name ?? '(unknown user)',
        email: null,
      };
    });
    return { ok: true, data: rows };
  } catch (e) {
    return fail('listOrgMembers', e);
  }
}

// -----------------------------------------------------------------------------
// Check whether the current user is an admin of the org.
// -----------------------------------------------------------------------------
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

// -----------------------------------------------------------------------------
// Create an invite. Admin-only — server-side RPC enforces.
// -----------------------------------------------------------------------------
export async function createOrgInvite(
  orgId: string,
  email: string,
  role: 'admin' | 'member',
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
    return { ok: true, data: { id: row.id, token: row.token, expires_at: row.expires_at } };
  } catch (e) {
    return fail('createOrgInvite', e);
  }
}

// -----------------------------------------------------------------------------
// Accept an invite token. Adds the current user to org_members + marks
// the invite used.
// -----------------------------------------------------------------------------
export async function acceptOrgInvite(
  token: string,
): Promise<Result<{ org_id: string; org_name: string; role: 'admin' | 'member' }>> {
  try {
    const { data, error } = await supabase.rpc('accept_org_invite', { p_token: token });
    if (error) throw error;
    const row = Array.isArray(data) ? data[0] : data;
    if (!row?.org_id) throw new Error('RPC returned no org_id');
    return {
      ok: true,
      data: { org_id: row.org_id, org_name: row.org_name, role: row.role as 'admin' | 'member' },
    };
  } catch (e) {
    return fail('acceptOrgInvite', e);
  }
}

// -----------------------------------------------------------------------------
// List pending invites for the org (admin-only).
// -----------------------------------------------------------------------------
export async function listOrgInvites(orgId: string): Promise<Result<OrgInvite[]>> {
  try {
    const { data, error } = await supabase.rpc('list_org_invites', { p_org_id: orgId });
    if (error) throw error;
    return { ok: true, data: (data ?? []) as OrgInvite[] };
  } catch (e) {
    return fail('listOrgInvites', e);
  }
}

// -----------------------------------------------------------------------------
// Update a member's role. RLS enforces admin-only.
// -----------------------------------------------------------------------------
export async function updateOrgMemberRole(
  orgId: string,
  userId: string,
  role: 'admin' | 'member',
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

// -----------------------------------------------------------------------------
// Remove a member. RLS enforces admin-only.
// -----------------------------------------------------------------------------
export async function removeOrgMember(orgId: string, userId: string): Promise<Result<void>> {
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

// -----------------------------------------------------------------------------
// Build a shareable invite URL from a token. Uses location.origin so it
// works in dev, staging, and prod automatically.
// -----------------------------------------------------------------------------
export function buildInviteUrl(token: string): string {
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const base = typeof window !== 'undefined' ? window.location.pathname : '/';
  // base may already include the /PIQC-dev-v1/ prefix from vite. Strip
  // anything after the trailing slash so the URL points at the app root.
  const rootPath = base.replace(/\/+$/, '').replace(/\/[^/]+$/, '/');
  return `${origin}${rootPath}?invite=${encodeURIComponent(token)}`;
}
