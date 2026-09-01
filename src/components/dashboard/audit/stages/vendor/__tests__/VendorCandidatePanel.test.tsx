// VendorCandidatePanel (fieldwork lane, slice 2) — the accept/edit/reject
// latch over PIQC-drafted candidate observations. Pins:
//   - Draft renders cards with each evidence line beside the note it cites
//     and discloses the withheld / stripped counts
//   - an empty run says so; a failed run says so AND keeps the cards on screen
//   - Accept verbatim → edited:false (PIQC_DRAFTED); any edit → the Edited
//     chip and edited:true (PIQC_EDITED), with the auditor's classification
//   - a successful Accept removes the card and hands the entry + consumed
//     note ids up; a refused Accept keeps the card and reports on it
//   - Dismiss removes the card and clears the stash; a stash is restored on
//     mount and pruned once a cited note is known to be promoted
//   - preview (hasReached=false) hides Draft and Accept, keeps cards readable

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { AuditNoteObject } from '../../../../../../types/audit';
import type { MockWorkspaceEntry } from '../../../../../../lib/audit/mockWorkspaceEntries';

vi.mock('../../../../../../lib/audit/observationDraftApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../../../lib/audit/observationDraftApi')>();
  return { ...actual, requestObservationCandidates: vi.fn() };
});
vi.mock('../../../../../../lib/audit/workspaceEntriesApi', () => ({
  promoteWorkspaceCandidate: vi.fn(),
}));

import VendorCandidatePanel from '../VendorCandidatePanel';
import {
  CANDIDATE_STASH_PREFIX,
  requestObservationCandidates,
  type ObservationCandidate,
} from '../../../../../../lib/audit/observationDraftApi';
import { promoteWorkspaceCandidate } from '../../../../../../lib/audit/workspaceEntriesApi';

const m = (fn: unknown) => fn as ReturnType<typeof vi.fn>;

const NOTE_A = 'aaaaaaaa-0000-0000-0000-000000000001';
const NOTE_B = 'aaaaaaaa-0000-0000-0000-000000000002';

function note(id: string, overrides: Partial<AuditNoteObject> = {}): AuditNoteObject {
  return {
    id,
    audit_id: 'audit-1',
    body: `Fridge log gap noted for ${id}`,
    isa_domain: null,
    is_positive: false,
    deleted_at: null,
    promoted_finding_id: null,
    promoted_entry_id: null,
    created_by: 'user-1',
    created_at: '2026-09-08T09:30:00Z',
    updated_at: '2026-09-08T09:30:00Z',
    ...overrides,
  };
}

function candidate(overrides: Partial<ObservationCandidate> = {}): ObservationCandidate {
  return {
    vendor_domain: 'Data integrity',
    observation_text: 'Temperature excursions were not documented within the required window.',
    checkpoint_ref: null,
    evidence: [
      {
        text: 'Two excursions were logged five days late.',
        source_note_ids: [NOTE_A],
        source_passages: [
          { chunk_id: 'chunk-e1', document_id: 'doc-e', section_heading: '4.2 Excursions', page_start: 3, page_end: 3 },
        ],
      },
    ],
    protocol_ref: null,
    ...overrides,
  };
}

function entry(): MockWorkspaceEntry {
  return {
    id: 'we-9',
    audit_id: 'audit-1',
    protocol_risk_id: null,
    vendor_service_mapping_id: null,
    questionnaire_response_id: null,
    checkpoint_ref: null,
    vendor_domain: 'Data integrity',
    observation_text: 'Temperature excursions were not documented within the required window.',
    provisional_impact: 'NONE',
    provisional_classification: 'NOT_YET_CLASSIFIED',
    inherited_endpoint_tier: null,
    inherited_impact_surface: null,
    inherited_time_sensitivity: null,
    risk_context_outdated: false,
    source_extracted_item_id: null,
    created_by_name: 'Auditor',
    created_at: '2026-09-08T10:00:00Z',
  };
}

function okResponse(candidates: ObservationCandidate[], extra: Partial<{ withheld_count: number; stripped_protocol_ref_count: number }> = {}) {
  return {
    ok: true as const,
    data: {
      candidates,
      withheld_count: extra.withheld_count ?? 0,
      stripped_protocol_ref_count: extra.stripped_protocol_ref_count ?? 0,
      protocol_source: 'ready' as const,
      note_count: 2,
      evidence_doc_count: 1,
    },
  };
}

function renderPanel(
  overrides: Partial<{ hasReached: boolean; notes: AuditNoteObject[] | null; onPromoted: ReturnType<typeof vi.fn> }> = {},
) {
  const onPromoted = overrides.onPromoted ?? vi.fn();
  const utils = render(
    <VendorCandidatePanel
      auditId="audit-1"
      hasReached={overrides.hasReached ?? true}
      isLight
      notes={overrides.notes === undefined ? [note(NOTE_A), note(NOTE_B)] : overrides.notes}
      onPromoted={onPromoted}
    />,
  );
  return { ...utils, onPromoted };
}

async function draft() {
  fireEvent.click(screen.getByTestId('vendor-candidate-generate'));
  return screen.findByLabelText('Observation');
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
});

describe('drafting', () => {
  it('renders each candidate with its evidence beside the cited note and the filed passage, and discloses counts', async () => {
    m(requestObservationCandidates).mockResolvedValue(
      okResponse([candidate()], { withheld_count: 1, stripped_protocol_ref_count: 2 }),
    );
    renderPanel();

    const observation = (await draft()) as HTMLTextAreaElement;
    expect(m(requestObservationCandidates)).toHaveBeenCalledWith('audit-1');
    expect(observation.value).toBe('Temperature excursions were not documented within the required window.');
    expect((screen.getByLabelText('Domain') as HTMLInputElement).value).toBe('Data integrity');
    expect(screen.getByText('Two excursions were logged five days late.')).toBeTruthy();
    expect(screen.getByText(`Fridge log gap noted for ${NOTE_A}`)).toBeTruthy();
    expect(screen.getByText(/Filed evidence · § 4.2 Excursions, p. 3/)).toBeTruthy();
    expect(screen.getByTestId('vendor-candidate-count').textContent).toBe('1 candidate to review');
    const counts = screen.getByTestId('vendor-candidate-counts').textContent ?? '';
    expect(counts).toContain('1 proposal was withheld');
    expect(counts).toContain('2 protocol citations');
    // No grading surface arrives from the engine — the only classification
    // control is the auditor's own select, defaulting to unclassified.
    expect((screen.getByLabelText('Classification') as HTMLSelectElement).value).toBe('NOT_YET_CLASSIFIED');
    expect(screen.queryByText(/severity/i)).toBeNull();
  });

  it('an empty run says why; a failed run says so and keeps the cards already on screen', async () => {
    m(requestObservationCandidates).mockResolvedValueOnce(okResponse([], { withheld_count: 2 }));
    renderPanel();
    fireEvent.click(screen.getByTestId('vendor-candidate-generate'));
    expect((await screen.findByTestId('vendor-candidate-note')).textContent).toContain('Every proposal was withheld');

    m(requestObservationCandidates).mockResolvedValueOnce(okResponse([candidate()]));
    await draft();
    m(requestObservationCandidates).mockResolvedValueOnce({
      ok: false,
      error: 'The drafting engine is not deployed yet — your notes are safe.',
    });
    fireEvent.click(screen.getByTestId('vendor-candidate-generate'));
    expect((await screen.findByTestId('vendor-candidate-note')).textContent).toContain('not deployed yet');
    expect(screen.getByLabelText('Observation')).toBeTruthy();
  });
});

describe('accept / edit / dismiss', () => {
  it('Accept verbatim promotes as PIQC-drafted, removes the card, and hands the entry + consumed notes up', async () => {
    m(requestObservationCandidates).mockResolvedValue(okResponse([candidate()]));
    m(promoteWorkspaceCandidate).mockResolvedValue({ ok: true, data: entry() });
    const { onPromoted } = renderPanel();
    await draft();

    fireEvent.click(screen.getByRole('button', { name: /accept as observation/i }));

    await waitFor(() => expect(m(promoteWorkspaceCandidate)).toHaveBeenCalledTimes(1));
    expect(m(promoteWorkspaceCandidate)).toHaveBeenCalledWith('audit-1', {
      vendorDomain: 'Data integrity',
      observationText: 'Temperature excursions were not documented within the required window.',
      evidence: candidate().evidence,
      edited: false,
      checkpointRef: null,
      protocolRef: null,
      provisionalClassification: 'NOT_YET_CLASSIFIED',
    });
    await waitFor(() => expect(screen.queryByLabelText('Observation')).toBeNull());
    expect(onPromoted).toHaveBeenCalledWith(entry(), [NOTE_A]);
    expect(localStorage.getItem(`${CANDIDATE_STASH_PREFIX}audit-1`)).toBeNull();
  });

  it('an edit marks the card Edited and Accept promotes as PIQC-edited with the chosen classification', async () => {
    m(requestObservationCandidates).mockResolvedValue(okResponse([candidate()]));
    m(promoteWorkspaceCandidate).mockResolvedValue({ ok: true, data: entry() });
    renderPanel();
    await draft();

    fireEvent.change(screen.getByLabelText('Observation'), { target: { value: '  Edited text.  ' } });
    fireEvent.change(screen.getByLabelText('Checkpoint reference'), { target: { value: 'SOP-014 §4.2' } });
    fireEvent.change(screen.getByLabelText('Classification'), { target: { value: 'FINDING' } });
    expect(screen.getByText('Edited')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /accept as observation/i }));

    await waitFor(() =>
      expect(m(promoteWorkspaceCandidate)).toHaveBeenCalledWith(
        'audit-1',
        expect.objectContaining({
          observationText: 'Edited text.',
          edited: true,
          checkpointRef: 'SOP-014 §4.2',
          provisionalClassification: 'FINDING',
        }),
      ),
    );
  });

  it('a refused Accept keeps the card and reports the reason on it', async () => {
    m(requestObservationCandidates).mockResolvedValue(okResponse([candidate()]));
    m(promoteWorkspaceCandidate).mockResolvedValue({
      ok: false,
      error: 'candidate cites a note already promoted into an accepted observation — re-run drafting',
    });
    const { onPromoted } = renderPanel();
    await draft();

    fireEvent.click(screen.getByRole('button', { name: /accept as observation/i }));

    const err = await screen.findByRole('alert');
    expect(err.textContent).toContain('Not accepted');
    expect(err.textContent).toContain('already promoted');
    expect(screen.getByLabelText('Observation')).toBeTruthy();
    expect(onPromoted).not.toHaveBeenCalled();
  });

  it('Dismiss removes the card and clears the stash', async () => {
    m(requestObservationCandidates).mockResolvedValue(okResponse([candidate()]));
    renderPanel();
    await draft();
    expect(localStorage.getItem(`${CANDIDATE_STASH_PREFIX}audit-1`)).not.toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /dismiss/i }));

    expect(screen.queryByLabelText('Observation')).toBeNull();
    expect(localStorage.getItem(`${CANDIDATE_STASH_PREFIX}audit-1`)).toBeNull();
  });
});

describe('stash', () => {
  const seed = (c: ObservationCandidate = candidate()) =>
    localStorage.setItem(
      `${CANDIDATE_STASH_PREFIX}audit-1`,
      JSON.stringify({ candidates: [{ ...c, key: 'k1', dirty: true }], withheld_count: 1, stripped_protocol_ref_count: 0 }),
    );

  it('restores stashed candidates on mount, with their review state, while the notes are unknown', () => {
    seed();
    renderPanel({ notes: null });
    expect(screen.getByLabelText('Observation')).toBeTruthy();
    expect(screen.getByText('Edited')).toBeTruthy();
    expect(screen.getByText('(note not loaded)')).toBeTruthy();
    expect(screen.getByTestId('vendor-candidate-counts').textContent).toContain('1 proposal was withheld');
  });

  it('prunes a stashed candidate once a note it cites is known to be promoted; evidence-only candidates survive', () => {
    seed();
    renderPanel({ notes: [note(NOTE_A, { promoted_entry_id: 'we-1' }), note(NOTE_B)] });
    expect(screen.queryByLabelText('Observation')).toBeNull();
    expect(localStorage.getItem(`${CANDIDATE_STASH_PREFIX}audit-1`)).toBeNull();

    seed(candidate({ evidence: [{ ...candidate().evidence[0], source_note_ids: [] }] }));
    renderPanel({ notes: [note(NOTE_A, { promoted_entry_id: 'we-1' })] });
    expect(screen.getByLabelText('Observation')).toBeTruthy();
  });
});

describe('preview from ahead', () => {
  it('hides Draft and Accept, keeps stashed cards readable', () => {
    localStorage.setItem(
      `${CANDIDATE_STASH_PREFIX}audit-1`,
      JSON.stringify({ candidates: [{ ...candidate(), key: 'k1', dirty: false }], withheld_count: 0, stripped_protocol_ref_count: 0 }),
    );
    renderPanel({ hasReached: false });
    expect(screen.queryByTestId('vendor-candidate-generate')).toBeNull();
    expect(screen.queryByRole('button', { name: /accept as observation/i })).toBeNull();
    expect(screen.queryByLabelText('Classification')).toBeNull();
    expect((screen.getByLabelText('Observation') as HTMLTextAreaElement).disabled).toBe(true);
  });
});
