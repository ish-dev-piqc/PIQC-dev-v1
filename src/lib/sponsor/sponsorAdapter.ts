import type { SponsorPortfolioEntry } from '../../types/sponsor';

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
