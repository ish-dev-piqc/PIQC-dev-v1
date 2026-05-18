// =============================================================================
// Demo Store — in-memory, sessionStorage-backed state for Demo Mode.
//
// Holds all five collections the site-mode repos read from. Provides:
//   - getState() — read snapshot
//   - mutate(updater) — apply an update, persist to sessionStorage, notify
//   - subscribe(listener) — returns unsubscribe
//   - reset() — restore fixtures + clear sessionStorage
//
// Persistence is sessionStorage so a mid-demo refresh keeps mutations but a
// fresh tab/sign-in starts from a clean fixture snapshot. The store is a
// module-level singleton; everything outside this file talks to `demoStore`.
//
// Defensive design: any sessionStorage read failure (private-browsing, quota,
// stale shape) falls back silently to fresh fixtures.
// =============================================================================

import type {
  ProtocolDocument,
  ProtocolVisitTemplate,
  SiteParticipant,
  SiteTeamMember,
  SiteVisit,
} from '../site/types';
import type { Protocol } from '../../context/ProtocolContext';
import { getDemoProtocols } from './fixtures/protocols';
import { getDemoParticipants } from './fixtures/participants';
import { getDemoVisits } from './fixtures/visits';
import { getDemoTeamMembers } from './fixtures/teamMembers';
import { getDemoDocuments } from './fixtures/documents';
import { getDemoVisitTemplates } from './fixtures/visitTemplates';

const STORAGE_KEY = 'piq-demo-store-v1';

export interface DemoState {
  protocols: Protocol[];
  participants: SiteParticipant[];
  visits: SiteVisit[];
  teamMembers: SiteTeamMember[];
  documents: ProtocolDocument[];
  visitTemplates: ProtocolVisitTemplate[];
}

function freshFixtures(): DemoState {
  return {
    protocols: getDemoProtocols(),
    participants: getDemoParticipants(),
    visits: getDemoVisits(),
    teamMembers: getDemoTeamMembers(),
    documents: getDemoDocuments(),
    visitTemplates: getDemoVisitTemplates(),
  };
}

function loadFromSession(): DemoState | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<DemoState>;
    // Sanity: every required collection must be an array. Anything else means
    // the stored shape is stale (older demo version) — drop it and re-seed.
    if (
      !Array.isArray(parsed.protocols) ||
      !Array.isArray(parsed.participants) ||
      !Array.isArray(parsed.visits) ||
      !Array.isArray(parsed.teamMembers) ||
      !Array.isArray(parsed.documents) ||
      !Array.isArray(parsed.visitTemplates)
    ) {
      return null;
    }
    return parsed as DemoState;
  } catch {
    return null;
  }
}

function saveToSession(state: DemoState): void {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* ignore — private mode / quota */
  }
}

function clearSession(): void {
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

export interface DemoStore {
  getState(): DemoState;
  mutate(updater: (s: DemoState) => DemoState): void;
  subscribe(listener: () => void): () => void;
  reset(): void;
}

export function createDemoStore(): DemoStore {
  let state: DemoState = loadFromSession() ?? freshFixtures();
  const listeners = new Set<() => void>();

  return {
    getState: () => state,
    mutate: (updater) => {
      state = updater(state);
      saveToSession(state);
      listeners.forEach((l) => l());
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    reset: () => {
      state = freshFixtures();
      clearSession();
      listeners.forEach((l) => l());
    },
  };
}

// Module-level singleton. Lazy so tests can swap it via createDemoStore().
let _instance: DemoStore | null = null;
export function getDemoStore(): DemoStore {
  if (!_instance) _instance = createDemoStore();
  return _instance;
}
