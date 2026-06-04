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
  ChatAttachment,
  ChatDecision,
  ChatDecisionAck,
  ChatMention,
  ChatProtocolSummary,
  NewChatAttachmentInput,
  NewChatDecisionInput,
  NewProtocolGuestInput,
  NewProtocolMemberInput,
  Org,
  OrgInvite,
  OrgMemberWithProfile,
  OrgMessage,
  OrgProtocolSummary,
  OrgRole,
  OrgRow,
  OrgWithMembership,
  ProtocolAccessRequest,
  ProtocolAssignment,
  ProtocolGuest,
  ProtocolMember,
  ProtocolMemberPatch,
  ProtocolMessage,
} from '../../types/orgs';
import { adaptAccessRequest, adaptAccessRequests } from './accessRequestsAdapter';
import { adaptChatAttachment, adaptChatAttachments } from './chatAttachmentsAdapter';
import {
  adaptChatDecisionAck,
  adaptChatDecisionAcks,
} from './chatDecisionAcksAdapter';
import { adaptChatDecision, adaptChatDecisions } from './chatDecisionsAdapter';
import { adaptChatMentions } from './chatMentionsAdapter';
import { adaptGuest, adaptGuests } from './guestsAdapter';
import { adaptOrgMessage, adaptOrgMessages } from './orgMessagesAdapter';
import { adaptProtocolMember, adaptProtocolMembers } from './protocolMembersAdapter';
import {
  adaptProtocolMessage,
  adaptProtocolMessages,
} from './protocolMessagesAdapter';

export type Result<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };

function err<T>(message: string): Result<T> {
  return { ok: false, error: message };
}

function fail<T>(label: string, error: unknown): Result<T> {
  // PostgrestError (and most Supabase error shapes) are plain objects with a
  // .message field — they're not `instanceof Error`. The pre-existing impl
  // would `String(error)` them to "[object Object]", which is what users saw
  // rendered in the org settings banner. Unpack the message explicitly.
  let msg: string;
  if (error instanceof Error) {
    msg = error.message;
  } else if (
    typeof error === 'object' &&
    error !== null &&
    'message' in error &&
    typeof (error as { message: unknown }).message === 'string'
  ) {
    msg = (error as { message: string }).message;
  } else {
    msg = String(error);
  }
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

/** List every org the caller is a member of (multi-org support).
 *
 *  Important: filter `.eq('user_id', user.id)`. RLS on `org_members` permits
 *  the caller to read every member row of any org they belong to (needed for
 *  the in-org roster query), so an unfiltered SELECT returns one row per
 *  total member with the same org joined — producing apparent duplicate orgs
 *  in the OrgSwitcher dropdown. The filter restricts to the caller's own
 *  membership rows. */
export async function listMyOrgs(): Promise<Result<OrgWithMembership[]>> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return err('Not authenticated');

  const { data, error } = await supabase
    .from('org_members')
    .select('role, orgs(id, name, slug, created_by, created_at, updated_at)')
    .eq('user_id', user.id);

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
    // Can't use PostgREST's `user_profiles!inner(name)` embed: there's no
    // direct FK between org_members and user_profiles (both link to
    // auth.users.id but that's transitive, not a direct relationship).
    // Two queries + client-side join.
    const { data: members, error: membersErr } = await supabase
      .from('org_members')
      .select('org_id, user_id, role, joined_at')
      .eq('org_id', orgId);
    if (membersErr) throw membersErr;
    if (!members || members.length === 0) return { ok: true, data: [] };

    const userIds = (members as Array<{ user_id: string }>).map((m) => m.user_id);
    const { data: profiles, error: profilesErr } = await supabase
      .from('user_profiles')
      .select('id, name')
      .in('id', userIds);
    if (profilesErr) throw profilesErr;

    const nameByUserId = new Map<string, string>(
      ((profiles ?? []) as Array<{ id: string; name: string | null }>).map((p) => [
        p.id,
        p.name ?? '(unknown user)',
      ]),
    );

    // user_profiles doesn't expose email — auth.users.email lives elsewhere.
    // Future: pull from auth.users via a SECURITY DEFINER RPC if we need it.
    const rows: OrgMemberWithProfile[] = (members as Array<{
      org_id: string;
      user_id: string;
      role: string;
      joined_at: string;
    }>).map((m) => ({
      org_id: m.org_id,
      user_id: m.user_id,
      role: m.role as OrgRole,
      joined_at: m.joined_at,
      name: nameByUserId.get(m.user_id) ?? '(unknown user)',
      email: null,
    }));
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
  protocolAssignments: ProtocolAssignment[] = [],
): Promise<Result<{ id: string; token: string; expires_at: string; emailSent: boolean }>> {
  try {
    const { data, error } = await supabase.rpc('create_org_invite', {
      p_org_id: orgId,
      p_email: email,
      p_role: role,
      p_protocol_assignments: protocolAssignments,
    });
    if (error) throw error;
    const row = Array.isArray(data) ? data[0] : data;
    if (!row?.token) throw new Error('RPC returned no token');

    // Best-effort: invoke the Edge Function to email the invite link via
    // Resend. If it fails, the invite row still exists and the admin can
    // copy the link manually from the pending-invites list. We surface the
    // success/failure in the return so the UI can show "✓ Email sent" vs
    // a "copy the link" warning.
    const inviteUrl = buildInviteUrl(row.token);
    let emailSent = false;
    try {
      const { data: fnData, error: fnError } = await supabase.functions.invoke(
        'send-org-invite-email',
        { body: { inviteId: row.id, inviteUrl } },
      );
      if (!fnError && fnData && typeof fnData === 'object' && 'ok' in fnData && fnData.ok === true) {
        emailSent = true;
      } else if (fnError) {
        console.warn('[orgsApi] send-org-invite-email failed:', fnError.message);
      }
    } catch (e) {
      console.warn('[orgsApi] send-org-invite-email threw:', e);
    }

    return {
      ok: true,
      data: { id: row.id, token: row.token, expires_at: row.expires_at, emailSent },
    };
  } catch (e) {
    return fail('createOrgInvite', e);
  }
}

export async function acceptOrgInvite(
  token: string,
): Promise<Result<{ org_id: string; org_name: string; role: OrgRole; protocol_count: number }>> {
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
        protocol_count: row.protocol_count ?? 0,
      },
    };
  } catch (e) {
    return fail('acceptOrgInvite', e);
  }
}

/** List the protocols owned by an org. Used by the invite form to let admins
 *  pick which protocols to add a new user to at invite time.
 *
 *  Note: the DB columns are `study_number` and `title`; the `Protocol.code` /
 *  `Protocol.name` TS fields are frontend aliases set elsewhere when protocols
 *  load. We alias them here so the OrgProtocolSummary shape matches what
 *  components expect without each caller having to remap. */
export async function listProtocolsByOrg(
  orgId: string,
): Promise<Result<OrgProtocolSummary[]>> {
  const { data, error } = await supabase
    .from('protocols')
    .select('id, code:study_number, name:title, sponsor')
    .eq('owner_org_id', orgId)
    .order('study_number', { ascending: true });

  if (error) return err(error.message);
  return {
    ok: true,
    data: (data ?? []) as unknown as OrgProtocolSummary[],
  };
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

/** Revoke a pending org invite. RLS (`org_invites_admin_all`) requires the
 *  caller to be an admin of the inviting org. Hard delete — invite tokens
 *  are operational state, not audit-bearing. */
export async function revokeOrgInvite(inviteId: string): Promise<Result<void>> {
  const { error } = await supabase.from('org_invites').delete().eq('id', inviteId);
  if (error) return err(error.message);
  return { ok: true, data: undefined };
}

/** Build a shareable invite URL from a token.
 *
 *  Uses Vite's configured `BASE_URL` so the link always points at the app
 *  root regardless of which route the admin happened to be on when they
 *  clicked the button. Previous impl derived the path from
 *  `window.location.pathname` and over-stripped when the admin was already
 *  at the root (`/PIQC-dev-v1/` → `/` → 404 on github.io). */
export function buildInviteUrl(token: string): string {
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  // import.meta.env.BASE_URL is set from vite.config.ts (`/PIQC-dev-v1/` on
  // this project; `/` for unconfigured apps). Always has a trailing slash
  // per Vite's contract.
  const base = import.meta.env.BASE_URL ?? '/';
  return `${origin}${base}?invite=${encodeURIComponent(token)}`;
}


// ===========================================================================
// Org messages — org-wide general chat. Realtime subscription lives in
// src/context/OrgChatContext.tsx (per the "realtime in context" rule).
// ===========================================================================

/** Most-recent N messages for the org, returned oldest-first for display.
 *  Default limit 100 — for v1 we render the whole window without pagination. */
export async function listOrgMessages(
  orgId: string,
  limit = 100,
): Promise<Result<OrgMessage[]>> {
  const { data, error } = await supabase
    .from('org_messages')
    .select('id, org_id, author_user_id, body, created_at')
    .eq('org_id', orgId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) return fail('listOrgMessages', error);
  // Index is DESC for the query; reverse for chronological-display order.
  const rows = (data ?? []).slice().reverse();
  return { ok: true, data: adaptOrgMessages(rows) };
}

export async function postOrgMessage(
  orgId: string,
  body: string,
): Promise<Result<OrgMessage>> {
  const trimmed = body.trim();
  if (!trimmed) return err('Message cannot be empty.');
  if (trimmed.length > 10000) return err('Message is too long (10000 character max).');

  const { data: userData, error: userErr } = await supabase.auth.getUser();
  if (userErr) return fail('postOrgMessage:getUser', userErr);
  const user = userData?.user;
  if (!user) return err('Not authenticated.');

  const { data, error } = await supabase
    .from('org_messages')
    .insert({
      org_id: orgId,
      author_user_id: user.id,
      body: trimmed,
    })
    .select('id, org_id, author_user_id, body, created_at')
    .single();
  if (error) return fail('postOrgMessage', error);
  if (!data) return err('Insert returned no row.');
  return { ok: true, data: adaptOrgMessage(data) };
}


// ===========================================================================
// Chat mentions — populated by triggers on the message tables. Clients can
// only SELECT their own mentions and UPDATE read_at. Used by the chat
// sidebar to badge channels where the current user was @-mentioned in
// unread messages.
// ===========================================================================

export async function listMyUnreadMentions(): Promise<Result<ChatMention[]>> {
  const { data, error } = await supabase
    .from('chat_mentions')
    .select(
      'id, org_message_id, protocol_message_id, org_id, protocol_id, mentioned_user_id, mentioned_by_user_id, created_at, read_at',
    )
    .is('read_at', null);
  if (error) return fail('listMyUnreadMentions', error);
  return { ok: true, data: adaptChatMentions(data ?? []) };
}

export async function markChatMentionsRead(
  kind: 'org' | 'protocol',
  channelId: string,
): Promise<Result<void>> {
  const { error } = await supabase.rpc('mark_chat_mentions_read', {
    p_kind: kind,
    p_channel_id: channelId,
  });
  if (error) return fail('markChatMentionsRead', error);
  return { ok: true, data: undefined };
}


// ===========================================================================
// Chat decisions — first-class promoted decisions linked to a source
// message. Immutable in v1 (no UPDATE); admins can DELETE for moderation.
// ===========================================================================

const CHAT_DECISION_COLUMNS =
  'id, title, rationale, org_id, protocol_id, source_org_message_id, source_protocol_message_id, decided_by_user_id, decided_at, created_by_user_id, created_at';

export async function createChatDecision(
  input: NewChatDecisionInput,
): Promise<Result<ChatDecision>> {
  try {
    const { data: userData, error: userErr } = await supabase.auth.getUser();
    if (userErr) throw userErr;
    const user = userData?.user;
    if (!user) return err('Not authenticated.');

    const title = input.title.trim();
    if (!title) return err('Title is required.');
    if (title.length > 200) return err('Title is too long (200 character max).');
    const rationale = input.rationale?.trim() ?? null;
    if (rationale && rationale.length > 4000) {
      return err('Rationale is too long (4000 character max).');
    }

    const insertPayload = {
      title,
      rationale: rationale || null,
      org_id: input.org_id ?? null,
      protocol_id: input.protocol_id ?? null,
      source_org_message_id: input.source_org_message_id ?? null,
      source_protocol_message_id: input.source_protocol_message_id ?? null,
      decided_by_user_id: input.decided_by_user_id ?? user.id,
      decided_at: input.decided_at ?? new Date().toISOString(),
      created_by_user_id: user.id,
    };

    const { data, error } = await supabase
      .from('chat_decisions')
      .insert(insertPayload)
      .select(CHAT_DECISION_COLUMNS)
      .single();
    if (error) return fail('createChatDecision', error);
    if (!data) return err('Insert returned no row.');
    const decision = adaptChatDecision(data);

    // Optional ack requirements — insert after the decision so the FK is
    // satisfied. Failures are non-fatal: the decision still exists; the
    // caller surfaces a warning. RLS on chat_decision_acks ensures only
    // the just-created decision's author (= current user) can insert here.
    const requiredUserIds = input.required_user_ids ?? [];
    if (requiredUserIds.length > 0) {
      const ackRows = requiredUserIds.map((uid) => ({
        decision_id: decision.id,
        required_user_id: uid,
      }));
      const { error: ackErr } = await supabase
        .from('chat_decision_acks')
        .insert(ackRows);
      if (ackErr) {
        console.warn('[createChatDecision] ack insert failed:', ackErr.message);
      }
    }

    return { ok: true, data: decision };
  } catch (e) {
    return fail('createChatDecision', e);
  }
}

/** Fetch ack rows for a set of decisions. Returns flat list — caller groups
 *  by `decision_id`. */
export async function listDecisionAcks(
  decisionIds: string[],
): Promise<Result<ChatDecisionAck[]>> {
  if (decisionIds.length === 0) return { ok: true, data: [] };
  const { data, error } = await supabase
    .from('chat_decision_acks')
    .select(
      'id, decision_id, required_user_id, acknowledged_at, acknowledged_note, created_at',
    )
    .in('decision_id', decisionIds);
  if (error) return fail('listDecisionAcks', error);
  return { ok: true, data: adaptChatDecisionAcks(data ?? []) };
}

/** Mark a single ack row as acknowledged. RLS gates: only the
 *  `required_user_id` matching auth.uid() succeeds. */
export async function acknowledgeDecision(
  ackId: string,
  note?: string,
): Promise<Result<ChatDecisionAck>> {
  const trimmedNote = note?.trim() ?? null;
  if (trimmedNote && trimmedNote.length > 2000) {
    return err('Note is too long (2000 character max).');
  }
  const { data, error } = await supabase
    .from('chat_decision_acks')
    .update({
      acknowledged_at: new Date().toISOString(),
      acknowledged_note: trimmedNote,
    })
    .eq('id', ackId)
    .select(
      'id, decision_id, required_user_id, acknowledged_at, acknowledged_note, created_at',
    )
    .single();
  if (error) return fail('acknowledgeDecision', error);
  if (!data) return err('Update returned no row.');
  return { ok: true, data: adaptChatDecisionAck(data) };
}

export async function listChannelDecisions(
  kind: 'org' | 'protocol',
  channelId: string,
): Promise<Result<ChatDecision[]>> {
  const column = kind === 'org' ? 'org_id' : 'protocol_id';
  const { data, error } = await supabase
    .from('chat_decisions')
    .select(CHAT_DECISION_COLUMNS)
    .eq(column, channelId)
    .order('decided_at', { ascending: false });
  if (error) return fail('listChannelDecisions', error);
  return { ok: true, data: adaptChatDecisions(data ?? []) };
}

export async function deleteChatDecision(id: string): Promise<Result<void>> {
  const { error } = await supabase.from('chat_decisions').delete().eq('id', id);
  if (error) return fail('deleteChatDecision', error);
  return { ok: true, data: undefined };
}


// ===========================================================================
// Chat attachments — files uploaded to the `chat-attachments` Supabase
// Storage bucket and tied to a chat message via the chat_attachments table.
// Two-step flow: upload to Storage → insert chat_attachments row.
// ===========================================================================

const CHAT_ATTACHMENT_COLUMNS =
  'id, org_message_id, protocol_message_id, org_id, protocol_id, storage_path, mime_type, size_bytes, original_filename, uploaded_by_user_id, created_at';

const CHAT_ATTACHMENTS_BUCKET = 'chat-attachments';
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

export async function uploadChatAttachment(
  input: NewChatAttachmentInput,
): Promise<Result<ChatAttachment>> {
  try {
    const file = input.file;
    if (file.size <= 0) return err('File is empty.');
    if (file.size > MAX_ATTACHMENT_BYTES) {
      return err(`File too large (${(file.size / 1024 / 1024).toFixed(1)} MB > 10 MB max).`);
    }

    const { data: userData, error: userErr } = await supabase.auth.getUser();
    if (userErr) throw userErr;
    const user = userData?.user;
    if (!user) return err('Not authenticated.');

    // Safe filename: strip path separators, cap length. The UUID prefix
    // disambiguates and prevents accidental overwrites.
    const safeName = file.name
      .replace(/[\\/:*?"<>|]/g, '_')
      .slice(0, 120);
    const objectName = `${user.id}/${crypto.randomUUID()}-${safeName}`;

    const { error: uploadErr } = await supabase.storage
      .from(CHAT_ATTACHMENTS_BUCKET)
      .upload(objectName, file, {
        contentType: file.type || 'application/octet-stream',
        upsert: false,
      });
    if (uploadErr) return fail('uploadChatAttachment:storage', uploadErr);

    const insertPayload = {
      org_message_id: input.org_message_id ?? null,
      protocol_message_id: input.protocol_message_id ?? null,
      org_id: input.org_id ?? null,
      protocol_id: input.protocol_id ?? null,
      storage_path: objectName,
      mime_type: file.type || 'application/octet-stream',
      size_bytes: file.size,
      original_filename: file.name,
      uploaded_by_user_id: user.id,
    };

    const { data, error } = await supabase
      .from('chat_attachments')
      .insert(insertPayload)
      .select(CHAT_ATTACHMENT_COLUMNS)
      .single();
    if (error) {
      // Best-effort cleanup of the orphan Storage object so we don't leave
      // junk files behind when the DB write fails (e.g. RLS denies).
      await supabase.storage.from(CHAT_ATTACHMENTS_BUCKET).remove([objectName]);
      return fail('uploadChatAttachment:db', error);
    }
    if (!data) return err('Insert returned no row.');
    return { ok: true, data: adaptChatAttachment(data) };
  } catch (e) {
    return fail('uploadChatAttachment', e);
  }
}

export async function listChannelAttachments(
  kind: 'org' | 'protocol',
  channelId: string,
): Promise<Result<ChatAttachment[]>> {
  const column = kind === 'org' ? 'org_id' : 'protocol_id';
  const { data, error } = await supabase
    .from('chat_attachments')
    .select(CHAT_ATTACHMENT_COLUMNS)
    .eq(column, channelId)
    .order('created_at', { ascending: true });
  if (error) return fail('listChannelAttachments', error);
  return { ok: true, data: adaptChatAttachments(data ?? []) };
}

export async function deleteChatAttachment(attachment: ChatAttachment): Promise<Result<void>> {
  // Storage delete first; if it fails, we still try the row delete to avoid
  // stranding a row that points at a nonexistent object (or vice versa).
  const { error: storageErr } = await supabase.storage
    .from(CHAT_ATTACHMENTS_BUCKET)
    .remove([attachment.storage_path]);
  if (storageErr) {
    console.warn('[deleteChatAttachment] storage remove failed', storageErr.message);
  }
  const { error } = await supabase
    .from('chat_attachments')
    .delete()
    .eq('id', attachment.id);
  if (error) return fail('deleteChatAttachment', error);
  return { ok: true, data: undefined };
}

/** Returns a short-lived signed URL the client can use to download or
 *  preview the attachment. RLS on storage.objects gates url generation. */
export async function getAttachmentSignedUrl(
  storagePath: string,
  expiresInSeconds = 60,
): Promise<Result<string>> {
  const { data, error } = await supabase.storage
    .from(CHAT_ATTACHMENTS_BUCKET)
    .createSignedUrl(storagePath, expiresInSeconds);
  if (error) return fail('getAttachmentSignedUrl', error);
  if (!data?.signedUrl) return err('No signed URL returned.');
  return { ok: true, data: data.signedUrl };
}


// ===========================================================================
// Per-protocol chat messages + channel discovery for the chat sidebar.
// Realtime subscription lives in src/context/ProtocolChatContext.tsx.
// ===========================================================================

/** Most-recent N messages for a protocol channel, oldest-first for display. */
export async function listProtocolMessages(
  protocolId: string,
  limit = 100,
): Promise<Result<ProtocolMessage[]>> {
  const { data, error } = await supabase
    .from('protocol_messages')
    .select('id, protocol_id, author_user_id, body, created_at')
    .eq('protocol_id', protocolId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) return fail('listProtocolMessages', error);
  const rows = (data ?? []).slice().reverse();
  return { ok: true, data: adaptProtocolMessages(rows) };
}

export async function postProtocolMessage(
  protocolId: string,
  body: string,
): Promise<Result<ProtocolMessage>> {
  const trimmed = body.trim();
  if (!trimmed) return err('Message cannot be empty.');
  if (trimmed.length > 10000) return err('Message is too long (10000 character max).');

  const { data: userData, error: userErr } = await supabase.auth.getUser();
  if (userErr) return fail('postProtocolMessage:getUser', userErr);
  const user = userData?.user;
  if (!user) return err('Not authenticated.');

  const { data, error } = await supabase
    .from('protocol_messages')
    .insert({
      protocol_id: protocolId,
      author_user_id: user.id,
      body: trimmed,
    })
    .select('id, protocol_id, author_user_id, body, created_at')
    .single();
  if (error) return fail('postProtocolMessage', error);
  if (!data) return err('Insert returned no row.');
  return { ok: true, data: adaptProtocolMessage(data) };
}

/** Protocols the caller can chat in: org admins get every org protocol;
 *  non-admins get protocols where they're coordinator or member (viewers
 *  excluded — they're consumers, not collaborators). Used to populate the
 *  chat sidebar. */
export async function listMyChatProtocols(
  orgId: string,
): Promise<Result<ChatProtocolSummary[]>> {
  try {
    const { data: userData, error: userErr } = await supabase.auth.getUser();
    if (userErr) throw userErr;
    const user = userData?.user;
    if (!user) return err('Not authenticated.');

    // Are we an admin of this org?
    const { data: membership, error: membershipErr } = await supabase
      .from('org_members')
      .select('role')
      .eq('org_id', orgId)
      .eq('user_id', user.id)
      .maybeSingle();
    if (membershipErr) throw membershipErr;
    const isAdmin = membership?.role === 'admin';

    if (isAdmin) {
      // Admin: every protocol in the org.
      const { data, error } = await supabase
        .from('protocols')
        .select('id, code:study_number, name:title')
        .eq('owner_org_id', orgId)
        .order('study_number', { ascending: true });
      if (error) throw error;
      return {
        ok: true,
        data: ((data ?? []) as Array<{ id: string; code: string | null; name: string | null }>)
          .map((p) => ({
            id: p.id,
            code: p.code ?? '(unnamed)',
            name: p.name ?? '',
          })),
      };
    }

    // Non-admin: protocols where we have coordinator or member role.
    const { data: memberRows, error: memberErr } = await supabase
      .from('protocol_members')
      .select('protocol_id')
      .eq('user_id', user.id)
      .in('role', ['coordinator', 'member']);
    if (memberErr) throw memberErr;
    const protocolIds = ((memberRows ?? []) as Array<{ protocol_id: string }>).map(
      (r) => r.protocol_id,
    );
    if (protocolIds.length === 0) return { ok: true, data: [] };

    // Join with protocols, scoped to the org so we don't include any
    // out-of-org protocols (defensive — protocol_members shouldn't have
    // such rows but RLS could be relaxed in the future).
    const { data: protoRows, error: protoErr } = await supabase
      .from('protocols')
      .select('id, code:study_number, name:title')
      .in('id', protocolIds)
      .eq('owner_org_id', orgId)
      .order('study_number', { ascending: true });
    if (protoErr) throw protoErr;
    return {
      ok: true,
      data: ((protoRows ?? []) as Array<{ id: string; code: string | null; name: string | null }>)
        .map((p) => ({
          id: p.id,
          code: p.code ?? '(unnamed)',
          name: p.name ?? '',
        })),
    };
  } catch (e) {
    return fail('listMyChatProtocols', e);
  }
}


// ===========================================================================
// Protocol members
// ===========================================================================

/** Return the set of protocol_ids the current user is an explicit member of.
 *  Used by the Navbar protocol picker to split "Your protocols" vs
 *  "Available in your org". Site admins access protocols via clause (d) of
 *  user_can_access_protocol without a protocol_members row; the picker
 *  handles that case separately by checking org admin status. */
export async function listMyProtocolMemberships(): Promise<Result<string[]>> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return err('Not authenticated');

  const { data, error } = await supabase
    .from('protocol_members')
    .select('protocol_id')
    .eq('user_id', user.id);

  if (error) return err(error.message);
  return {
    ok: true,
    data: ((data ?? []) as Array<{ protocol_id: string }>).map((r) => r.protocol_id),
  };
}

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

/** Build a shareable guest-invite URL from a token. Centralised here so the
 *  API layer (which emails the link) and InviteGuestModal (which copies it)
 *  produce identical URLs that the `?guestInvite=` redemption flow expects. */
export function buildGuestInviteUrl(token: string): string {
  if (typeof window === 'undefined') return `?guestInvite=${token}`;
  return `${window.location.origin}${window.location.pathname}?guestInvite=${token}`;
}

export async function inviteGuest(
  input: NewProtocolGuestInput,
): Promise<Result<ProtocolGuest & { emailSent: boolean }>> {
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
  const guest = adaptGuest(data as unknown as Parameters<typeof adaptGuest>[0]);

  // Best-effort: invoke the Edge Function to email the invite link via Resend.
  // If it fails, the guest row still exists and the coordinator can copy the
  // link manually from the modal. The flag lets the UI confirm "✓ emailed" vs
  // a "copy the link" warning. Mirrors createOrgInvite's send path.
  const inviteUrl = buildGuestInviteUrl(guest.invite_token);
  let emailSent = false;
  try {
    const { data: fnData, error: fnError } = await supabase.functions.invoke(
      'send-guest-invite-email',
      { body: { guestId: guest.id, inviteUrl } },
    );
    if (!fnError && fnData && typeof fnData === 'object' && 'ok' in fnData && fnData.ok === true) {
      emailSent = true;
    } else if (fnError) {
      console.warn('[orgsApi] send-guest-invite-email failed:', fnError.message);
    }
  } catch (e) {
    console.warn('[orgsApi] send-guest-invite-email threw:', e);
  }

  return { ok: true, data: { ...guest, emailSent } };
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
