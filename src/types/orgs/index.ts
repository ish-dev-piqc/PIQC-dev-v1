// =============================================================================
// Orgs domain — TypeScript types.
//
// DB row types mirror the schema in:
//   - 20260618000000_protocol_members_table.sql
//   - 20260618000100_protocol_access_requests.sql
//   - 20260618000200_protocol_guests.sql
//
// Org / OrgMember types mirror the pre-existing schema in
// 20260520000000_orgs_schema_and_user_profiles_link.sql — included here
// because Ishika's PR #94 landed them in the DB but never added TS mirrors.
// =============================================================================


// ---------------------------------------------------------------------------
// Enums (string-literal unions match the Postgres CHECK constraint values)
// ---------------------------------------------------------------------------

export type OrgRole = 'admin' | 'member';

export type ProtocolMemberRole = 'coordinator' | 'member' | 'viewer';

export type ProtocolAccessRequestStatus = 'pending' | 'approved' | 'denied' | 'withdrawn';


// ---------------------------------------------------------------------------
// Orgs + OrgMembers (mirrors Ishika's existing schema)
// ---------------------------------------------------------------------------

export interface Org {
  id: string;
  name: string;
  slug: string;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

/** Subset shape used by the legacy fetchCurrentUserOrg surface — has no updated_at. */
export interface OrgRow {
  id: string;
  name: string;
  slug: string;
  created_at: string;
}

export interface OrgMember {
  org_id: string;
  user_id: string;
  role: OrgRole;
  joined_at: string;
}

/** OrgMember joined with user_profiles name + email for roster rendering. */
export interface OrgMemberWithProfile extends OrgMember {
  name: string;
  email: string | null;
}

/** Org joined with the caller's membership row for convenience. */
export interface OrgWithMembership extends Org {
  my_role: OrgRole;
}

/** A single protocol assignment to bundle with an invite. */
export interface ProtocolAssignment {
  protocol_id: string;
  role: ProtocolMemberRole;
}

/** Pending org-level invite row. */
export interface OrgInvite {
  id: string;
  email: string;
  role: OrgRole;
  token: string;
  expires_at: string;
  created_at: string;
  protocol_assignments?: ProtocolAssignment[];
}

/** Minimal protocol shape used by the org-level "pick protocols to invite into" picker. */
export interface OrgProtocolSummary {
  id: string;
  code: string;
  name: string;
  sponsor: string | null;
}


// ---------------------------------------------------------------------------
// Protocol members
// ---------------------------------------------------------------------------

export interface ProtocolMember {
  protocol_id: string;
  user_id: string;
  role: ProtocolMemberRole;
  added_at: string;
  added_by: string | null;
}

/** Used by addProtocolMember; created_at / added_by come from server defaults. */
export interface NewProtocolMemberInput {
  protocol_id: string;
  user_id: string;
  role: ProtocolMemberRole;
}

export type ProtocolMemberPatch = { role: ProtocolMemberRole };


// ---------------------------------------------------------------------------
// Org-wide chat messages
// ---------------------------------------------------------------------------

export interface OrgMessage {
  id: string;
  org_id: string;
  /** null when the author was deleted from auth.users (ON DELETE SET NULL). */
  author_user_id: string | null;
  body: string;
  created_at: string;
}

export interface NewOrgMessageInput {
  org_id: string;
  body: string;
}

// ---------------------------------------------------------------------------
// Per-protocol chat messages (PR 4b)
// ---------------------------------------------------------------------------

export interface ProtocolMessage {
  id: string;
  protocol_id: string;
  /** null when the author was deleted from auth.users (ON DELETE SET NULL). */
  author_user_id: string | null;
  body: string;
  created_at: string;
}

export interface NewProtocolMessageInput {
  protocol_id: string;
  body: string;
}

/** Minimal protocol shape returned by listMyChatProtocols for the chat
 *  sidebar — just enough to render the channel labels. */
export interface ChatProtocolSummary {
  id: string;
  code: string;
  name: string;
}

/** Materialized mention row, populated by AFTER-INSERT triggers on the
 *  message tables. Exactly one of the two FK columns is set; the matching
 *  channel reference (org_id or protocol_id) is denormalized in too. */
export interface ChatMention {
  id: string;
  org_message_id: string | null;
  protocol_message_id: string | null;
  org_id: string | null;
  protocol_id: string | null;
  mentioned_user_id: string;
  mentioned_by_user_id: string | null;
  created_at: string;
  read_at: string | null;
}

/** First-class decision captured from a chat message. Immutable post-creation
 *  (no UPDATE policy); admins can DELETE for moderation. */
export interface ChatDecision {
  id: string;
  title: string;
  rationale: string | null;
  org_id: string | null;
  protocol_id: string | null;
  source_org_message_id: string | null;
  source_protocol_message_id: string | null;
  decided_by_user_id: string | null;
  decided_at: string;
  created_by_user_id: string | null;
  created_at: string;
}

export interface NewChatDecisionInput {
  title: string;
  rationale?: string | null;
  org_id?: string;
  protocol_id?: string;
  source_org_message_id?: string;
  source_protocol_message_id?: string;
  decided_by_user_id?: string | null;
  decided_at?: string;
}


// ---------------------------------------------------------------------------
// Access requests
// ---------------------------------------------------------------------------

export interface ProtocolAccessRequest {
  id: string;
  protocol_id: string;
  user_id: string;
  status: ProtocolAccessRequestStatus;
  message: string | null;
  requested_at: string;
  resolved_at: string | null;
  resolved_by: string | null;
}

export interface NewProtocolAccessRequestInput {
  protocol_id: string;
  message?: string;
}


// ---------------------------------------------------------------------------
// Guests
// ---------------------------------------------------------------------------

export interface ProtocolGuest {
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

export interface NewProtocolGuestInput {
  protocol_id: string;
  invited_email: string;
  /** Optional override; defaults to 30 days from server time. */
  expires_at?: string;
  /** Set by entitlements check at the call site; defaults to false (within cap). */
  is_paid_seat?: boolean;
}

/** Result of acceptProtocolGuestInvite — includes the resolved protocol_id. */
export interface AcceptedGuestInvite {
  guest_id: string;
  protocol_id: string;
  accepted_at: string;
}
