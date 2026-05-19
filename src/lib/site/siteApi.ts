// =============================================================================
// Site Mode — data-layer dispatcher.
//
// Forwards every call to whichever SiteRepo is currently active.
//   - realSiteRepo (default) hits Supabase
//   - demoSiteRepo reads/writes the in-memory demo store
//
// DemoModeContext flips the active repo via setSiteRepo() when the demo
// toggle changes. Callers continue to import functions from this module —
// no consumer changes needed.
// =============================================================================

import { realSiteRepo } from './repos/realSiteRepo';
import type {
  NewParticipantInput,
  NewProtocolInput,
  NewTeamMemberInput,
  NewVisitInput,
  ParticipantPatch,
  Result,
  SiteRepo,
  TeamMemberPatch,
  VisitPatch,
} from './repos/types';
import type {
  MaterializeResult,
  ProtocolDocument,
  ProtocolVisitTemplate,
  SiteParticipant,
  SiteTeamMember,
  SiteVisit,
} from './types';
import type { Protocol } from '../../context/ProtocolContext';

export type {
  Result,
  NewParticipantInput,
  NewProtocolInput,
  NewTeamMemberInput,
  NewVisitInput,
  ParticipantPatch,
  TeamMemberPatch,
  VisitPatch,
  SiteRepo,
};

let activeRepo: SiteRepo = realSiteRepo;
const listeners = new Set<() => void>();

/** Swap the active repo (called by DemoModeContext on toggle). */
export function setSiteRepo(repo: SiteRepo): void {
  if (repo === activeRepo) return;
  activeRepo = repo;
  listeners.forEach((l) => l());
}

/** Subscribe to repo swaps so consumers can re-fetch. */
export function subscribeSiteRepo(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Read the active repo (for callers that want the whole object). */
export function getSiteRepo(): SiteRepo {
  return activeRepo;
}

// -----------------------------------------------------------------------------
// Function exports — thin pass-throughs to whichever repo is active. Closure
// over `activeRepo` resolves at call time, so a swap mid-flight on a new call
// uses the new repo.
// -----------------------------------------------------------------------------

export function fetchProtocols(): Promise<Result<Protocol[]>> {
  return activeRepo.fetchProtocols();
}

export function createProtocol(input: NewProtocolInput): Promise<Result<Protocol>> {
  return activeRepo.createProtocol(input);
}

export function fetchParticipants(protocolId: string): Promise<Result<SiteParticipant[]>> {
  return activeRepo.fetchParticipants(protocolId);
}

export function createParticipant(input: NewParticipantInput): Promise<Result<SiteParticipant>> {
  return activeRepo.createParticipant(input);
}

export function updateParticipant(
  uuid: string,
  patch: ParticipantPatch,
): Promise<Result<SiteParticipant>> {
  return activeRepo.updateParticipant(uuid, patch);
}

export function deleteParticipant(uuid: string): Promise<Result<void>> {
  return activeRepo.deleteParticipant(uuid);
}

export function fetchVisitsForProtocol(protocolId: string): Promise<Result<SiteVisit[]>> {
  return activeRepo.fetchVisitsForProtocol(protocolId);
}

export function createVisit(input: NewVisitInput): Promise<Result<SiteVisit>> {
  return activeRepo.createVisit(input);
}

export function updateVisit(visitId: string, patch: VisitPatch): Promise<Result<SiteVisit>> {
  return activeRepo.updateVisit(visitId, patch);
}

export function fetchTeamMembers(protocolId: string): Promise<Result<SiteTeamMember[]>> {
  return activeRepo.fetchTeamMembers(protocolId);
}

export function createTeamMember(input: NewTeamMemberInput): Promise<Result<SiteTeamMember>> {
  return activeRepo.createTeamMember(input);
}

export function updateTeamMember(id: string, patch: TeamMemberPatch): Promise<Result<SiteTeamMember>> {
  return activeRepo.updateTeamMember(id, patch);
}

export function deleteTeamMember(id: string): Promise<Result<void>> {
  return activeRepo.deleteTeamMember(id);
}

export function fetchProtocolDocuments(
  protocolId: string,
): Promise<Result<ProtocolDocument[]>> {
  return activeRepo.fetchProtocolDocuments(protocolId);
}

export function fetchVisitTemplates(
  protocolId: string,
): Promise<Result<ProtocolVisitTemplate[]>> {
  return activeRepo.fetchVisitTemplates(protocolId);
}

export function setAnchorDate(
  protocolId: string,
  anchorDate: string | null,
): Promise<Result<void>> {
  return activeRepo.setAnchorDate(protocolId, anchorDate);
}

export function materializeVisits(
  protocolId: string,
): Promise<Result<MaterializeResult>> {
  return activeRepo.materializeVisits(protocolId);
}
