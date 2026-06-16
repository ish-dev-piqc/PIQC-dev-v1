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
import type {
  VisitCoverage,
  VisitCoverageGap,
  VisitExecutionWorkspace,
  VisitRequirementHumanEditEvent,
} from '../../types/visit-execution';

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
    if (typeof window === 'undefined') return false;
    const ls = window.localStorage;
    // Mock serves two callers: the dev-only piq-visit-execution-mock-v1 toggle,
    // and Demo Mode — when the demo toggle is on (server-gated bit set by
    // DemoModeContext), Visit Prep should show fixture data like every other
    // demo surface instead of hitting the real RPC with demo protocol ids.
    return ls.getItem(MOCK_TOGGLE_KEY) === '1' || ls.getItem('piq-demo-active-v1') === '1';
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

/**
 * Fetch the protocol-level completeness coverage (#4) for the Visit-Prep banner.
 *
 * Mock on  → null (no synthetic coverage in the demo fixture).
 * Mock off → visit_execution_get_coverage RPC → the latest coverage row, or null
 *            when none exists yet (no banner shown). RPC error → { ok: false }.
 */
export async function fetchVisitCoverage(
  protocolId: string,
): Promise<Result<VisitCoverage | null>> {
  if (isMockEnabled()) return { ok: true, data: null };

  const { data, error } = await supabase.rpc('visit_execution_get_coverage', {
    p_protocol_id: protocolId,
  });
  if (error) return { ok: false, error: error.message };
  if (!data || typeof data !== 'object') return { ok: true, data: null };

  const d = data as Partial<VisitCoverage>;
  const method = d.extraction_method;
  return {
    ok: true,
    data: {
      expected_count: typeof d.expected_count === 'number' ? d.expected_count : 0,
      found_count: typeof d.found_count === 'number' ? d.found_count : 0,
      missing: Array.isArray(d.missing) ? (d.missing as VisitCoverageGap[]) : [],
      detected_at: typeof d.detected_at === 'string' ? d.detected_at : '',
      resolution: typeof d.resolution === 'string' ? d.resolution : 'pending',
      extraction_method:
        method === 'grid_grouped' || method === 'grid_ungrouped' || method === 'grid' ||
          method === 'grid_low_confidence' || method === 'llm_fallback'
          ? method
          : null,
      expected_from_signal: typeof d.expected_from_signal === 'number' ? d.expected_from_signal : null,
    },
  };
}


// ===========================================================================
// Edit-log timeline (Sprint 4c)
//
// `visit_execution_get_human_edit_log` exists since Sprint 2.5 (migration
// 20260601000600_visit_execution_rpcs.sql). Sprint 4c wires the first
// frontend consumer: the EditLogDrawer.
//
// Defensive shape check on each event row — the RPC returns whatever
// json_agg builds, so a schema drift wouldn't reach typescript-time
// validation. We narrow at the boundary and drop malformed rows rather
// than crash the drawer.
// ===========================================================================

/**
 * Fetch the human-edit timeline for one requirement, newest first.
 *
 * Mock-mode short-circuits with a small synthetic timeline so the drawer
 * has something to render in demos. Real-mode wraps the
 * `visit_execution_get_human_edit_log` RPC.
 *
 * Error surface mirrors fetchVisitExecutionWorkspaces:
 *   - RPC error → { ok: false, error }
 *   - Empty / missing events → { ok: true, data: [] }
 */
export async function fetchHumanEditLog(
  requirementId: string,
): Promise<Result<VisitRequirementHumanEditEvent[]>> {
  if (isMockEnabled()) {
    // Seed three events covering edit_text + add_site_note + mark_reviewed so
    // the drawer demo exercises all three rendering branches (before/after
    // diff, reviewer-note body, single-line status change). Ordered newest
    // first to match the real RPC's `ORDER BY created_at DESC` contract.
    const now = Date.now();
    return {
      ok: true,
      data: [
        {
          id: `mock-event-${requirementId}-3`,
          action: 'edit_text',
          reviewer_id: 'mock-reviewer-1',
          previous_text: 'Body weight measurement',
          new_text: 'Body weight measurement (use site scale; calibrate weekly)',
          reviewer_note: null,
          requirement_version: 2,
          amendment_version: null,
          created_at: new Date(now - 1000 * 60 * 15).toISOString(),
        },
        {
          id: `mock-event-${requirementId}-2`,
          action: 'add_site_note',
          reviewer_id: 'mock-reviewer-1',
          previous_text: null,
          new_text: null,
          reviewer_note:
            'Heparin lock in place per site SOP; coordinator confirms with charge nurse before each visit.',
          requirement_version: 1,
          amendment_version: null,
          created_at: new Date(now - 1000 * 60 * 45).toISOString(),
        },
        {
          id: `mock-event-${requirementId}-1`,
          action: 'mark_reviewed',
          reviewer_id: 'mock-reviewer-1',
          previous_text: null,
          new_text: null,
          reviewer_note: null,
          requirement_version: 1,
          amendment_version: null,
          created_at: new Date(now - 1000 * 60 * 90).toISOString(),
        },
      ],
    };
  }

  const { data, error } = await supabase.rpc('visit_execution_get_human_edit_log', {
    p_requirement_id: requirementId,
  });

  if (error) {
    return { ok: false, error: error.message };
  }

  const payload = data as { events?: unknown } | null;
  if (!payload || !Array.isArray(payload.events)) {
    return { ok: true, data: [] };
  }

  // Per-row narrowing — drop anything that doesn't have the minimum shape.
  // Order is preserved (RPC returns DESC by created_at).
  const events: VisitRequirementHumanEditEvent[] = [];
  for (const raw of payload.events as unknown[]) {
    if (!raw || typeof raw !== 'object') continue;
    const r = raw as Partial<VisitRequirementHumanEditEvent>;
    if (
      typeof r.id !== 'string' ||
      typeof r.action !== 'string' ||
      typeof r.reviewer_id !== 'string' ||
      typeof r.created_at !== 'string'
    ) {
      continue;
    }
    events.push({
      id: r.id,
      action: r.action as VisitRequirementHumanEditEvent['action'],
      reviewer_id: r.reviewer_id,
      previous_text: typeof r.previous_text === 'string' ? r.previous_text : null,
      new_text: typeof r.new_text === 'string' ? r.new_text : null,
      reviewer_note: typeof r.reviewer_note === 'string' ? r.reviewer_note : null,
      requirement_version:
        typeof r.requirement_version === 'number' ? r.requirement_version : 0,
      amendment_version: typeof r.amendment_version === 'string' ? r.amendment_version : null,
      created_at: r.created_at,
    });
  }
  return { ok: true, data: events };
}
