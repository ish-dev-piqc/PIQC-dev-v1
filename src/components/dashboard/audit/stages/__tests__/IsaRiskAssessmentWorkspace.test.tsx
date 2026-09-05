// IsaRiskAssessmentWorkspace — ISA Stage 2, the protocol-risk flow on the
// site workflow.
//
// The rules and the panel are pinned in their own tests; here we lock what
// makes the SITE variant of the shared flow different, through the real
// ProtocolRiskTagging + RiskTaggingForm + RiskCandidatesPanel:
//   - no parse-status card (Stage 1 owns it), criteria among the candidates;
//   - the form hides the vendor axis and saves a null domain, no flags;
//   - accepting a criterion candidate prefills the form and saves through the
//     candidate RPC with the same null domain.
//
// Since isa-stage-advance the stage is gated: the audit's current_stage is
// mutable per test (`mockCurrentStage`) — the tagging flows run at the
// reached stage, and the last describe pins the one-ahead preview.
//
// Mock idiom: IsaConductWorkspace.test.tsx (context hooks + Api modules
// mocked). AuditDataContext is a real useState behind the hook so the list
// re-renders when the flow writes to the shared store. Every module that
// reaches src/lib/supabase is mocked — the client throws on import without
// env.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { CandidateSourceItem } from '../../../../../lib/audit/riskCandidates';
import type { TaggedSection } from '../../../../../lib/audit/mockProtocolRisks';
import { OPERATIONAL_DOMAIN_OPTIONS } from '../../../../../lib/audit/labels';

vi.mock('../../../../../context/ThemeContext', () => ({
  useTheme: () => ({ theme: 'light' as const, toggleTheme: () => {} }),
}));

let mockCurrentStage = 'ISA_RISK_ASSESSMENT';
const { mockAdvanceStage } = vi.hoisted(() => ({ mockAdvanceStage: vi.fn() }));
vi.mock('../../../../../context/AuditContext', () => ({
  useAudit: () => ({
    advanceStage: mockAdvanceStage,
    advanceStageError: null,
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
  }),
}));

vi.mock('../../../../../context/AuditDataContext', async () => {
  const { useState } = await import('react');
  return {
    useAuditData: () => {
      const [protocolRisks, setProtocolRisks] = useState<Record<string, TaggedSection[]>>({});
      return { protocolRisks, setProtocolRisks };
    },
  };
});

vi.mock('../../../../../lib/audit/intakeApi', () => ({
  fetchProtocolRisksForAudit: vi.fn(),
  createProtocolRisk: vi.fn(),
  createProtocolRiskFromCandidate: vi.fn(),
  updateProtocolRisk: vi.fn(),
  deleteProtocolRisk: vi.fn(),
}));

vi.mock('../../../../../lib/audit/riskCandidatesApi', () => ({
  fetchCandidateSourceItems: vi.fn(),
}));

// The module-mapping panel's Api (isa-site-modules); its behaviour is pinned
// in SiteModuleMappingPanel.test.tsx — here only that it is mounted, and how
// it reads in the preview.
vi.mock('../../../../../lib/audit/siteModulesApi', () => ({
  fetchSiteModuleMappings: vi.fn(),
  createSiteModuleMapping: vi.fn(),
  deleteSiteModuleMapping: vi.fn(),
}));

// A string child, not JSX: the factory is hoisted above the jsx runtime import.
vi.mock('../ProtocolReadinessCard', () => ({
  default: () => 'readiness-card-marker',
}));
vi.mock('../../HistoryDrawer', () => ({ default: () => null }));
vi.mock('../../../../sotr/SourceTruthListDrawer', () => ({ default: () => null }));
vi.mock('../../../../sotr/SourceTruthDrawer', () => ({ default: () => null }));

import IsaRiskAssessmentWorkspace from '../investigator/IsaRiskAssessmentWorkspace';
import {
  createProtocolRisk,
  createProtocolRiskFromCandidate,
  fetchProtocolRisksForAudit,
} from '../../../../../lib/audit/intakeApi';
import { fetchCandidateSourceItems } from '../../../../../lib/audit/riskCandidatesApi';
import { fetchSiteModuleMappings } from '../../../../../lib/audit/siteModulesApi';

const mockFetchRisks = fetchProtocolRisksForAudit as unknown as ReturnType<typeof vi.fn>;
const mockCreate = createProtocolRisk as unknown as ReturnType<typeof vi.fn>;
const mockCreateFromCandidate = createProtocolRiskFromCandidate as unknown as ReturnType<typeof vi.fn>;
const mockFetchItems = fetchCandidateSourceItems as unknown as ReturnType<typeof vi.fn>;
const mockFetchMappings = vi.mocked(fetchSiteModuleMappings);

function item(
  overrides: Partial<CandidateSourceItem> &
    Pick<CandidateSourceItem, 'id' | 'field_type' | 'field_path'>,
): CandidateSourceItem {
  return {
    document_id: 'doc-1',
    extracted_value: null,
    confidence_state: 'high',
    review_status: 'draft',
    current_text: null,
    section_number: null,
    page_number: null,
    ...overrides,
  };
}

const ENDPOINT = item({
  id: 'item-1',
  field_type: 'endpoint',
  field_path: 'primary_endpoints[0]',
  extracted_value: 'Overall survival',
  section_number: '5.1',
});

const CRITERION = item({
  id: 'item-3',
  field_type: 'criterion',
  field_path: 'key_inclusion_criteria[0]',
  extracted_value: 'Age ≥ 18',
});

function savedRow(patch: Partial<TaggedSection>): TaggedSection {
  return {
    id: 'risk-1',
    section_identifier: '§4.2',
    section_title: 'Eligibility: age',
    endpoint_tier: 'SAFETY',
    impact_surface: 'BOTH',
    time_sensitivity: false,
    vendor_dependency_flags: [],
    operational_domain_tag: null,
    tagging_mode: 'MANUAL',
    version_change_type: 'ADDED',
    source_extracted_item_id: null,
    ...patch,
  };
}

beforeEach(() => {
  mockCurrentStage = 'ISA_RISK_ASSESSMENT';
  mockFetchRisks.mockReset();
  mockCreate.mockReset();
  mockCreateFromCandidate.mockReset();
  mockFetchItems.mockReset();
  mockFetchRisks.mockResolvedValue([]);
  mockFetchItems.mockResolvedValue({ ok: true, data: [ENDPOINT, CRITERION] });
  mockFetchMappings.mockReset();
  mockFetchMappings.mockResolvedValue({ ok: true, data: { available: true, mappings: [] } });
});

describe('IsaRiskAssessmentWorkspace — stage', () => {
  it('renders the site header, the candidates including criteria, and no parse-status card', async () => {
    render(<IsaRiskAssessmentWorkspace />);

    expect(screen.getByText('Stage 2 · Risk assessment')).toBeInTheDocument();
    expect(screen.getByText('Assess protocol risk for this site')).toBeInTheDocument();
    expect(screen.getByText(/carry risk at Site 042/)).toBeInTheDocument();
    // The stage ends with the shared transition card (isa-scope-builder).
    expect(screen.getByRole('button', { name: 'Advance to Scope builder' })).toBeEnabled();

    expect(await screen.findByText('2 suggestions')).toBeInTheDocument();
    expect(screen.getByText('Eligibility criteria')).toBeInTheDocument();
    expect(screen.getByText('Age ≥ 18')).toBeInTheDocument();
    expect(screen.queryByText('readiness-card-marker')).not.toBeInTheDocument();
    expect(screen.queryByText(/this is a preview/i)).not.toBeInTheDocument();
    expect(mockFetchRisks).toHaveBeenCalledWith('audit-isa-1');

    // The module-mapping panel sits under the flow and loads for this audit.
    expect(screen.getByText('Map tagged risks to site audit modules')).toBeInTheDocument();
    expect(mockFetchMappings).toHaveBeenCalledWith('audit-isa-1');
  });

  it('the transition card advances the audit to Scope builder', async () => {
    const user = userEvent.setup();
    render(<IsaRiskAssessmentWorkspace />);

    await user.click(screen.getByRole('button', { name: 'Advance to Scope builder' }));

    expect(mockAdvanceStage).toHaveBeenCalledWith('ISA_SCOPE_BUILDER');
  });
});

describe('IsaRiskAssessmentWorkspace — tagging without the vendor axis', () => {
  it('opens the form without domain or dependency flags and saves a null domain', async () => {
    const user = userEvent.setup();
    mockCreate.mockResolvedValue({ ok: true, data: savedRow({}) });
    render(<IsaRiskAssessmentWorkspace />);
    await screen.findByText('2 suggestions');

    await user.click(screen.getByRole('button', { name: 'Tag a section' }));

    expect(screen.getByText('Endpoint tier')).toBeInTheDocument();
    expect(screen.queryByText('Operational domain')).not.toBeInTheDocument();
    expect(screen.queryByText('Vendor dependency flags')).not.toBeInTheDocument();

    await user.type(screen.getByPlaceholderText('e.g. 5.3.2 or §7.1'), '§4.2');
    await user.type(screen.getByPlaceholderText('e.g. Central Laboratory Services'), 'Eligibility: age');
    await user.click(screen.getByRole('button', { name: 'Tag section' }));

    await waitFor(() => expect(mockCreate).toHaveBeenCalledTimes(1));
    expect(mockCreate).toHaveBeenCalledWith(
      'pv-1',
      expect.objectContaining({
        sectionIdentifier: '§4.2',
        sectionTitle: 'Eligibility: age',
        operationalDomainTag: null,
        vendorDependencyFlags: [],
        sourceExtractedItemId: null,
      }),
    );

    // Back on the list: the row shows tier and surface but no domain chip.
    expect(await screen.findByText('Eligibility: age')).toBeInTheDocument();
    expect(screen.getByText('Safety')).toBeInTheDocument();
    expect(screen.getByText('Both')).toBeInTheDocument();
    for (const opt of OPERATIONAL_DOMAIN_OPTIONS) {
      expect(screen.queryByText(opt.label)).not.toBeInTheDocument();
    }
  });

  it('accepting a criterion candidate prefills the form and saves through the candidate RPC', async () => {
    const user = userEvent.setup();
    mockCreateFromCandidate.mockResolvedValue({
      ok: true,
      data: savedRow({
        id: 'risk-2',
        section_identifier: 'key_inclusion_criteria[0]',
        section_title: 'Age ≥ 18',
        tagging_mode: 'PIQC_ASSISTED',
        source_extracted_item_id: 'item-3',
      }),
    });
    render(<IsaRiskAssessmentWorkspace />);
    await screen.findByText('2 suggestions');

    await user.click(screen.getByRole('button', { name: 'Accept key_inclusion_criteria[0]' }));

    expect(screen.getByPlaceholderText('e.g. 5.3.2 or §7.1')).toHaveValue('key_inclusion_criteria[0]');
    expect(screen.getByPlaceholderText('e.g. Central Laboratory Services')).toHaveValue('Age ≥ 18');
    expect(screen.queryByText('Operational domain')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Tag section' }));

    await waitFor(() => expect(mockCreateFromCandidate).toHaveBeenCalledTimes(1));
    expect(mockCreateFromCandidate).toHaveBeenCalledWith(
      'pv-1',
      expect.objectContaining({
        sectionTitle: 'Age ≥ 18',
        endpointTier: 'SAFETY',
        impactSurface: 'BOTH',
        operationalDomainTag: null,
        vendorDependencyFlags: [],
        sourceExtractedItemId: 'item-3',
      }),
      expect.objectContaining({ source: 'sotr_item', rule: 'criterion', field_path: 'key_inclusion_criteria[0]' }),
    );
    expect(mockCreate).not.toHaveBeenCalled();

    // The accepted item leaves the suggestions; the row wears the chip.
    expect(await screen.findByText('PIQC-assisted')).toBeInTheDocument();
    expect(screen.getByText('1 suggestion · 1 tagged')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Accept key_inclusion_criteria[0]' })).not.toBeInTheDocument();
  });
});

// isa-stage-advance: Site intake can advance now, so Stage 2 carries the
// house preview gate. Viewed one ahead (audit still at Site intake) the flow
// is read-only — no Tag button, Accept disabled, no Edit/Delete — while the
// tagged rows and History stay visible (version-scoped protocol data).
describe('IsaRiskAssessmentWorkspace — one-ahead preview (isa-stage-advance)', () => {
  it('at Site intake: banner up, tagging entry points off, tagged rows read-only', async () => {
    mockCurrentStage = 'ISA_SITE_INTAKE';
    mockFetchRisks.mockResolvedValue([savedRow({})]);

    render(<IsaRiskAssessmentWorkspace />);

    // Two elements name the audit's real stage here: the preview notice and
    // the transition card's ahead line. A bare /advance from Site intake/
    // matches both, so each is matched on its own copy.
    expect(
      screen.getByText(/this is a preview\. Actions here are disabled until you advance from Site intake\./i),
    ).toBeInTheDocument();
    expect(screen.getByText('Advance from Site intake first.')).toBeInTheDocument();

    expect(await screen.findByText(/2 suggestions/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Tag a section' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Accept key_inclusion_criteria[0]' })).toBeDisabled();

    expect(await screen.findByText('Eligibility: age')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Delete tagged section' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'History' })).toBeInTheDocument();
    // The card mirrors the server rule: a +2 jump is never offered.
    expect(screen.getByRole('button', { name: 'Advance to Scope builder' })).toBeDisabled();
  });

  it('at Site intake with nothing tagged: the empty state does not point at a button that is not there', async () => {
    mockCurrentStage = 'ISA_SITE_INTAKE';

    render(<IsaRiskAssessmentWorkspace />);

    expect(await screen.findByText('No sections tagged yet.')).toBeInTheDocument();
    expect(screen.queryByText(/use Tag a section/)).not.toBeInTheDocument();
  });

  it('at Site intake: the module panel is mounted read-only (no picker even with a mapping to show)', async () => {
    mockCurrentStage = 'ISA_SITE_INTAKE';
    mockFetchMappings.mockResolvedValue({
      ok: true,
      data: {
        available: true,
        mappings: [{
          id: 'smm-1',
          audit_id: 'audit-isa-1',
          protocol_risk_id: 'risk-1',
          isa_domain: 'INFORMED_CONSENT',
          derived_criticality: 'HIGH',
          criticality_rationale: 'Derived from: safety endpoint, both impact.',
          created_at: '2026-09-05T00:00:00Z',
          updated_at: '2026-09-05T00:00:00Z',
        }],
      },
    });

    render(<IsaRiskAssessmentWorkspace />);

    expect(screen.getByText('Map tagged risks to site audit modules')).toBeInTheDocument();
    await waitFor(() => expect(mockFetchMappings).toHaveBeenCalledWith('audit-isa-1'));
    // The panel reads tagged risks from its own store slice in this mock
    // (per-hook useState), so with none tagged it shows the pointer copy and
    // no picker — the readOnly rendering with rows is pinned in the panel test.
    expect(await screen.findByText('Tag a protocol section above to map it to a site module.')).toBeInTheDocument();
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  });
});
