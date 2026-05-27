// =============================================================================
// Visit Execution Workspace — API module.
//
// Returns Result<T> per CLAUDE.md API convention. Localhost-only mock toggle
// follows the piq-site-mock-calendar-v1 pattern: a single boolean
// localStorage flag, defaults off, controls whether mock fixture data is
// returned instead of the real Supabase path.
//
// Real path: calls fetchVisitTemplates() from src/lib/site/siteApi.ts (which
// delegates to the active SiteRepo — real or demo) and runs the result
// through visitExecutionAdapter.adaptVisitTemplates().
//
// No throw outside programmer-error guards. No Supabase imports here; the
// real fetch is delegated to siteApi.
//
// Sprint 3.5a note: the parser-integration design doc §9.1 proposes
// switching the real path to call the visit_execution_get_workspace RPC
// directly. That switch is intentionally deferred to Sprint 3.5b — until
// the ingest pipeline writes visit_requirements / purpose / completeness_
// signals (Sprint 3.5b work), the RPC returns empty arrays for every
// protocol. The current adapter path produces a flat-but-non-empty
// workspace from procedures TEXT[], which is more useful UX-wise as a
// bridge. 3.5b flips this in one coordinated change.
// =============================================================================

import { fetchVisitTemplates } from '../site/siteApi';
import type { Result } from '../site/siteApi';
import { adaptVisitTemplates } from './visitExecutionAdapter';
import { getMockVisitExecutionWorkspaces } from './mockVisitWorkspace';
import type { VisitExecutionWorkspace } from '../../types/visit-execution';

/**
 * localStorage key that gates the Sprint 1 mock fixture. Default off.
 * Pattern mirrors piq-site-mock-calendar-v1 (deprecated) — single boolean,
 * value '1' = on, anything else = off.
 */
export const MOCK_TOGGLE_KEY = 'piq-visit-execution-mock-v1';

/**
 * Check the mock toggle without throwing if localStorage is unavailable
 * (SSR safety, even though this is a Vite SPA — keeps the function pure
 * enough to call from any environment).
 */
export function isMockEnabled(): boolean {
  try {
    return typeof window !== 'undefined' && window.localStorage.getItem(MOCK_TOGGLE_KEY) === '1';
  } catch {
    return false;
  }
}

/**
 * Fetch the list of VisitExecutionWorkspace objects for a protocol.
 *
 * Mock on  → returns rich Sprint 1 fixture data from mockVisitWorkspace.ts
 * Mock off → calls fetchVisitTemplates() + adaptVisitTemplates() — flat items,
 *            honest "structured ingest extraction pending" purpose copy
 *
 * Workspaces are ordered by study_day ascending.
 */
export async function fetchVisitExecutionWorkspaces(
  protocolId: string,
): Promise<Result<VisitExecutionWorkspace[]>> {
  if (isMockEnabled()) {
    const mockWorkspaces = getMockVisitExecutionWorkspaces(protocolId);
    return { ok: true, data: mockWorkspaces };
  }

  const templatesResult = await fetchVisitTemplates(protocolId);
  if (!templatesResult.ok) {
    return templatesResult;
  }
  return { ok: true, data: adaptVisitTemplates(templatesResult.data) };
}
