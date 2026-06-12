import { supabase } from '../supabase';
import type { OrgEvent } from '../../types/orgs';
import type { Result } from './orgsApi';
import { adaptOrgEvent } from './orgEventsAdapter';

// =============================================================================
// orgEventsApi — read-only listing of org activity events.
//
// Writes are exclusively trigger-driven (see migration); no insert / update
// / delete surface exposed here. Reads paginate by created_at desc with a
// cursor so the UI can append "load more" without page numbers.
// =============================================================================

export interface ListOrgEventsParams {
  /** Page size — defaults to 50. */
  limit?: number;
  /** Cursor: only return events strictly older than this ISO timestamp. */
  before?: string;
}

export async function listOrgEvents(
  orgId: string,
  params: ListOrgEventsParams = {},
): Promise<Result<OrgEvent[]>> {
  const limit = params.limit ?? 50;
  let q = supabase
    .from('org_events')
    .select(
      'id, org_id, event_type, actor_user_id, target_user_id, target_protocol_id, payload, created_at',
    )
    .eq('org_id', orgId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (params.before) q = q.lt('created_at', params.before);

  const { data, error } = await q;
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: (data ?? []).map(adaptOrgEvent) };
}
