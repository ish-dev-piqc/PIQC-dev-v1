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
import { DEMO_PROTOCOL_IDS } from '../demo/ids';
import type {
  ProtocolCohort,
  SoaFootnote,
  VisitCoverage,
  VisitCoverageGap,
  VisitExecutionWorkspace,
  VisitRequirementHumanEditEvent,
} from '../../types/visit-execution';

// In Demo Mode the protocol switcher shows 3 demo "alias" protocol ids, but
// their Visit-Prep content is the REAL parsed data. That content is NEVER baked
// into the client bundle (it would be publicly extractable). Instead we map the
// alias id → the real protocol id and fetch at RUNTIME through the normal
// RLS-protected RPC: an authenticated owner of the protocol gets the real
// workspace; anyone else gets an empty (RLS-filtered) result. So no private
// protocol content ships to the client — it's served per-request, gated by RLS.
const DEMO_ALIAS_TO_REAL_PROTOCOL: Record<string, string> = {
  [DEMO_PROTOCOL_IDS['BRIGHTEN-2']]: 'b04e989a-7df7-48e2-bef7-d551d685876a', // PP06489
  [DEMO_PROTOCOL_IDS['CARDIAC-7']]: '4bf903e9-b98a-46ab-9027-135ac2cac590', // CLR_18_06
  [DEMO_PROTOCOL_IDS['IMMUNE-14']]: 'cad4ea2e-f63e-4a71-b609-8fba1858b30a', // ND-L02-s0201-005
};

function resolveProtocolId(protocolId: string): string {
  return DEMO_ALIAS_TO_REAL_PROTOCOL[protocolId] ?? protocolId;
}

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
    // Dev-only toggle for the synthetic coverage / edit-log fixtures below.
    // NOTE: Demo Mode deliberately does NOT enable this — demo Visit-Prep now
    // fetches the real workspace at runtime via the RLS-protected RPC (with an
    // alias→real protocol-id remap), so no protocol content is bundled.
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
  // Demo alias ids resolve to the real protocol id; the RPC's own RLS still
  // gates who gets data back (owner/org only). Content is fetched per-request,
  // never bundled.
  const realId = resolveProtocolId(protocolId);

  const { data, error } = await supabase.rpc('visit_execution_get_workspace', {
    p_protocol_id: realId,
  });

  if (error) {
    return { ok: false, error: error.message };
  }

  // RPC contract: { workspaces: VisitExecutionWorkspace[] }. Anything else
  // is a server-side schema drift; surface as empty rather than crash.
  const payload = data as { workspaces?: unknown } | null;
  const raw = Array.isArray(payload?.workspaces)
    ? (payload!.workspaces as VisitExecutionWorkspace[])
    : [];
  // Re-label to the requested (alias) id so the UI stays consistent with the
  // demo protocol the user selected in the switcher.
  const workspaces =
    realId === protocolId ? raw : raw.map((w) => ({ ...w, protocol_id: protocolId }));
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
    p_protocol_id: resolveProtocolId(protocolId),
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


/**
 * Fetch the authoritative cohort list for a protocol (Slice 3), ordered by the
 * protocol's own cohort order. Read directly from `protocol_cohorts` under RLS —
 * owner/org members get the rows, anyone else gets an empty (RLS-filtered)
 * result. Demo alias ids resolve to the real protocol id, same as
 * fetchVisitExecutionWorkspaces.
 *
 * Empty list → the protocol has no extracted cohorts (single-schedule) → the UI
 * shows no cohort selector (no behavior change).
 *
 * Error surface:
 *   - query error (network, RLS, schema drift) → { ok: false, error }
 *   - no rows → { ok: true, data: [] }
 */
export async function fetchProtocolCohorts(
  protocolId: string,
): Promise<Result<ProtocolCohort[]>> {
  if (isMockEnabled()) return { ok: true, data: [] };

  const { data, error } = await supabase
    .from('protocol_cohorts')
    .select('label, dose_regimen, description, ordinal, source_page')
    .eq('protocol_id', resolveProtocolId(protocolId))
    .order('ordinal', { ascending: true });

  if (error) return { ok: false, error: error.message };
  if (!Array.isArray(data)) return { ok: true, data: [] };

  // Per-row narrowing — drop anything without a usable label rather than crash
  // the selector on a schema drift. Order preserved (RPC sorts by ordinal).
  const cohorts: ProtocolCohort[] = [];
  for (const raw of data as unknown[]) {
    if (!raw || typeof raw !== 'object') continue;
    const r = raw as Partial<ProtocolCohort>;
    if (typeof r.label !== 'string' || !r.label.trim()) continue;
    cohorts.push({
      label: r.label,
      dose_regimen: typeof r.dose_regimen === 'string' ? r.dose_regimen : null,
      description: typeof r.description === 'string' ? r.description : null,
      ordinal: typeof r.ordinal === 'number' ? r.ordinal : 0,
      source_page: typeof r.source_page === 'number' ? r.source_page : null,
    });
  }
  return { ok: true, data: cohorts };
}


/**
 * Fetch the SoA footnote text for a protocol — backs the display-only
 * "Footnotes" button. Calls the `get_protocol_soa_footnotes` RPC (SECURITY
 * DEFINER + protocol-access gate), which returns the raw footnote chunks
 * ({ page, section, content }) — no structuring, no linkage. Demo alias ids
 * resolve to the real protocol id (same as fetchVisitExecutionWorkspaces).
 *
 * Error surface:
 *   - RPC error → { ok: false, error }
 *   - no footnotes, or access-denied (gated empty) → { ok: true, data: [] }
 */
export async function fetchSoaFootnotes(
  protocolId: string,
): Promise<Result<SoaFootnote[]>> {
  if (isMockEnabled()) return { ok: true, data: [] };

  const { data, error } = await supabase.rpc('get_protocol_soa_footnotes', {
    p_protocol_id: resolveProtocolId(protocolId),
  });

  if (error) return { ok: false, error: error.message };

  // RPC contract: { footnotes: SoaFootnote[] }. Anything else → empty.
  const payload = data as { footnotes?: unknown } | null;
  if (!payload || !Array.isArray(payload.footnotes)) return { ok: true, data: [] };

  // Per-row narrowing — drop malformed rows rather than crash the drawer.
  const footnotes: SoaFootnote[] = [];
  for (const raw of payload.footnotes as unknown[]) {
    if (!raw || typeof raw !== 'object') continue;
    const r = raw as Partial<SoaFootnote>;
    if (typeof r.content !== 'string' || !r.content.trim()) continue;
    footnotes.push({
      page: typeof r.page === 'number' ? r.page : null,
      section: typeof r.section === 'string' ? r.section : '',
      content: r.content,
    });
  }
  return { ok: true, data: footnotes };
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
