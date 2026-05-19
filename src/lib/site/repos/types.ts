// =============================================================================
// SiteRepo — the contract every site-mode data backend implements.
//
// Two implementations:
//   - realSiteRepo: hits Supabase (production data path)
//   - demoSiteRepo: hits the in-memory demo store (Demo Mode only)
//
// siteApi.ts is the dispatcher — call sites import functions from there, not
// from a repo directly. DemoModeContext flips the active repo via setSiteRepo.
// =============================================================================

import type { Protocol } from '../../../context/ProtocolContext';
import type {
  SiteParticipant,
  SiteVisit,
  SiteTeamMember,
  ProtocolDocument,
  ProtocolVisitTemplate,
  MaterializeResult,
} from '../types';

export type Result<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };

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

export type VisitPatch = Partial<{
  status: SiteVisit['status'];
  deviation_reason: string | null;
  prior_note: string | null;
}>;

export interface NewProtocolInput {
  study_number: string;
  title: string;
  sponsor: string;
  // ProtocolContext's PHASE_LABELS keys (matches DB enum values).
  clinical_trial_phase:
    | 'PHASE_1'
    | 'PHASE_1_2'
    | 'PHASE_2'
    | 'PHASE_2_3'
    | 'PHASE_3'
    | 'PHASE_4'
    | 'NOT_APPLICABLE';
}

export interface SiteRepo {
  // Protocols
  fetchProtocols(): Promise<Result<Protocol[]>>;
  createProtocol(input: NewProtocolInput): Promise<Result<Protocol>>;

  // Participants
  fetchParticipants(protocolId: string): Promise<Result<SiteParticipant[]>>;
  createParticipant(input: NewParticipantInput): Promise<Result<SiteParticipant>>;
  updateParticipant(uuid: string, patch: ParticipantPatch): Promise<Result<SiteParticipant>>;
  deleteParticipant(uuid: string): Promise<Result<void>>;

  // Visits
  fetchVisitsForProtocol(protocolId: string): Promise<Result<SiteVisit[]>>;
  updateVisit(visitId: string, patch: VisitPatch): Promise<Result<SiteVisit>>;

  // Team
  fetchTeamMembers(protocolId: string): Promise<Result<SiteTeamMember[]>>;

  // Documents
  fetchProtocolDocuments(protocolId: string): Promise<Result<ProtocolDocument[]>>;

  // Templates + anchor + materialize
  fetchVisitTemplates(protocolId: string): Promise<Result<ProtocolVisitTemplate[]>>;
  setAnchorDate(protocolId: string, anchorDate: string | null): Promise<Result<void>>;
  materializeVisits(protocolId: string): Promise<Result<MaterializeResult>>;
}
