// siteModulesApi — the client side of site_module_mapping_objects.
// Pins: the read's query shape and its three outcomes (rows / not applied /
// error), and the two RPC call shapes with their Result mapping. Mock idiom:
// isaFindingsApi.test.ts (supabase.from / supabase.rpc as vi.fn).

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { SiteModuleMapping } from '../../../types/audit';

vi.mock('../../supabase', () => ({
  supabase: {
    rpc: vi.fn(),
    from: vi.fn(),
  },
}));

import { supabase } from '../../supabase';
import {
  createSiteModuleMapping,
  deleteSiteModuleMapping,
  fetchSiteModuleMappings,
} from '../siteModulesApi';

const rpcMock = vi.mocked(supabase.rpc);
const fromMock = vi.mocked(supabase.from);

const MAPPING: SiteModuleMapping = {
  id: 'smm-1',
  audit_id: 'audit-isa-1',
  protocol_risk_id: 'risk-1',
  isa_domain: 'INFORMED_CONSENT',
  derived_criticality: 'CRITICAL',
  criticality_rationale: 'Derived from: primary endpoint, data integrity impact.',
  created_at: '2026-09-05T00:00:00Z',
  updated_at: '2026-09-05T00:00:00Z',
};

// The read chain: from → select → eq → order, resolving to the given result.
function stubRead(result: { data: unknown; error: unknown }) {
  const order = vi.fn().mockResolvedValue(result);
  const eq = vi.fn().mockReturnValue({ order });
  const select = vi.fn().mockReturnValue({ eq });
  fromMock.mockReturnValue({ select } as unknown as ReturnType<typeof supabase.from>);
  return { select, eq, order };
}

beforeEach(() => {
  rpcMock.mockReset();
  fromMock.mockReset();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('fetchSiteModuleMappings', () => {
  it('reads the audit’s rows oldest-first and reports them as available', async () => {
    const chain = stubRead({ data: [MAPPING], error: null });

    const result = await fetchSiteModuleMappings('audit-isa-1');

    expect(fromMock).toHaveBeenCalledWith('site_module_mapping_objects');
    expect(chain.select).toHaveBeenCalledWith('*');
    expect(chain.eq).toHaveBeenCalledWith('audit_id', 'audit-isa-1');
    expect(chain.order).toHaveBeenCalledWith('created_at', { ascending: true });
    expect(result).toEqual({ ok: true, data: { available: true, mappings: [MAPPING] } });
  });

  it('a missing table (schema not applied yet) is available:false, not an error', async () => {
    stubRead({
      data: null,
      error: { code: 'PGRST205', message: "Could not find the table 'public.site_module_mapping_objects' in the schema cache" },
    });

    const result = await fetchSiteModuleMappings('audit-isa-1');

    expect(result).toEqual({ ok: true, data: { available: false } });
  });

  it('the older undefined-table code is treated the same way', async () => {
    stubRead({ data: null, error: { code: '42P01', message: 'relation does not exist' } });

    const result = await fetchSiteModuleMappings('audit-isa-1');

    expect(result).toEqual({ ok: true, data: { available: false } });
  });

  it('any other read error is ok:false with the message', async () => {
    stubRead({ data: null, error: { code: '42501', message: 'permission denied' } });

    const result = await fetchSiteModuleMappings('audit-isa-1');

    expect(result).toEqual({ ok: false, error: 'permission denied' });
  });

  it('an empty table is available with no mappings', async () => {
    stubRead({ data: [], error: null });

    const result = await fetchSiteModuleMappings('audit-isa-1');

    expect(result).toEqual({ ok: true, data: { available: true, mappings: [] } });
  });
});

describe('createSiteModuleMapping', () => {
  it('calls the create RPC with the audit, the risk and the module, and returns the row', async () => {
    rpcMock.mockResolvedValueOnce({ data: MAPPING, error: null } as never);

    const result = await createSiteModuleMapping('audit-isa-1', 'risk-1', 'INFORMED_CONSENT');

    expect(rpcMock).toHaveBeenCalledWith('audit_mode_create_site_module_mapping', {
      p_audit_id: 'audit-isa-1',
      p_protocol_risk_id: 'risk-1',
      p_isa_domain: 'INFORMED_CONSENT',
    });
    expect(result).toEqual({ ok: true, data: MAPPING });
  });

  it('a server rejection (e.g. the integrity guards) is ok:false with the message', async () => {
    rpcMock.mockResolvedValueOnce({
      data: null,
      error: { message: 'Protocol risk risk-9 is not on this audit’s protocol version', hint: 'RISK_NOT_ON_AUDIT_PROTOCOL' },
    } as never);

    const result = await createSiteModuleMapping('audit-isa-1', 'risk-9', 'IRB_EC');

    expect(result).toEqual({ ok: false, error: 'Protocol risk risk-9 is not on this audit’s protocol version' });
  });
});

describe('deleteSiteModuleMapping', () => {
  it('calls the delete RPC and maps the boolean back', async () => {
    rpcMock.mockResolvedValueOnce({ data: true, error: null } as never);

    const result = await deleteSiteModuleMapping('smm-1');

    expect(rpcMock).toHaveBeenCalledWith('audit_mode_delete_site_module_mapping', {
      p_id: 'smm-1',
      p_reason: null,
    });
    expect(result).toEqual({ ok: true, data: true });
  });

  it('forwards a reason and reports a missing row as data:false', async () => {
    rpcMock.mockResolvedValueOnce({ data: false, error: null } as never);

    const result = await deleteSiteModuleMapping('smm-gone', 'Module no longer in scope');

    expect(rpcMock).toHaveBeenCalledWith('audit_mode_delete_site_module_mapping', {
      p_id: 'smm-gone',
      p_reason: 'Module no longer in scope',
    });
    expect(result).toEqual({ ok: true, data: false });
  });

  it('an RPC error is ok:false', async () => {
    rpcMock.mockResolvedValueOnce({ data: null, error: { message: 'Not authenticated' } } as never);

    const result = await deleteSiteModuleMapping('smm-1');

    expect(result).toEqual({ ok: false, error: 'Not authenticated' });
  });
});
