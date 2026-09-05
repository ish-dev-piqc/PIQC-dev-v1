// SiteModuleMappingPanel — ISA Stage 2 risk → module mapping. Pins the
// panel's states (loading / not applied / read error + Retry / no tagged
// risks / list), the add and remove paths through siteModulesApi, the
// picker excluding already-mapped modules, the save-error alert, and the
// read-only preview. Mock idiom: StageTransitionCard.test.tsx (context
// hooks with mutable module-level state) + isaFindingsApi mocked as a module.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { TaggedSection } from '../../../../../lib/audit/mockProtocolRisks';
import type { SiteModuleMapping } from '../../../../../types/audit';

vi.mock('../../../../../context/ThemeContext', () => ({
  useTheme: () => ({ theme: 'light' as const, toggleTheme: () => {} }),
}));

let mockActiveAudit: { id: string; workflow_type: string; current_stage: string } | null = null;
vi.mock('../../../../../context/AuditContext', () => ({
  useAudit: () => ({ activeAudit: mockActiveAudit }),
}));

let mockProtocolRisks: Record<string, TaggedSection[]> = {};
vi.mock('../../../../../context/AuditDataContext', () => ({
  useAuditData: () => ({ protocolRisks: mockProtocolRisks, setProtocolRisks: vi.fn() }),
}));

vi.mock('../../../../../lib/audit/siteModulesApi', () => ({
  fetchSiteModuleMappings: vi.fn(),
  createSiteModuleMapping: vi.fn(),
  deleteSiteModuleMapping: vi.fn(),
}));

import SiteModuleMappingPanel from '../investigator/SiteModuleMappingPanel';
import {
  createSiteModuleMapping,
  deleteSiteModuleMapping,
  fetchSiteModuleMappings,
} from '../../../../../lib/audit/siteModulesApi';

const mockFetch = vi.mocked(fetchSiteModuleMappings);
const mockCreate = vi.mocked(createSiteModuleMapping);
const mockDelete = vi.mocked(deleteSiteModuleMapping);

function risk(patch: Partial<TaggedSection> & Pick<TaggedSection, 'id'>): TaggedSection {
  return {
    section_identifier: '§5.1',
    section_title: 'Primary endpoint: overall survival',
    endpoint_tier: 'PRIMARY',
    impact_surface: 'DATA_INTEGRITY',
    time_sensitivity: false,
    vendor_dependency_flags: [],
    operational_domain_tag: null,
    tagging_mode: 'MANUAL',
    version_change_type: 'ADDED',
    source_extracted_item_id: null,
    ...patch,
  };
}

function mapping(patch: Partial<SiteModuleMapping> & Pick<SiteModuleMapping, 'id'>): SiteModuleMapping {
  return {
    audit_id: 'audit-isa-1',
    protocol_risk_id: 'risk-1',
    isa_domain: 'INFORMED_CONSENT',
    derived_criticality: 'CRITICAL',
    criticality_rationale: 'Derived from: primary endpoint, data integrity impact.',
    created_at: '2026-09-05T00:00:00Z',
    updated_at: '2026-09-05T00:00:00Z',
    ...patch,
  };
}

const RISK_1 = risk({ id: 'risk-1' });
const RISK_2 = risk({ id: 'risk-2', section_identifier: '§4.2', section_title: 'Eligibility: age', endpoint_tier: 'SAFETY', impact_surface: 'BOTH' });

beforeEach(() => {
  vi.clearAllMocks();
  mockActiveAudit = { id: 'audit-isa-1', workflow_type: 'INVESTIGATOR_SITE_AUDIT', current_stage: 'ISA_RISK_ASSESSMENT' };
  mockProtocolRisks = { 'audit-isa-1': [RISK_1, RISK_2] };
  mockFetch.mockResolvedValue({ ok: true, data: { available: true, mappings: [] } });
});

describe('SiteModuleMappingPanel — states', () => {
  it('shows the header and a loading line, then the tagged risks with the picker once loaded', async () => {
    render(<SiteModuleMappingPanel readOnly={false} />);

    expect(screen.getByText('Site modules')).toBeInTheDocument();
    expect(screen.getByText('Map tagged risks to site audit modules')).toBeInTheDocument();
    expect(screen.getByText('Loading module mappings…')).toBeInTheDocument();

    expect(await screen.findByText('0 mappings across 0 modules')).toBeInTheDocument();
    expect(mockFetch).toHaveBeenCalledWith('audit-isa-1');
    expect(screen.getByText('§5.1')).toBeInTheDocument();
    expect(screen.getByText('Primary endpoint: overall survival')).toBeInTheDocument();
    expect(screen.getAllByText('Not mapped to a module yet.')).toHaveLength(2);
    expect(screen.getByRole('combobox', { name: 'Map §5.1 to a module' })).toBeEnabled();
    expect(screen.getByRole('combobox', { name: 'Map §4.2 to a module' })).toBeEnabled();
  });

  it('schema not applied: says so and offers nothing', async () => {
    mockFetch.mockResolvedValue({ ok: true, data: { available: false } });

    render(<SiteModuleMappingPanel readOnly={false} />);

    expect(await screen.findByText('Site modules aren’t available in this environment yet.')).toBeInTheDocument();
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    expect(screen.queryByText('§5.1')).not.toBeInTheDocument();
  });

  it('read error: alert with the message, Retry refetches', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, error: 'permission denied' });

    render(<SiteModuleMappingPanel readOnly={false} />);

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/load module mappings: permission denied/);

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('0 mappings across 0 modules')).toBeInTheDocument();
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('no tagged risks: points at the tagging flow above', async () => {
    mockProtocolRisks = { 'audit-isa-1': [] };

    render(<SiteModuleMappingPanel readOnly={false} />);

    expect(await screen.findByText('Tag a protocol section above to map it to a site module.')).toBeInTheDocument();
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  });

  it('renders nothing without an active audit and never fetches', () => {
    mockActiveAudit = null;

    const { container } = render(<SiteModuleMappingPanel readOnly={false} />);

    expect(container).toBeEmptyDOMElement();
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

describe('SiteModuleMappingPanel — mappings', () => {
  it('lists each risk’s modules with the derived criticality and rationale, and counts them', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      data: {
        available: true,
        mappings: [
          mapping({ id: 'smm-1' }),
          mapping({ id: 'smm-2', isa_domain: 'SOURCE_DATA_VERIFICATION' }),
          mapping({ id: 'smm-3', protocol_risk_id: 'risk-2', isa_domain: 'INFORMED_CONSENT', derived_criticality: 'HIGH', criticality_rationale: 'Derived from: safety endpoint, both impact.' }),
        ],
      },
    });

    render(<SiteModuleMappingPanel readOnly={false} />);

    expect(await screen.findByText('3 mappings across 2 modules')).toBeInTheDocument();
    // Module labels also appear as <option> text in the other risk's picker,
    // so the rows are asserted through the list items and the remove buttons.
    const rows = screen.getAllByRole('listitem');
    expect(rows).toHaveLength(3);
    expect(rows[0]).toHaveTextContent(/Informed consent.*Critical.*primary endpoint, data integrity impact/);
    expect(rows[1]).toHaveTextContent(/Source data verification.*Critical/);
    expect(rows[2]).toHaveTextContent(/Informed consent.*High.*safety endpoint, both impact/);
    expect(screen.getByRole('button', { name: 'Remove Source data verification from §5.1' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remove Informed consent from §4.2' })).toBeInTheDocument();
  });

  it('the picker excludes modules the risk is already mapped to', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      data: { available: true, mappings: [mapping({ id: 'smm-1' })] },
    });

    render(<SiteModuleMappingPanel readOnly={false} />);
    await screen.findByText('1 mapping across 1 module');

    const picker = screen.getByRole('combobox', { name: 'Map §5.1 to a module' });
    const options = Array.from(picker.querySelectorAll('option')).map((o) => o.textContent);
    expect(options).toContain('Add module…');
    expect(options).not.toContain('Informed consent');
    expect(options).toContain('Source data verification');
    expect(options).toHaveLength(15); // placeholder + 14 remaining domains

    const other = screen.getByRole('combobox', { name: 'Map §4.2 to a module' });
    expect(Array.from(other.querySelectorAll('option')).map((o) => o.textContent)).toContain('Informed consent');
  });

  it('picking a module creates the mapping and the row appears', async () => {
    mockCreate.mockResolvedValue({ ok: true, data: mapping({ id: 'smm-new', isa_domain: 'IRB_EC', derived_criticality: 'CRITICAL' }) });

    render(<SiteModuleMappingPanel readOnly={false} />);
    await screen.findByText('0 mappings across 0 modules');

    fireEvent.change(screen.getByRole('combobox', { name: 'Map §5.1 to a module' }), {
      target: { value: 'IRB_EC' },
    });

    await waitFor(() => expect(mockCreate).toHaveBeenCalledTimes(1));
    expect(mockCreate).toHaveBeenCalledWith('audit-isa-1', 'risk-1', 'IRB_EC');
    expect(await screen.findByRole('button', { name: 'Remove IRB / EC from §5.1' })).toBeInTheDocument();
    expect(screen.getByText('1 mapping across 1 module')).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(1);
    expect(screen.getByRole('listitem')).toHaveTextContent(/IRB \/ EC.*Critical/);
    // The picker for that risk no longer offers the module it now carries.
    const picker = screen.getByRole('combobox', { name: 'Map §5.1 to a module' });
    expect(Array.from(picker.querySelectorAll('option')).map((o) => o.textContent)).not.toContain('IRB / EC');
  });

  it('a rejected create shows the server message and adds nothing', async () => {
    mockCreate.mockResolvedValue({ ok: false, error: 'Protocol risk risk-1 is not on this audit’s protocol version' });

    render(<SiteModuleMappingPanel readOnly={false} />);
    await screen.findByText('0 mappings across 0 modules');

    fireEvent.change(screen.getByRole('combobox', { name: 'Map §5.1 to a module' }), {
      target: { value: 'IRB_EC' },
    });

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/update the module mapping: Protocol risk risk-1 is not on this audit’s protocol version/);
    expect(screen.getByText('0 mappings across 0 modules')).toBeInTheDocument();
  });

  it('removing a mapping calls the delete RPC and drops the row', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      data: { available: true, mappings: [mapping({ id: 'smm-1' })] },
    });
    mockDelete.mockResolvedValue({ ok: true, data: true });

    render(<SiteModuleMappingPanel readOnly={false} />);
    await screen.findByText('1 mapping across 1 module');

    fireEvent.click(screen.getByRole('button', { name: 'Remove Informed consent from §5.1' }));

    await waitFor(() => expect(mockDelete).toHaveBeenCalledWith('smm-1'));
    expect(await screen.findByText('0 mappings across 0 modules')).toBeInTheDocument();
    expect(screen.queryByRole('listitem')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Remove / })).not.toBeInTheDocument();
    expect(screen.getAllByText('Not mapped to a module yet.')).toHaveLength(2);
  });
});

describe('SiteModuleMappingPanel — read-only preview', () => {
  it('shows the mappings but no picker and no remove buttons', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      data: { available: true, mappings: [mapping({ id: 'smm-1' })] },
    });

    render(<SiteModuleMappingPanel readOnly />);

    expect(await screen.findByText('1 mapping across 1 module')).toBeInTheDocument();
    expect(screen.getByText('Informed consent')).toBeInTheDocument();
    expect(screen.getByText('No modules mapped.')).toBeInTheDocument();
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Remove / })).not.toBeInTheDocument();
  });
});
