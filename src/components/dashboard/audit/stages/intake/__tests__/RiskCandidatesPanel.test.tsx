// RiskCandidatesPanel — "Suggested from the parsed protocol" (Stage 1).
//
// The rules are pinned in riskCandidates.test.ts; here we lock what the
// auditor SEES per load state and the two contracts the workspace relies on:
// Accept hands the derived candidate up (nothing is written here), and
// `tagged` is the dedupe source so an accepted item leaves the list.
//
// Mock idiom: ProtocolReadinessCard.test.tsx (context hook mocked, the Api
// module mocked; the real deriveRiskCandidates runs).

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ComponentProps } from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { CandidateSourceItem } from '../../../../../../lib/audit/riskCandidates';
import type { TaggedSection } from '../../../../../../lib/audit/mockProtocolRisks';

vi.mock('../../../../../../context/ThemeContext', () => ({
  useTheme: () => ({ theme: 'light' as const, toggleTheme: () => {} }),
}));

vi.mock('../../../../../../lib/audit/riskCandidatesApi', () => ({
  fetchCandidateSourceItems: vi.fn(),
}));

import RiskCandidatesPanel from '../RiskCandidatesPanel';
import { fetchCandidateSourceItems } from '../../../../../../lib/audit/riskCandidatesApi';

const mockFetch = fetchCandidateSourceItems as unknown as ReturnType<typeof vi.fn>;

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

function taggedFrom(sourceId: string): TaggedSection {
  return {
    id: `risk-${sourceId}`,
    section_identifier: '§5.1',
    section_title: 'Overall survival',
    endpoint_tier: 'PRIMARY',
    impact_surface: 'DATA_INTEGRITY',
    time_sensitivity: false,
    vendor_dependency_flags: [],
    operational_domain_tag: 'CENTRAL_LAB',
    tagging_mode: 'PIQC_ASSISTED',
    version_change_type: 'ADDED',
    source_extracted_item_id: sourceId,
  };
}

const ENDPOINT = item({
  id: 'item-1',
  field_type: 'endpoint',
  field_path: 'primary_endpoints[0]',
  extracted_value: 'Overall survival',
  section_number: '5.1',
  page_number: 12,
});

const VISIT = item({
  id: 'item-2',
  field_type: 'visit',
  field_path: 'schedule_of_events[0]',
  extracted_value: {
    visit_name: 'Screening',
    study_day: -14,
    window_minus_days: 3,
    window_plus_days: 3,
    procedures: ['ECG', 'Labs'],
  },
  review_status: 'accepted_for_draft',
});

const CRITERION = item({
  id: 'item-3',
  field_type: 'criterion',
  field_path: 'key_inclusion_criteria[0]',
  extracted_value: 'Age ≥ 18',
});

function renderPanel(props: Partial<ComponentProps<typeof RiskCandidatesPanel>> = {}) {
  const onAccept = vi.fn();
  const utils = render(
    <RiskCandidatesPanel
      protocolId="protocol-1"
      workflow="VENDOR_AUDIT"
      tagged={[]}
      disabled={false}
      onAccept={onAccept}
      {...props}
    />,
  );
  return { ...utils, onAccept };
}

beforeEach(() => {
  mockFetch.mockReset();
});

describe('RiskCandidatesPanel — load states', () => {
  it('shows the reading line while the fetch is in flight', () => {
    mockFetch.mockReturnValue(new Promise(() => {}));
    renderPanel();

    expect(screen.getByText('Reading the parsed protocol…')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Accept/ })).not.toBeInTheDocument();
  });

  it('shows the read error with a Retry that refetches', async () => {
    const user = userEvent.setup();
    mockFetch
      .mockResolvedValueOnce({ ok: false, error: 'permission denied' })
      .mockResolvedValueOnce({ ok: true, data: [ENDPOINT] });
    renderPanel();

    expect(await screen.findByRole('alert')).toHaveTextContent('permission denied');
    await user.click(screen.getByRole('button', { name: 'Retry' }));

    expect(await screen.findByText('Overall survival')).toBeInTheDocument();
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(mockFetch).toHaveBeenCalledWith('protocol-1');
  });

  it('points at the parse status when there are no items, with a Check again', async () => {
    const user = userEvent.setup();
    mockFetch
      .mockResolvedValueOnce({ ok: true, data: [] })
      .mockResolvedValueOnce({ ok: true, data: [ENDPOINT] });
    renderPanel();

    expect(
      await screen.findByText('No parsed protocol items yet — see the parse status above.'),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Check again' }));

    expect(await screen.findByText('Overall survival')).toBeInTheDocument();
  });
});

describe('RiskCandidatesPanel — list', () => {
  it('groups candidates by rule with identifier, title, tier, SOTR state and page', async () => {
    mockFetch.mockResolvedValue({ ok: true, data: [VISIT, ENDPOINT, CRITERION] });
    renderPanel();

    expect(await screen.findByText('2 suggestions')).toBeInTheDocument();
    expect(screen.getByText('Primary endpoints')).toBeInTheDocument();
    expect(screen.getByText('Visits')).toBeInTheDocument();
    // Eligibility criteria are site-facing: not shown on the vendor stage.
    expect(screen.queryByText('Eligibility criteria')).not.toBeInTheDocument();
    expect(screen.queryByText('Age ≥ 18')).not.toBeInTheDocument();

    const endpointRow = screen.getByText('Overall survival').closest('li') as HTMLElement;
    expect(within(endpointRow).getByText('§5.1')).toBeInTheDocument();
    expect(within(endpointRow).getByText('Primary endpoint')).toBeInTheDocument();
    expect(within(endpointRow).getByText('SOTR: awaiting review')).toBeInTheDocument();
    expect(within(endpointRow).getByText('p. 12')).toBeInTheDocument();
    expect(within(endpointRow).getByText(/Primary · Data integrity/)).toBeInTheDocument();

    const visitRow = screen.getByText('Screening — Day -14 (±3d) · ECG, Labs').closest('li') as HTMLElement;
    expect(within(visitRow).getByText('SOTR: reviewed')).toBeInTheDocument();
    expect(within(visitRow).getByText(/Time-sensitive/)).toBeInTheDocument();

    expect(screen.getByText('Derived, not generated')).toBeInTheDocument();
  });

  it('Accept hands the derived candidate to the workspace', async () => {
    const user = userEvent.setup();
    mockFetch.mockResolvedValue({ ok: true, data: [ENDPOINT] });
    const { onAccept } = renderPanel();

    await user.click(await screen.findByRole('button', { name: 'Accept §5.1' }));

    expect(onAccept).toHaveBeenCalledTimes(1);
    expect(onAccept).toHaveBeenCalledWith(
      expect.objectContaining({
        source_extracted_item_id: 'item-1',
        rule: 'endpoint_primary',
        section_identifier: '§5.1',
        section_title: 'Overall survival',
        endpoint_tier: 'PRIMARY',
        impact_surface: 'DATA_INTEGRITY',
        time_sensitivity: false,
      }),
    );
  });

  it('disables Accept while the workspace is saving', async () => {
    mockFetch.mockResolvedValue({ ok: true, data: [ENDPOINT] });
    renderPanel({ disabled: true });

    expect(await screen.findByRole('button', { name: 'Accept §5.1' })).toBeDisabled();
  });

  it('drops candidates already tagged from their item and says so when none remain', async () => {
    mockFetch.mockResolvedValue({ ok: true, data: [ENDPOINT] });
    renderPanel({ tagged: [taggedFrom('item-1')] });

    expect(
      await screen.findByText('Nothing left to suggest — every parsed item with a proposal is already tagged.'),
    ).toBeInTheDocument();
    expect(screen.getByText('0 suggestions · 1 tagged')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Accept/ })).not.toBeInTheDocument();
  });

  it('counts parsed items it could not propose', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      data: [ENDPOINT, item({ id: 'item-9', field_type: 'dosing', field_path: 'dosing_regimen', extracted_value: 42 })],
    });
    renderPanel();

    expect(await screen.findByText(/1 parsed item not proposed/)).toBeInTheDocument();
  });

  it('includes eligibility criteria on the investigator site workflow', async () => {
    mockFetch.mockResolvedValue({ ok: true, data: [VISIT, ENDPOINT, CRITERION] });
    renderPanel({ workflow: 'INVESTIGATOR_SITE_AUDIT' });

    expect(await screen.findByText('3 suggestions')).toBeInTheDocument();
    expect(screen.getByText('Eligibility criteria')).toBeInTheDocument();
    const row = screen.getByText('Age ≥ 18').closest('li') as HTMLElement;
    expect(within(row).getByText('Criterion')).toBeInTheDocument();
    expect(within(row).getByText(/Safety · Both/)).toBeInTheDocument();
  });

  it('points the site workflow at Stage 1 for the parse status when there are no items', async () => {
    mockFetch.mockResolvedValue({ ok: true, data: [] });
    renderPanel({ workflow: 'INVESTIGATOR_SITE_AUDIT' });

    expect(
      await screen.findByText('No parsed protocol items yet — see the parse status on Stage 1 (Site intake).'),
    ).toBeInTheDocument();
  });

  it('collapses and expands a group', async () => {
    const user = userEvent.setup();
    mockFetch.mockResolvedValue({ ok: true, data: [ENDPOINT] });
    renderPanel();

    const toggle = await screen.findByRole('button', { name: /Primary endpoints/ });
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('Overall survival')).not.toBeInTheDocument();
    await user.click(toggle);
    expect(screen.getByText('Overall survival')).toBeInTheDocument();
  });
});
