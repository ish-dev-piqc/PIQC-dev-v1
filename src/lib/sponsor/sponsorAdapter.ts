import type {
  SponsorPortfolioEntry,
  SponsorProtocolDetail,
} from '../../types/sponsor';

// =============================================================================
// sponsorAdapter — pure mappers between the `list_my_sponsor_portfolio` RPC
// row shape and the camelCase TS surface the UI consumes. No supabase import,
// no side effects. Tested via sibling test file.
// =============================================================================

/** Raw row shape returned by the `list_my_sponsor_portfolio` RPC. Mirrors
 *  the SQL RETURNS TABLE in `20260704000900_list_my_sponsor_portfolio.sql`. */
export interface SponsorPortfolioRow {
  protocol_id: string;
  protocol_code: string | null;
  protocol_title: string;
  site_org_id: string;
  site_org_name: string;
  participant_count: number | null;
  last_visit_at: string | null;
}

export function adaptSponsorPortfolioRow(row: SponsorPortfolioRow): SponsorPortfolioEntry {
  return {
    protocolId: row.protocol_id,
    protocolCode: row.protocol_code,
    protocolTitle: row.protocol_title,
    siteOrgId: row.site_org_id,
    siteOrgName: row.site_org_name,
    // Postgres aggregates can come back null when LEFT JOIN matches zero
    // children. Surface as 0 — easier to render than nullable.
    participantCount: row.participant_count ?? 0,
    lastVisitAt: row.last_visit_at,
  };
}

export function adaptSponsorPortfolio(rows: SponsorPortfolioRow[]): SponsorPortfolioEntry[] {
  return rows.map(adaptSponsorPortfolioRow);
}

// ---------------------------------------------------------------------------
// SponsorProtocolDetail — JSONB returned by get_sponsor_protocol_detail.
// ---------------------------------------------------------------------------

interface RawSponsorProtocolDetail {
  visit_counts?: {
    scheduled?: number | null;
    completed?: number | null;
    missed?: number | null;
    deviation?: number | null;
    overdue?: number | null;
  } | null;
  enrollment?: {
    screening?: number | null;
    screen_failure?: number | null;
    active?: number | null;
    completed?: number | null;
    withdrawn?: number | null;
  } | null;
  recent_deviations?: Array<{
    visit_id: string;
    date: string;
    participant_code: string | null;
    visit_name: string | null;
    deviation_reason: string | null;
  }> | null;
}

/** Adapt the JSONB blob from `get_sponsor_protocol_detail` into the
 *  camelCase TS shape the drawer consumes. Tolerates partially-null
 *  payloads — coerces every count to 0 and missing arrays to []. */
export function adaptSponsorProtocolDetail(raw: unknown): SponsorProtocolDetail {
  const r = (raw ?? {}) as RawSponsorProtocolDetail;
  const vc = r.visit_counts ?? {};
  const en = r.enrollment ?? {};
  const devs = r.recent_deviations ?? [];
  return {
    visitCounts: {
      scheduled: vc.scheduled ?? 0,
      completed: vc.completed ?? 0,
      missed: vc.missed ?? 0,
      deviation: vc.deviation ?? 0,
      overdue: vc.overdue ?? 0,
    },
    enrollment: {
      screening: en.screening ?? 0,
      screenFailure: en.screen_failure ?? 0,
      active: en.active ?? 0,
      completed: en.completed ?? 0,
      withdrawn: en.withdrawn ?? 0,
    },
    recentDeviations: devs.map((d) => ({
      visitId: d.visit_id,
      date: d.date,
      participantCode: d.participant_code,
      visitName: d.visit_name,
      deviationReason: d.deviation_reason,
    })),
  };
}
