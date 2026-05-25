// =============================================================================
// demoSiteRepo — Demo Mode implementation of SiteRepo. Reads from the
// in-memory demo store (sessionStorage-backed). Mutations notify subscribers
// via demoStore.mutate so SiteDataContext can re-render without Supabase
// realtime.
// =============================================================================

import { DEMO_DOCS_BY_PROTOCOL, getDemoStore } from '../../demo';
import type {
  MaterializeResult,
  ProtocolDocument,
  ProtocolVisitTemplate,
  SiteParticipant,
  SiteTeamMember,
  SiteVisit,
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

function ok<T>(data: T): Result<T> {
  return { ok: true, data };
}

function notFound<T>(label: string): Result<T> {
  return { ok: false, error: `${label} not found in demo store` };
}

// Stable-ish UUID for created entities. Falls back to a timestamp-based string
// if crypto.randomUUID isn't available (very old browsers).
function newUuid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `demo-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

// -----------------------------------------------------------------------------

async function fetchProtocols(): Promise<Result<Protocol[]>> {
  return ok(getDemoStore().getState().protocols);
}

async function fetchParticipants(protocolId: string): Promise<Result<SiteParticipant[]>> {
  const list = getDemoStore()
    .getState()
    .participants.filter((p) => p.protocol_id === protocolId)
    .sort((a, b) => a.id.localeCompare(b.id));
  return ok(list);
}

async function createParticipant(input: NewParticipantInput): Promise<Result<SiteParticipant>> {
  const state = getDemoStore().getState();
  const duplicate = state.participants.find(
    (p) => p.protocol_id === input.protocol_id && p.id === input.participant_code,
  );
  if (duplicate) {
    return {
      ok: false,
      error: `Participant code "${input.participant_code}" already exists on this protocol.`,
    };
  }
  const created: SiteParticipant = {
    id: input.participant_code,
    uuid: newUuid(),
    protocol_id: input.protocol_id,
    status: input.status,
    enrolled_at: input.enrolled_at ?? null,
    current_study_day: input.current_study_day ?? null,
    next_visit_date: input.next_visit_date ?? null,
    next_visit_name: input.next_visit_name ?? null,
    assigned_coordinator: input.assigned_coordinator ?? '',
    open_deviations: input.open_deviations ?? 0,
    notes: input.notes ?? null,
  };
  getDemoStore().mutate((s) => ({ ...s, participants: [...s.participants, created] }));
  return ok(created);
}

async function updateParticipant(
  uuid: string,
  patch: ParticipantPatch,
): Promise<Result<SiteParticipant>> {
  const store = getDemoStore();
  const current = store.getState().participants.find((p) => p.uuid === uuid);
  if (!current) return notFound('participant');

  // participant_code uniqueness check if it's being changed
  if (patch.participant_code && patch.participant_code !== current.id) {
    const dup = store
      .getState()
      .participants.find(
        (p) =>
          p.protocol_id === current.protocol_id && p.id === patch.participant_code && p.uuid !== uuid,
      );
    if (dup) return { ok: false, error: 'Participant code already exists on this protocol.' };
  }

  const updated: SiteParticipant = {
    ...current,
    id: patch.participant_code ?? current.id,
    status: patch.status ?? current.status,
    enrolled_at: patch.enrolled_at === undefined ? current.enrolled_at : patch.enrolled_at,
    current_study_day:
      patch.current_study_day === undefined ? current.current_study_day : patch.current_study_day,
    next_visit_date:
      patch.next_visit_date === undefined ? current.next_visit_date : patch.next_visit_date,
    next_visit_name:
      patch.next_visit_name === undefined ? current.next_visit_name : patch.next_visit_name,
    assigned_coordinator:
      patch.assigned_coordinator === undefined
        ? current.assigned_coordinator
        : patch.assigned_coordinator ?? '',
    open_deviations:
      patch.open_deviations === undefined ? current.open_deviations : patch.open_deviations,
    notes: patch.notes === undefined ? current.notes : patch.notes,
  };
  store.mutate((s) => ({
    ...s,
    participants: s.participants.map((p) => (p.uuid === uuid ? updated : p)),
  }));
  return ok(updated);
}

async function deleteParticipant(uuid: string): Promise<Result<void>> {
  getDemoStore().mutate((s) => {
    // Resolve the participant_code once, not per-visit (O(n+m) vs O(n*m)).
    const targetCode = s.participants.find((p) => p.uuid === uuid)?.id;
    return {
      ...s,
      participants: s.participants.filter((p) => p.uuid !== uuid),
      visits: targetCode
        ? s.visits.filter((v) => v.participantId !== targetCode)
        : s.visits,
    };
  });
  return ok(undefined);
}

// -----------------------------------------------------------------------------

async function fetchVisitsForProtocol(protocolId: string): Promise<Result<SiteVisit[]>> {
  const state = getDemoStore().getState();

  // Join cross-references from visit templates by matching on visit name —
  // demo visits don't carry a template_id, but visit_name is unique enough
  // within a protocol's schedule for the demo to feel right.
  const templatesByName = new Map<string, ProtocolVisitTemplate>();
  for (const t of state.visitTemplates) {
    if (t.protocol_id === protocolId) templatesByName.set(t.visit_name, t);
  }

  const list = state.visits
    .filter((v) => v.protocolId === protocolId)
    .map((v) => {
      const tpl = templatesByName.get(v.visitName);
      if (!tpl || tpl.cross_references.length === 0) return v;
      return { ...v, crossReferences: tpl.cross_references };
    })
    .sort((a, b) => a.date.localeCompare(b.date));
  return ok(list);
}

async function updateVisit(visitId: string, patch: VisitPatch): Promise<Result<SiteVisit>> {
  const store = getDemoStore();
  const current = store.getState().visits.find((v) => v.id === visitId);
  if (!current) return notFound('visit');

  const updated: SiteVisit = {
    ...current,
    status: patch.status ?? current.status,
    deviationReason:
      patch.deviation_reason === undefined
        ? current.deviationReason
        : patch.deviation_reason ?? undefined,
    priorNote:
      patch.prior_note === undefined ? current.priorNote : patch.prior_note ?? undefined,
  };
  store.mutate((s) => ({
    ...s,
    visits: s.visits.map((v) => (v.id === visitId ? updated : v)),
  }));
  return ok(updated);
}

// -----------------------------------------------------------------------------

async function createVisit(input: NewVisitInput): Promise<Result<SiteVisit>> {
  const store = getDemoStore();
  // Resolve participant_code from uuid for the camelCase SiteVisit shape.
  const participant = store.getState().participants.find((p) => p.uuid === input.participant_uuid);
  if (!participant) return notFound('participant');

  const created: SiteVisit = {
    id: newUuid(),
    date: input.date,
    time: input.time_of_day ?? undefined,
    protocolId: input.protocol_id,
    participantId: participant.id,
    studyDay: input.study_day,
    visitName: input.visit_name,
    windowCloses: input.window_closes ?? undefined,
    status: input.status ?? 'scheduled',
    procedures: input.procedures && input.procedures.length > 0 ? input.procedures : undefined,
    priorNote: input.prior_note ?? undefined,
  };
  store.mutate((s) => ({ ...s, visits: [...s.visits, created] }));
  return ok(created);
}

async function createTeamMember(input: NewTeamMemberInput): Promise<Result<SiteTeamMember>> {
  const now = new Date();
  const todayYmd = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const created: SiteTeamMember = {
    id: newUuid(),
    protocol_id: input.protocol_id,
    name: input.name,
    role: input.role,
    email: input.email ?? '',
    delegated_tasks: input.delegated_tasks ?? [],
    certified_through: input.certified_through ?? '',
    added_at: todayYmd,
    status: input.status ?? 'ACTIVE',
    notes: input.notes ?? null,
  };
  getDemoStore().mutate((s) => ({ ...s, teamMembers: [...s.teamMembers, created] }));
  return ok(created);
}

async function updateTeamMember(
  id: string,
  patch: TeamMemberPatch,
): Promise<Result<SiteTeamMember>> {
  const store = getDemoStore();
  const current = store.getState().teamMembers.find((t) => t.id === id);
  if (!current) return notFound('team member');

  const updated: SiteTeamMember = {
    ...current,
    name: patch.name ?? current.name,
    role: patch.role ?? current.role,
    email: patch.email === undefined ? current.email : patch.email ?? '',
    delegated_tasks: patch.delegated_tasks ?? current.delegated_tasks,
    certified_through:
      patch.certified_through === undefined
        ? current.certified_through
        : patch.certified_through ?? '',
    status: patch.status ?? current.status,
    notes: patch.notes === undefined ? current.notes : patch.notes,
  };
  store.mutate((s) => ({
    ...s,
    teamMembers: s.teamMembers.map((t) => (t.id === id ? updated : t)),
  }));
  return ok(updated);
}

async function deleteTeamMember(id: string): Promise<Result<void>> {
  getDemoStore().mutate((s) => ({
    ...s,
    teamMembers: s.teamMembers.filter((t) => t.id !== id),
  }));
  return ok(undefined);
}

async function fetchTeamMembers(protocolId: string): Promise<Result<SiteTeamMember[]>> {
  const list = getDemoStore()
    .getState()
    .teamMembers.filter((t) => t.protocol_id === protocolId)
    .sort((a, b) => a.added_at.localeCompare(b.added_at));
  return ok(list);
}

// -----------------------------------------------------------------------------

async function fetchProtocolDocuments(protocolId: string): Promise<Result<ProtocolDocument[]>> {
  const ids = new Set(DEMO_DOCS_BY_PROTOCOL[protocolId] ?? []);
  const list = getDemoStore()
    .getState()
    .documents.filter((d) => ids.has(d.id));
  return ok(list);
}

// -----------------------------------------------------------------------------

async function fetchVisitTemplates(
  protocolId: string,
): Promise<Result<ProtocolVisitTemplate[]>> {
  const list = getDemoStore()
    .getState()
    .visitTemplates.filter((t) => t.protocol_id === protocolId)
    .sort((a, b) => a.study_day - b.study_day);
  return ok(list);
}

async function setAnchorDate(
  protocolId: string,
  anchorDate: string | null,
  timezone?: string | null,
): Promise<Result<void>> {
  getDemoStore().mutate((s) => ({
    ...s,
    protocols: s.protocols.map((p) =>
      p.id === protocolId
        ? {
            ...p,
            demoAnchorDate: anchorDate,
            ...(timezone !== undefined ? { timezone } : {}),
          }
        : p,
    ),
  }));
  return ok(undefined);
}

async function materializeVisits(protocolId: string): Promise<Result<MaterializeResult>> {
  // Demo doesn't actually re-project — the fixtures already cover the visit
  // surface area we want to show. Report a realistic "created" count so the
  // toast still feels right.
  const created = getDemoStore()
    .getState()
    .visits.filter((v) => v.protocolId === protocolId).length;
  return ok({ created, skipped_no_anchor: 0 });
}

// -----------------------------------------------------------------------------

export const demoSiteRepo: SiteRepo = {
  fetchProtocols,
  fetchParticipants,
  createParticipant,
  updateParticipant,
  deleteParticipant,
  fetchVisitsForProtocol,
  createVisit,
  updateVisit,
  fetchTeamMembers,
  createTeamMember,
  updateTeamMember,
  deleteTeamMember,
  fetchProtocolDocuments,
  fetchVisitTemplates,
  setAnchorDate,
  materializeVisits,
};
