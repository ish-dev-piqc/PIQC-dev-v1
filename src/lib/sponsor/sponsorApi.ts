import { supabase } from '../supabase';
import type {
  SponsorPortfolioEntry,
  SponsorProtocolDetail,
} from '../../types/sponsor';
import {
  adaptSponsorPortfolio,
  adaptSponsorProtocolDetail,
  type SponsorPortfolioRow,
} from './sponsorAdapter';

// =============================================================================
// sponsorApi — Sponsor Mode data layer. Wraps the `list_my_sponsor_portfolio`
// RPC and returns Result<T> per CLAUDE.md API-layer convention. Adapter
// is invoked here (not in the component) so the UI only ever sees camelCase
// TS.
// =============================================================================

type Result<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };

function fail(label: string, error: { message?: string } | null | undefined): Result<never> {
  return {
    ok: false,
    error: `${label}: ${error?.message ?? 'Unknown error'}`,
  };
}

export async function listMySponsorPortfolio(): Promise<Result<SponsorPortfolioEntry[]>> {
  const { data, error } = await supabase.rpc('list_my_sponsor_portfolio');
  if (error) return fail('listMySponsorPortfolio', error);
  const rows = (data ?? []) as SponsorPortfolioRow[];
  return { ok: true, data: adaptSponsorPortfolio(rows) };
}

export async function getSponsorProtocolDetail(
  protocolId: string,
): Promise<Result<SponsorProtocolDetail>> {
  const { data, error } = await supabase.rpc('get_sponsor_protocol_detail', {
    p_protocol_id: protocolId,
  });
  if (error) return fail('getSponsorProtocolDetail', error);
  return { ok: true, data: adaptSponsorProtocolDetail(data) };
}
