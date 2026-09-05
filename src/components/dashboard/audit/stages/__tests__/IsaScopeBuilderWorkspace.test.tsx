// IsaScopeBuilderWorkspace — ISA Stage 3, the risk-based scope. Pins:
//   - the load states: loading, not applied (either table), read error +
//     Retry, a mapping whose risk did not load (never a partial scope)
//   - no mappings → the pointer to Risk assessment, no Build
//   - Build → the generic upsert receives the deterministic content and the
//     modules render with their rollup and traced items
//   - tagged risks come from the store, or the fallback read when empty
//   - Approve → the updated_at pin, then the approved line
//   - drift by mapping set → notice + Rebuild (with the demote warning when
//     approved); the rebuild reason names the rebuild
//   - the one-ahead preview: notice, scope visible, no actions
//   - a failed save: honest banner, cache reverted, Approve absent
//   - a STALE_CONTENT approve reloads server truth and says so
// Mock idiom: IsaRiskAssessmentWorkspace.test.tsx (context hooks with
// mutable module-level state; every Api module mocked).

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { TaggedSection } from '../../../../../lib/audit/mockProtocolRisks';
import type { SiteModuleMapping } from '../../../../../types/audit';
import type { SiteScope } from '../../../../../lib/audit/siteScopeApi';
import { buildSiteScopeContent } from '../../../../../lib/audit/siteScope';

vi.mock('../../../../../context/ThemeContext', () => ({
  useTheme: () => ({ theme: 'light' as const, toggleTheme: () => {} }),
}));

const mockAdvanceStage = vi.fn();
let mockCurrentStage = 'ISA_SCOPE_BUILDER';
vi.mock('../../../../../context/AuditContext', () => ({
  useAudit: () => ({
    activeAudit: {
      id: 'audit-isa-1',
      workflow_type: 'INVESTIGATOR_SITE_AUDIT',
      current_stage: mockCurrentStage,
      protocol_id: 'protocol-1',
      protocol_version_id: 'pv-1',
      protocol_code: 'PROTO-001',
      protocol_title: 'Protocol one',
      auditee_name: 'Site 042',
    },
    advanceStage: mockAdvanceStage,
    advanceStageError: null,
  }),
}));

let mockProtocolRisks: Record<string, TaggedSection[]> = {};
vi.mock('../../../../../context/AuditDataContext', () => ({
  useAuditData: () => ({ protocolRisks: mockProtocolRisks, setProtocolRisks: vi.fn() }),
}));

vi.mock('../../../../../lib/audit/intakeApi', () => ({
  fetchProtocolRisksForAudit: vi.fn(),
}));
vi.mock('../../../../../lib/audit/siteModulesApi', () => ({
  fetchSiteModuleMappings: vi.fn(),
}));
vi.mock('../../../../../lib/audit/siteScopeApi', () => ({
  fetchSiteScope: vi.fn(),
  upsertSiteScope: vi.fn(),
  approveSiteScope: vi.fn(),
}));
vi.mock('../../HistoryDrawer', () => ({ default: () => null }));

import IsaScopeBuilderWorkspace from '../investigator/IsaScopeBuilderWorkspace';
import { fetchProtocolRisksForAudit } from '../../../../../lib/audit/intakeApi';
import { fetchSiteModuleMappings } from '../../../../../lib/audit/siteModulesApi';
import { approveSiteScope, fetchSiteScope, upsertSiteScope } from '../../../../../lib/audit/siteScopeApi';

const mockFetchRisks = vi.mocked(fetchProtocolRisksForAudit);
const mockFetchMappings = vi.mocked(fetchSiteModuleMappings);
const mockFetchScope = vi.mocked(fetchSiteScope);
const mockUpsert = vi.mocked(upsertSiteScope);
const mockApprove = vi.mocked(approveSiteScope);

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
const RISK_2 = risk({
  id: 'risk-2',
  section_identifier: '§4.2',
  section_title: 'Eligibility: age',
  endpoint_tier: 'SAFETY',
  impact_surface: 'BOTH',
});
const MAPPINGS = [
  mapping({ id: 'smm-1' }),
  mapping({ id: 'smm-2', isa_domain: 'SOURCE_DATA_VERIFICATION' }),
  mapping({
    id: 'smm-3',
    protocol_risk_id: 'risk-2',
    derived_criticality: 'HIGH',
    criticality_rationale: 'Derived from: safety endpoint, both impact.',
  }),
];
const BUILT_AT = '2026-09-05T10:00:00.000Z';
const SCOPE: SiteScope = {
  id: 'scope-1',
  audit_id: 'audit-isa-1',
  content: buildSiteScopeContent(MAPPINGS, [RISK_1, RISK_2], BUILT_AT),
  approval_status: 'DRAFT',
  approved_at: null,
  approved_by_name: null,
  updated_at: '2026-09-05T10:00:00+00:00',
};

beforeEach(() => {
  vi.clearAllMocks();
  mockCurrentStage = 'ISA_SCOPE_BUILDER';
  mockProtocolRisks = { 'audit-isa-1': [RISK_1, RISK_2] };
  mockFetchRisks.mockResolvedValue([]);
  mockFetchMappings.mockResolvedValue({ ok: true, data: { available: true, mappings: MAPPINGS } });
  mockFetchScope.mockResolvedValue({ kind: 'loaded', scope: null });
  // The server echoes the content it was given.
  mockUpsert.mockImplementation(async (_auditId, content) => ({ ...SCOPE, content }));
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('IsaScopeBuilderWorkspace — load states', () => {
  it('loads, then says the builder is not available when the mappings table is missing', async () => {
    mockFetchMappings.mockResolvedValue({ ok: true, data: { available: false } });
    render(<IsaScopeBuilderWorkspace />);

    expect(screen.getByText('Stage 3 · Scope builder')).toBeInTheDocument();
    expect(screen.getByText('Build the risk-based audit scope')).toBeInTheDocument();
    expect(screen.getByText('Loading the scope builder…')).toBeInTheDocument();

    expect(await screen.findByText('Scope builder isn’t available in this environment yet.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Build scope/ })).not.toBeInTheDocument();
  });

  it('says the same when the scope table is missing', async () => {
    mockFetchScope.mockResolvedValue({ kind: 'unavailable' });
    render(<IsaScopeBuilderWorkspace />);

    expect(await screen.findByText('Scope builder isn’t available in this environment yet.')).toBeInTheDocument();
  });

  it('a read error banners with Retry, and Retry refetches', async () => {
    const user = userEvent.setup();
    mockFetchMappings.mockResolvedValueOnce({ ok: false, error: 'permission denied' });
    render(<IsaScopeBuilderWorkspace />);

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Couldn’t load the scope builder: permission denied');

    await user.click(within(alert).getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText(/3 mappings across 2 modules are ready to scope/)).toBeInTheDocument();
    expect(mockFetchMappings).toHaveBeenCalledTimes(2);
  });

  it('a failed scope read is an error too — never an empty "build it" state over an unknown row', async () => {
    mockFetchScope.mockResolvedValue({ kind: 'failed' });
    render(<IsaScopeBuilderWorkspace />);

    expect(await screen.findByRole('alert')).toHaveTextContent('the saved scope could not be read');
    expect(screen.queryByRole('button', { name: /Build scope/ })).not.toBeInTheDocument();
  });

  it('a mapping whose risk did not load is a load failure, never a partial scope', async () => {
    mockProtocolRisks = { 'audit-isa-1': [RISK_1] };
    render(<IsaScopeBuilderWorkspace />);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'the tagged sections behind 1 mapping could not be read',
    );
    expect(screen.queryByRole('button', { name: /Build scope/ })).not.toBeInTheDocument();
  });

  it('no mappings and no scope → points at Risk assessment, no Build', async () => {
    mockFetchMappings.mockResolvedValue({ ok: true, data: { available: true, mappings: [] } });
    render(<IsaScopeBuilderWorkspace />);

    expect(
      await screen.findByText('No module mappings yet. Map tagged sections to site modules on Risk assessment first.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Build scope/ })).not.toBeInTheDocument();
  });

  it('reads tagged risks through the fallback when the store is empty', async () => {
    mockProtocolRisks = {};
    mockFetchRisks.mockResolvedValue([RISK_1, RISK_2]);
    render(<IsaScopeBuilderWorkspace />);

    expect(await screen.findByText(/3 mappings across 2 modules are ready to scope/)).toBeInTheDocument();
    expect(mockFetchRisks).toHaveBeenCalledWith('audit-isa-1');
  });
});

describe('IsaScopeBuilderWorkspace — build', () => {
  it('Build sends the deterministic content through the generic upsert and renders the modules', async () => {
    const user = userEvent.setup();
    render(<IsaScopeBuilderWorkspace />);

    await user.click(await screen.findByRole('button', { name: 'Build scope' }));

    await waitFor(() => expect(mockUpsert).toHaveBeenCalledTimes(1));
    const [auditId, content, reason] = mockUpsert.mock.calls[0];
    expect(auditId).toBe('audit-isa-1');
    expect(reason).toBe('Site audit scope built from 3 module mappings');
    expect(content.built_from.mapping_ids).toEqual(['smm-1', 'smm-2', 'smm-3']);
    expect(content.modules.map((m) => [m.isa_domain, m.criticality, m.items.map((i) => i.id)])).toEqual([
      ['INFORMED_CONSENT', 'CRITICAL', ['smm-1', 'smm-3']],
      ['SOURCE_DATA_VERIFICATION', 'CRITICAL', ['smm-2']],
    ]);
    expect(mockFetchRisks).not.toHaveBeenCalled();

    // The document: module headers with rollup, items tracing to sections.
    expect(await screen.findByText(/2 modules · 3 scope items · built/)).toBeInTheDocument();
    expect(screen.getByText('Informed consent')).toBeInTheDocument();
    expect(screen.getByText('Source data verification')).toBeInTheDocument();
    expect(screen.getAllByText('Primary endpoint: overall survival')).toHaveLength(2);
    expect(screen.getByText('Eligibility: age')).toBeInTheDocument();
    expect(screen.getByText('Derived from: safety endpoint, both impact.')).toBeInTheDocument();
    expect(screen.getByText('Draft')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Approve scope' })).toBeEnabled();
    expect(screen.queryByText(/since this scope was built/)).not.toBeInTheDocument();
  });

  it('a failed save banners honestly and reverts — no scope shown, no Approve', async () => {
    const user = userEvent.setup();
    mockUpsert.mockResolvedValue(null);
    render(<IsaScopeBuilderWorkspace />);

    await user.click(await screen.findByRole('button', { name: 'Build scope' }));

    expect(
      await screen.findByText('Couldn’t save the scope — nothing was recorded. Build again to retry.'),
    ).toBeInTheDocument();
    expect(screen.getByText(/3 mappings across 2 modules are ready to scope/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Approve scope' })).not.toBeInTheDocument();
    expect(screen.queryByText('Informed consent')).not.toBeInTheDocument();
  });
});

describe('IsaScopeBuilderWorkspace — approve and drift', () => {
  it('Approve pins the version the reviewer saw, then shows the approved line', async () => {
    const user = userEvent.setup();
    mockFetchScope.mockResolvedValue({ kind: 'loaded', scope: SCOPE });
    mockApprove.mockResolvedValue({
      ok: true,
      data: {
        ...SCOPE,
        approval_status: 'APPROVED',
        approved_at: '2026-09-05T11:00:00+00:00',
        approved_by_name: 'Ada Auditor',
        updated_at: '2026-09-05T11:00:00+00:00',
      },
    });
    render(<IsaScopeBuilderWorkspace />);

    await user.click(await screen.findByRole('button', { name: 'Approve scope' }));

    await waitFor(() => expect(mockApprove).toHaveBeenCalledWith('scope-1', '2026-09-05T10:00:00+00:00'));
    expect(await screen.findByText(/Approved .* · Ada Auditor/)).toBeInTheDocument();
    expect(screen.getByText('Approved')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Approve scope' })).not.toBeInTheDocument();
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it('mappings changed since the build → drift notice, Rebuild sends the new content with the rebuild reason', async () => {
    const user = userEvent.setup();
    mockFetchScope.mockResolvedValue({ kind: 'loaded', scope: SCOPE });
    const live = [...MAPPINGS.slice(0, 2), mapping({ id: 'smm-4', isa_domain: 'IRB_EC', protocol_risk_id: 'risk-2', derived_criticality: 'HIGH' })];
    mockFetchMappings.mockResolvedValue({ ok: true, data: { available: true, mappings: live } });
    render(<IsaScopeBuilderWorkspace />);

    const notice = await screen.findByText(/1 mapping added and 1 removed on Risk assessment since this scope was built/);
    expect(notice.closest('p')).toHaveTextContent(/Rebuild to bring the scope up to date\.$/);

    await user.click(screen.getByRole('button', { name: 'Rebuild scope' }));

    await waitFor(() => expect(mockUpsert).toHaveBeenCalledTimes(1));
    const [, content, reason] = mockUpsert.mock.calls[0];
    expect(reason).toBe('Site audit scope rebuilt from 3 module mappings');
    expect(content.built_from.mapping_ids).toEqual(['smm-1', 'smm-2', 'smm-4']);
    expect(await screen.findByText('IRB / EC')).toBeInTheDocument();
    expect(screen.queryByText(/since this scope was built/)).not.toBeInTheDocument();
  });

  it('an approved scope with drift says the rebuild reverts approval', async () => {
    mockFetchScope.mockResolvedValue({
      kind: 'loaded',
      scope: { ...SCOPE, approval_status: 'APPROVED', approved_at: '2026-09-05T11:00:00+00:00' },
    });
    mockFetchMappings.mockResolvedValue({ ok: true, data: { available: true, mappings: MAPPINGS.slice(0, 2) } });
    render(<IsaScopeBuilderWorkspace />);

    expect((await screen.findByText(/0 mappings added and 1 removed/)).closest('p')).toHaveTextContent(
      'rebuilding reverts approval to Draft',
    );
    expect(screen.getByRole('button', { name: 'Rebuild scope' })).toBeEnabled();
  });

  it('a STALE_CONTENT approve reloads server truth and says so', async () => {
    const user = userEvent.setup();
    mockFetchScope.mockResolvedValue({ kind: 'loaded', scope: SCOPE });
    mockApprove.mockResolvedValue({ ok: false, error: 'changed', errorHint: 'STALE_CONTENT' });
    render(<IsaScopeBuilderWorkspace />);

    await user.click(await screen.findByRole('button', { name: 'Approve scope' }));

    expect(
      await screen.findByText(/This deliverable changed since you reviewed it — the latest version is shown/),
    ).toBeInTheDocument();
    expect(mockFetchScope).toHaveBeenCalledTimes(2);
    expect(screen.getByRole('button', { name: 'Approve scope' })).toBeEnabled();
  });
});

describe('IsaScopeBuilderWorkspace — one-ahead preview', () => {
  it('at Risk assessment: notice up, an existing scope visible, no Build / Rebuild / Approve', async () => {
    mockCurrentStage = 'ISA_RISK_ASSESSMENT';
    mockFetchScope.mockResolvedValue({ kind: 'loaded', scope: SCOPE });
    mockFetchMappings.mockResolvedValue({ ok: true, data: { available: true, mappings: MAPPINGS.slice(0, 2) } });
    render(<IsaScopeBuilderWorkspace />);

    // Two elements name the audit's real stage here: the preview notice and
    // the Stage 3 → Audit prep card's ahead line. A bare /advance from Risk
    // assessment/ matches both, so each is matched on its own copy.
    expect(
      screen.getByText(/this is a preview\. Actions here are disabled until you advance from Risk assessment\./i),
    ).toBeInTheDocument();
    expect(screen.getByText('Advance from Risk assessment first.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Advance to Audit prep' })).toBeDisabled();

    expect(await screen.findByText('Informed consent')).toBeInTheDocument();
    expect(screen.getByText(/0 mappings added and 1 removed/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Rebuild scope/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Approve scope' })).not.toBeInTheDocument();
  });

  it('at Risk assessment with no scope: the ready line shows without a Build button', async () => {
    mockCurrentStage = 'ISA_RISK_ASSESSMENT';
    render(<IsaScopeBuilderWorkspace />);

    expect(await screen.findByText(/3 mappings across 2 modules are ready to scope/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Build scope' })).not.toBeInTheDocument();
  });
});

// isa-placeholder-advance: Stage 3 carries the shared StageTransitionCard
// toward Audit prep. The card's own states are pinned in
// StageTransitionCard.test.tsx; here: the mount, the target stage, and that
// the transition does not depend on the scope (no content gate server-side).
describe('IsaScopeBuilderWorkspace — Stage 3 → Audit prep card (isa-placeholder-advance)', () => {
  it('at the stage: "Advance to Audit prep" is enabled and advances to ISA_PREP', async () => {
    const user = userEvent.setup();
    render(<IsaScopeBuilderWorkspace />);

    expect(await screen.findByRole('button', { name: 'Build scope' })).toBeInTheDocument();
    const button = screen.getByRole('button', { name: 'Advance to Audit prep' });
    expect(button).toBeEnabled();
    await user.click(button);
    expect(mockAdvanceStage).toHaveBeenCalledTimes(1);
    expect(mockAdvanceStage).toHaveBeenCalledWith('ISA_PREP');
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it('is offered even when the builder is not available — the transition has no content gate', async () => {
    mockFetchMappings.mockResolvedValue({ ok: true, data: { available: false } });
    render(<IsaScopeBuilderWorkspace />);

    expect(
      await screen.findByText('Scope builder isn’t available in this environment yet.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Advance to Audit prep' })).toBeEnabled();
  });
});
