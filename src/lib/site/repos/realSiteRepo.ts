// =============================================================================
// realSiteRepo — production Supabase implementation of SiteRepo. Lifted as-is
// from the previous siteApi.ts body so behaviour is identical in real mode.
// =============================================================================

import { supabase } from '../../supabase';
import type {
  ProtocolDocument,
  ProtocolVisitTemplate,
  MaterializeResult,
  SiteParticipant,
  SiteTeamMember,
  SiteVisit,
  SiteVisitConfidence,
  VisitCrossReference,
} from '../types';
import type { Protocol } from '../../../context/ProtocolContext';
import type {
  NewParticipantInput,
  NewTeamMemberInput,
  NewVisitInput,
  ParticipantPatch,
  Result,
  SiteRepo,
  TeamMemberPatch,
  VisitPatch,
} from './types';

function fail<T>(label: string, error: unknown): Result<T> {
  const msg = error instanceof Error ? error.message : String(error);
  console.error(`[siteApi:real] ${label}:`, error);
  return { ok: false, error: msg };
}

const PAGE_SIZE = 1000;

// PostgREST silently caps a single response at its default max-rows (1000, no
// override configured in supabase/), so an unpaged .select() truncates with no
// error. Page with .range() until a short page proves we have everything.
async function fetchAllRows<T>(
  page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await page(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    const batch = data ?? [];
    rows.push(...batch);
    if (batch.length < PAGE_SIZE) return rows;
  }
}

// -----------------------------------------------------------------------------
// Protocols
// -----------------------------------------------------------------------------

interface ProtocolRow {
  id: string;
  study_number: string | null;
  title: string;
  sponsor: string;
  demo_anchor_date: string | null;
  timezone: string | null;
  protocol_versions: { clinical_trial_phase: string; status: string }[];
}

const PHASE_LABELS: Record<string, string> = {
  PHASE_1: 'Phase 1',
  PHASE_1_2: 'Phase 1/2',
  PHASE_2: 'Phase 2',
  PHASE_2_3: 'Phase 2/3',
  PHASE_3: 'Phase 3',
  PHASE_4: 'Phase 4',
  NOT_APPLICABLE: 'N/A',
};

function phaseLabel(raw: string | null | undefined): string {
  return raw ? PHASE_LABELS[raw] ?? raw : '';
}

function rowToProtocol(row: ProtocolRow): Protocol {
  const activeVersion = row.protocol_versions.find((v) => v.status === 'ACTIVE');
  return {
    id: row.id,
    code: row.study_number ?? '',
    name: row.title,
    sponsor: row.sponsor,
    phase: phaseLabel(activeVersion?.clinical_trial_phase),
    demoAnchorDate: row.demo_anchor_date,
    timezone: row.timezone,
  };
}

async function fetchProtocols(): Promise<Result<Protocol[]>> {
  try {
    const rows = await fetchAllRows((from, to) =>
      supabase
        .from('protocols')
        .select(
          'id, study_number, title, sponsor, demo_anchor_date, timezone, protocol_versions(clinical_trial_phase, status)',
        )
        .order('created_at', { ascending: true })
        .range(from, to),
    );
    return { ok: true, data: (rows as unknown as ProtocolRow[]).map(rowToProtocol) };
  } catch (e) {
    return fail('fetchProtocols', e);
  }
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

const PARTICIPANT_COLUMNS =
  'id, participant_code, protocol_id, status, enrolled_at, current_study_day, next_visit_date, next_visit_name, assigned_coordinator, open_deviations, notes';

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

async function fetchParticipants(protocolId: string): Promise<Result<SiteParticipant[]>> {
  try {
    const rows = await fetchAllRows((from, to) =>
      supabase
        .from('site_participants')
        .select(PARTICIPANT_COLUMNS)
        .eq('protocol_id', protocolId)
        .order('participant_code', { ascending: true })
        .range(from, to),
    );
    return { ok: true, data: rows.map(rowToParticipant) };
  } catch (e) {
    return fail('fetchParticipants', e);
  }
}

async function createParticipant(input: NewParticipantInput): Promise<Result<SiteParticipant>> {
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
      .select(PARTICIPANT_COLUMNS)
      .single();
    if (error) {
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

async function updateParticipant(
  uuid: string,
  patch: ParticipantPatch,
): Promise<Result<SiteParticipant>> {
  try {
    const { data, error } = await supabase
      .from('site_participants')
      .update(patch)
      .eq('id', uuid)
      .select(PARTICIPANT_COLUMNS)
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

async function deleteParticipant(uuid: string): Promise<Result<void>> {
  try {
    const { error } = await supabase.from('site_participants').delete().eq('id', uuid);
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
    | { cross_references: VisitCrossReference[] | null; confidence_state: SiteVisitConfidence | null }
    | { cross_references: VisitCrossReference[] | null; confidence_state: SiteVisitConfidence | null }[]
    | null;
}

const VISIT_COLUMNS =
  'id, participant_id, protocol_id, date, time_of_day, study_day, visit_name, window_closes, status, procedures, prior_note, deviation_reason, template_id, site_participants!inner(participant_code), protocol_visit_templates(cross_references, confidence_state)';

function rowToVisit(row: VisitRow): SiteVisit {
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
    confidenceState: templateJoin?.confidence_state ?? undefined,
  };
}

async function fetchVisitsForProtocol(protocolId: string): Promise<Result<SiteVisit[]>> {
  try {
    const rows = await fetchAllRows((from, to) =>
      supabase
        .from('site_visits')
        .select(VISIT_COLUMNS)
        .eq('protocol_id', protocolId)
        .order('date', { ascending: true })
        .range(from, to),
    );
    return { ok: true, data: (rows as unknown as VisitRow[]).map(rowToVisit) };
  } catch (e) {
    return fail('fetchVisitsForProtocol', e);
  }
}

async function updateVisit(visitId: string, patch: VisitPatch): Promise<Result<SiteVisit>> {
  try {
    const { data, error } = await supabase
      .from('site_visits')
      .update(patch)
      .eq('id', visitId)
      .select(VISIT_COLUMNS)
      .single();
    if (error) throw error;
    return { ok: true, data: rowToVisit(data as unknown as VisitRow) };
  } catch (e) {
    return fail('updateVisit', e);
  }
}

async function cancelVisit(visitId: string): Promise<Result<SiteVisit>> {
  try {
    const { data, error } = await supabase
      .from('site_visits')
      .update({ status: 'cancelled' })
      .eq('id', visitId)
      .select(VISIT_COLUMNS)
      .single();
    if (error) throw error;
    return { ok: true, data: rowToVisit(data as unknown as VisitRow) };
  } catch (e) {
    return fail('cancelVisit', e);
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

const TEAM_COLUMNS =
  'id, protocol_id, name, role, email, delegated_tasks, certified_through, added_at, status, notes';

async function createTeamMember(input: NewTeamMemberInput): Promise<Result<SiteTeamMember>> {
  try {
    const { data, error } = await supabase
      .from('site_team_members')
      .insert({
        protocol_id: input.protocol_id,
        name: input.name,
        role: input.role,
        email: input.email ?? null,
        delegated_tasks: input.delegated_tasks ?? [],
        certified_through: input.certified_through ?? null,
        status: input.status ?? 'ACTIVE',
        notes: input.notes ?? null,
      })
      .select(TEAM_COLUMNS)
      .single();
    if (error) throw error;
    return { ok: true, data: rowToTeam(data as TeamRow) };
  } catch (e) {
    return fail('createTeamMember', e);
  }
}

async function updateTeamMember(id: string, patch: TeamMemberPatch): Promise<Result<SiteTeamMember>> {
  try {
    const { data, error } = await supabase
      .from('site_team_members')
      .update(patch)
      .eq('id', id)
      .select(TEAM_COLUMNS)
      .single();
    if (error) throw error;
    return { ok: true, data: rowToTeam(data as TeamRow) };
  } catch (e) {
    return fail('updateTeamMember', e);
  }
}

async function deleteTeamMember(id: string): Promise<Result<void>> {
  try {
    const { error } = await supabase.from('site_team_members').delete().eq('id', id);
    if (error) throw error;
    return { ok: true, data: undefined };
  } catch (e) {
    return fail('deleteTeamMember', e);
  }
}

async function createVisit(input: NewVisitInput): Promise<Result<SiteVisit>> {
  try {
    const { data, error } = await supabase
      .from('site_visits')
      .insert({
        protocol_id: input.protocol_id,
        participant_id: input.participant_uuid,
        date: input.date,
        study_day: input.study_day,
        visit_name: input.visit_name,
        time_of_day: input.time_of_day ?? null,
        window_closes: input.window_closes ?? null,
        status: input.status ?? 'scheduled',
        procedures: input.procedures ?? [],
        prior_note: input.prior_note ?? null,
        // template_id and is_seed intentionally omitted — manually-scheduled
        // visits stay outside the materialize_protocol_visits flow.
      })
      .select(VISIT_COLUMNS)
      .single();
    if (error) throw error;
    return { ok: true, data: rowToVisit(data as unknown as VisitRow) };
  } catch (e) {
    return fail('createVisit', e);
  }
}

async function fetchTeamMembers(protocolId: string): Promise<Result<SiteTeamMember[]>> {
  try {
    const rows = await fetchAllRows((from, to) =>
      supabase
        .from('site_team_members')
        .select(
          'id, protocol_id, name, role, email, delegated_tasks, certified_through, added_at, status, notes',
        )
        .eq('protocol_id', protocolId)
        .order('added_at', { ascending: true })
        .range(from, to),
    );
    return { ok: true, data: rows.map(rowToTeam) };
  } catch (e) {
    return fail('fetchTeamMembers', e);
  }
}

// -----------------------------------------------------------------------------
// Documents
// -----------------------------------------------------------------------------

async function fetchProtocolDocuments(protocolId: string): Promise<Result<ProtocolDocument[]>> {
  try {
    const rows = await fetchAllRows((from, to) =>
      supabase
        .from('documents')
        .select('id, title, source, filename, created_at, status, error_message, extracted_fields')
        .eq('protocol_id', protocolId)
        .order('created_at', { ascending: false })
        .range(from, to),
    );
    return { ok: true, data: rows as ProtocolDocument[] };
  } catch (e) {
    return fail('fetchProtocolDocuments', e);
  }
}

// -----------------------------------------------------------------------------
// Templates + anchor + materialize
// -----------------------------------------------------------------------------

async function fetchVisitTemplates(
  protocolId: string,
): Promise<Result<ProtocolVisitTemplate[]>> {
  try {
    const rows = await fetchAllRows((from, to) =>
      supabase
        .from('protocol_visit_templates')
        .select(
          'id, protocol_id, visit_name, study_day, window_minus_days, window_plus_days, procedures, source_document_id, cross_references',
        )
        .eq('protocol_id', protocolId)
        .order('study_day', { ascending: true })
        .range(from, to),
    );
    return { ok: true, data: rows as ProtocolVisitTemplate[] };
  } catch (e) {
    return fail('fetchVisitTemplates', e);
  }
}

async function setAnchorDate(
  protocolId: string,
  anchorDate: string | null,
  timezone?: string | null,
): Promise<Result<void>> {
  try {
    const patch: Record<string, unknown> = { demo_anchor_date: anchorDate };
    if (timezone !== undefined) patch.timezone = timezone;
    const { error } = await supabase
      .from('protocols')
      .update(patch)
      .eq('id', protocolId);
    if (error) throw error;
    return { ok: true, data: undefined };
  } catch (e) {
    return fail('setAnchorDate', e);
  }
}

async function materializeVisits(protocolId: string): Promise<Result<MaterializeResult>> {
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

export const realSiteRepo: SiteRepo = {
  fetchProtocols,
  fetchParticipants,
  createParticipant,
  updateParticipant,
  deleteParticipant,
  fetchVisitsForProtocol,
  createVisit,
  updateVisit,
  cancelVisit,
  fetchTeamMembers,
  createTeamMember,
  updateTeamMember,
  deleteTeamMember,
  fetchProtocolDocuments,
  fetchVisitTemplates,
  setAnchorDate,
  materializeVisits,
};
