// =============================================================================
// Sponsor Mode — TypeScript types (placeholder).
//
// Mirrors sponsor_relationships from 20260618000300_sponsor_relationships_stub.sql.
// Sponsor Mode is deferred; this file exists so the access-control function's
// clause (c) has a typed footprint when the feature lights up. v1 reads from
// the empty table only.
// =============================================================================

export interface SponsorRelationship {
  sponsor_org_id: string;
  site_org_id: string;
  granted_at: string;
  granted_by: string | null;
}

// =============================================================================
// SponsorPortfolioEntry — one row per protocol the caller's sponsor-org
// has a sponsor_relationships row for. Mirrors the row shape returned by
// the `list_my_sponsor_portfolio` RPC.
// =============================================================================
export interface SponsorPortfolioEntry {
  protocolId: string;
  protocolCode: string | null;
  protocolTitle: string;
  siteOrgId: string;
  siteOrgName: string;
  participantCount: number;
  lastVisitAt: string | null; // ISO date (YYYY-MM-DD) or null when no visits yet
}
