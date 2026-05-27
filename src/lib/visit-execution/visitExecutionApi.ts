// =============================================================================
// Visit Execution Workspace — API module.
//
// Returns Result<T> per CLAUDE.md API convention. Localhost-only mock toggle
// follows the piq-site-mock-calendar-v1 pattern: a single boolean
// localStorage flag, defaults off, controls whether mock fixture data is
// returned instead of the real Supabase path.
//
// Sprint 3.5b: real path now calls the v2 visit_execution_get_workspace RPC
// directly (per parser-integration.md §9.1). The previous Sprint 1 bridge
// path (fetchVisitTemplates + adaptVisitTemplates) is retired from production
// use; visitExecutionAdapter survives only for the mock fixture's typing.
//
// No throw outside programmer-error guards.
// =============================================================================

import { supabase } from '../supabase';
import type { Result } from '../site/siteApi';
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
 * Mock off → calls supabase.rpc('visit_execution_get_workspace', {...})
 *            which returns a fully-shaped { workspaces: [...] } payload
 *            matching VisitExecutionWorkspace[] directly. No adapter step.
 *
 * Workspaces are ordered by study_day ascending (RPC handles the sort).
 *
 * Error surface:
 *   - RPC error (network, RLS denial, RAISE EXCEPTION) → { ok: false, error }
 *   - RPC returns null/missing `workspaces` → { ok: true, data: [] } (the
 *     ownership gate returns an empty array, not an error, to avoid leaking
 *     existence via error messages).
 */
export async function fetchVisitExecutionWorkspaces(
  protocolId: string,
): Promise<Result<VisitExecutionWorkspace[]>> {
  if (isMockEnabled()) {
    const mockWorkspaces = getMockVisitExecutionWorkspaces(protocolId);
    return { ok: true, data: mockWorkspaces };
  }

  const { data, error } = await supabase.rpc('visit_execution_get_workspace', {
    p_protocol_id: protocolId,
  });

  if (error) {
    return { ok: false, error: error.message };
  }

  // RPC contract: { workspaces: VisitExecutionWorkspace[] }. Anything else
  // is a server-side schema drift; surface as empty rather than crash.
  const payload = data as { workspaces?: unknown } | null;
  const workspaces = Array.isArray(payload?.workspaces)
    ? (payload!.workspaces as VisitExecutionWorkspace[])
    : [];
  return { ok: true, data: workspaces };
}
