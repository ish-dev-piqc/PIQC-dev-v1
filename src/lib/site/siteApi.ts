// =============================================================================
// Site Mode — Supabase data layer.
//
// Each function returns { ok: true, data } | { ok: false, error } following
// the auditApi convention. Callers consume via SiteDataContext (which fans
// these out on activeProtocol change and listens for realtime postgres
// changes) or directly when they only need a one-off operation.
// =============================================================================

import { supabase } from '../supabase';
import type {
  SiteParticipant,
  SiteVisit,
  SiteTeamMember,
  ProtocolDocument,
  ProtocolVisitTemplate,
  MaterializeResult,
  VisitCrossReference,
} from './types';

export type Result<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };

function fail<T>(label: string, error: unknown): Result<T> {
  const msg = error instanceof Error ? error.message : String(error);
  console.error(`[siteApi] ${label}:`, error);
  return { ok: false, error: msg };
}

// -----------------------------------------------------------------------------
// Participants
// -----------------------------------------------------------------------------

interface ParticipantRow {
  id: string;
  participant_code: string;
  protocol_id: string;
  status: SiteParticipant['status'];
  enrolled_at: string | null;
  current_study_day: number | null;
  next_visit_date: string | null;
  next_visit_name: string | null;
  assigned_coordinator: string | null;
  open_deviations: number;
  notes: string | null;
}

function rowToParticipant(row: ParticipantRow): SiteParticipant {
  return {
    id: row.participant_code,
    uuid: row.id,
    protocol_id: row.protocol_id,
    status: row.status,
    enrolled_at: row.enrolled_at,
    current_study_day: row.current_study_day,
    next_visit_date: row.next_visit_date,
    next_visit_name: row.next_visit_name,
    assigned_coordinator: row.assigned_coordinator ?? '',
    open_deviations: row.open_deviations,
    notes: row.notes,
  };
}

export async function fetchParticipants(
  protocolId: string,
): Promise<Result<SiteParticipant[]>> {
  try {
    const { data, error } = await supabase
      .from('site_participants')
      .select('id, participant_code, protocol_id, status, enrolled_at, current_study_day, next_visit_date, next_visit_name, assigned_coordinator, open_deviations, notes')
      .eq('protocol_id', protocolId)
      .order('participant_code', { ascending: true });
    if (error) throw error;
    return { ok: true, data: (data ?? []).map(rowToParticipant) };
  } catch (e) {
    return fail('fetchParticipants', e);
  }
}

export interface NewParticipantInput {
  participant_code: string;
  protocol_id: string;
  status: SiteParticipant['status'];
  enrolled_at?: string | null;
  current_study_day?: number | null;
  next_visit_date?: string | null;
  next_visit_name?: string | null;
  assigned_coordinator?: string | null;
  open_deviations?: number;
  notes?: string | null;
}

export type ParticipantPatch = Partial<Omit<NewParticipantInput, 'protocol_id'>>;

export async function createParticipant(
  input: NewParticipantInput,
): Promise<Result<SiteParticipant>> {
  try {
    const { data, error } = await supabase
      .from('site_participants')
      .insert({
        participant_code: input.participant_code,
        protocol_id: input.protocol_id,
        status: input.status,
        enrolled_at: input.enrolled_at ?? null,
        current_study_day: input.current_study_day ?? null,
        next_visit_date: input.next_visit_date ?? null,
        next_visit_name: input.next_visit_name ?? null,
        assigned_coordinator: input.assigned_coordinator ?? null,
        open_deviations: input.open_deviations ?? 0,
        notes: input.notes ?? null,
      })
      .select('id, participant_code, protocol_id, status, enrolled_at, current_study_day, next_visit_date, next_visit_name, assigned_coordinator, open_deviations, notes')
      .single();
    if (error) {
      // Postgres unique violation → friendlier message.
      if (error.code === '23505') {
        return {
          ok: false,
          error: `Participant code "${input.participant_code}" already exists on this protocol.`,
        };
      }
      throw error;
    }
    return { ok: true, data: rowToParticipant(data as ParticipantRow) };
  } catch (e) {
    return fail('createParticipant', e);
  }
}

export async function updateParticipant(
  uuid: string,
  patch: ParticipantPatch,
): Promise<Result<SiteParticipant>> {
  try {
    const { data, error } = await supabase
      .from('site_participants')
      .update(patch)
      .eq('id', uuid)
      .select('id, participant_code, protocol_id, status, enrolled_at, current_study_day, next_visit_date, next_visit_name, assigned_coordinator, open_deviations, notes')
      .single();
    if (error) {
      if (error.code === '23505') {
        return { ok: false, error: `Participant code already exists on this protocol.` };
      }
      throw error;
    }
    return { ok: true, data: rowToParticipant(data as ParticipantRow) };
  } catch (e) {
    return fail('updateParticipant', e);
  }
}

export async function deleteParticipant(uuid: string): Promise<Result<void>> {
  try {
    const { error } = await supabase
      .from('site_participants')
      .delete()
      .eq('id', uuid);
    if (error) throw error;
    return { ok: true, data: undefined };
  } catch (e) {
    return fail('deleteParticipant', e);
  }
}

// -----------------------------------------------------------------------------
// Visits
// -----------------------------------------------------------------------------

interface VisitRow {
  id: string;
  participant_id: string;
  protocol_id: string;
  date: string;
  time_of_day: string | null;
  study_day: number;
  visit_name: string;
  window_closes: string | null;
  status: SiteVisit['status'];
  procedures: string[] | null;
  prior_note: string | null;
  deviation_reason: string | null;
  template_id: string | null;
  site_participants: { participant_code: string } | { participant_code: string }[] | null;
  protocol_visit_templates:
    | { cross_references: VisitCrossReference[] | null }
    | { cross_references: VisitCrossReference[] | null }[]
    | null;
}

function rowToVisit(row: VisitRow): SiteVisit {
  // PostgREST returns the joined row as an object for !inner joins and
  // sometimes as an array for left joins — normalise both shapes.
  const joined = Array.isArray(row.site_participants)
    ? row.site_participants[0]
    : row.site_participants;
  const code = joined?.participant_code ?? '';

  const templateJoin = Array.isArray(row.protocol_visit_templates)
    ? row.protocol_visit_templates[0]
    : row.protocol_visit_templates;
  const crossRefs = templateJoin?.cross_references ?? null;

  return {
    id: row.id,
    date: row.date,
    time: row.time_of_day ?? undefined,
    protocolId: row.protocol_id,
    participantId: code,
    studyDay: row.study_day,
    visitName: row.visit_name,
    windowCloses: row.window_closes ?? undefined,
    status: row.status,
    procedures: row.procedures ?? undefined,
    priorNote: row.prior_note ?? undefined,
    deviationReason: row.deviation_reason ?? undefined,
    crossReferences: crossRefs && crossRefs.length > 0 ? crossRefs : undefined,
  };
}

export async function fetchVisitsForProtocol(
  protocolId: string,
): Promise<Result<SiteVisit[]>> {
  try {
    const { data, error } = await supabase
      .from('site_visits')
      .select(
        'id, participant_id, protocol_id, date, time_of_day, study_day, visit_name, window_closes, status, procedures, prior_note, deviation_reason, template_id, site_participants!inner(participant_code), protocol_visit_templates(cross_references)',
      )
      .eq('protocol_id', protocolId)
      .order('date', { ascending: true });
    if (error) throw error;
    return { ok: true, data: (data as unknown as VisitRow[]).map(rowToVisit) };
  } catch (e) {
    return fail('fetchVisitsForProtocol', e);
  }
}

/**
 * Patch a single field on a site_visit. Used by the Start-visit completion
 * flow; returns the updated row so the caller can swap it in optimistically
 * before the realtime subscription catches up.
 *
 * Note: the materialize_protocol_visits RPC wipes template-derived visits on
 * re-projection (e.g. when a participant's enrolled_at changes), which means
 * a "completed" status set here can be lost if the protocol is later
 * re-materialized. Tracked as a follow-up.
 */
export async function updateVisit(
  visitId: string,
  patch: Partial<{
    status: SiteVisit['status'];
    deviation_reason: string | null;
    prior_note: string | null;
  }>,
): Promise<Result<SiteVisit>> {
  try {
    const { data, error } = await supabase
      .from('site_visits')
      .update(patch)
      .eq('id', visitId)
      .select(
        'id, participant_id, protocol_id, date, time_of_day, study_day, visit_name, window_closes, status, procedures, prior_note, deviation_reason, template_id, site_participants!inner(participant_code), protocol_visit_templates(cross_references)',
      )
      .single();
    if (error) throw error;
    return { ok: true, data: rowToVisit(data as unknown as VisitRow) };
  } catch (e) {
    return fail('updateVisit', e);
  }
}

// -----------------------------------------------------------------------------
// Team
// -----------------------------------------------------------------------------

interface TeamRow {
  id: string;
  protocol_id: string;
  name: string;
  role: SiteTeamMember['role'];
  email: string | null;
  delegated_tasks: string[] | null;
  certified_through: string | null;
  added_at: string;
  status: SiteTeamMember['status'];
  notes: string | null;
}

function rowToTeam(row: TeamRow): SiteTeamMember {
  return {
    id: row.id,
    protocol_id: row.protocol_id,
    name: row.name,
    role: row.role,
    email: row.email ?? '',
    delegated_tasks: row.delegated_tasks ?? [],
    certified_through: row.certified_through ?? '',
    added_at: row.added_at,
    status: row.status,
    notes: row.notes,
  };
}

export async function fetchTeamMembers(
  protocolId: string,
): Promise<Result<SiteTeamMember[]>> {
  try {
    const { data, error } = await supabase
      .from('site_team_members')
      .select('id, protocol_id, name, role, email, delegated_tasks, certified_through, added_at, status, notes')
      .eq('protocol_id', protocolId)
      .order('added_at', { ascending: true });
    if (error) throw error;
    return { ok: true, data: (data ?? []).map(rowToTeam) };
  } catch (e) {
    return fail('fetchTeamMembers', e);
  }
}

// -----------------------------------------------------------------------------
// Documents — for Protocol tab and Ask tab scoping.
// -----------------------------------------------------------------------------

export async function fetchProtocolDocuments(
  protocolId: string,
): Promise<Result<ProtocolDocument[]>> {
  try {
    const { data, error } = await supabase
      .from('documents')
      .select('id, title, source, created_at, status, extracted_fields')
      .eq('protocol_id', protocolId)
      .eq('status', 'ready')
      .order('created_at', { ascending: false });
    if (error) throw error;
    return { ok: true, data: (data ?? []) as ProtocolDocument[] };
  } catch (e) {
    return fail('fetchProtocolDocuments', e);
  }
}

// -----------------------------------------------------------------------------
// Visit templates + anchor date + materialize (Phase A).
// -----------------------------------------------------------------------------

export async function fetchVisitTemplates(
  protocolId: string,
): Promise<Result<ProtocolVisitTemplate[]>> {
  try {
    const { data, error } = await supabase
      .from('protocol_visit_templates')
      .select('id, protocol_id, visit_name, study_day, window_minus_days, window_plus_days, procedures, source_document_id, cross_references')
      .eq('protocol_id', protocolId)
      .order('study_day', { ascending: true });
    if (error) throw error;
    return { ok: true, data: (data ?? []) as ProtocolVisitTemplate[] };
  } catch (e) {
    return fail('fetchVisitTemplates', e);
  }
}

export async function setAnchorDate(
  protocolId: string,
  anchorDate: string | null,
): Promise<Result<void>> {
  try {
    const { error } = await supabase
      .from('protocols')
      .update({ demo_anchor_date: anchorDate })
      .eq('id', protocolId);
    if (error) throw error;
    return { ok: true, data: undefined };
  } catch (e) {
    return fail('setAnchorDate', e);
  }
}

export async function materializeVisits(
  protocolId: string,
): Promise<Result<MaterializeResult>> {
  try {
    const { data, error } = await supabase.rpc('materialize_protocol_visits', {
      p_protocol_id: protocolId,
    });
    if (error) throw error;
    return { ok: true, data: data as MaterializeResult };
  } catch (e) {
    return fail('materializeVisits', e);
  }
}
