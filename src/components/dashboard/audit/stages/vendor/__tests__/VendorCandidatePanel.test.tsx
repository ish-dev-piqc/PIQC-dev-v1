// VendorCandidatePanel (fieldwork lane, slice 2) — the accept/edit/reject
// latch over PIQC-drafted candidate observations. Pins:
//   - Draft renders cards with each evidence line beside the note it cites
//     or the filed passage it came from, and discloses withheld / stripped
//   - an empty run says so; a failed run says so AND keeps the cards
//   - Accept forwards the provenance bundle (key, evidence, the proposal as
//     drafted, the engine, the auditor's classification) and asserts no
//     origin; the Edited chip is derived from the same comparison the server
//     makes, so reverting an edit un-edits it
//   - a successful Accept removes the card and hands the entry + consumed
//     note ids up; a refused Accept keeps the card and reports on it; a
//     double click fires once; an edit made during an in-flight Accept
//     survives it
//   - the stash is user+audit scoped, restores classification, is pruned
//     only once the notes are KNOWN, and is cleared on Dismiss
//   - while the notes are unknown (loading / failed) neither Draft nor
//     Accept is armed; preview (hasReached=false) hides every action

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { AuditNoteObject } from '../../../../../../types/audit';
import type { MockWorkspaceEntry } from '../../../../../../lib/audit/mockWorkspaceEntries';

vi.mock('../../../../../../context/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'user-1' } }),
}));
vi.mock('../../../../../../lib/audit/observationDraftApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../../../lib/audit/observationDraftApi')>();
  return { ...actual, requestObservationCandidates: vi.fn() };
});
vi.mock('../../../../../../lib/audit/workspaceEntriesApi', () => ({
  promoteWorkspaceCandidate: vi.fn(),
}));

import VendorCandidatePanel from '../VendorCandidatePanel';
import {
  candidateStashKey,
  requestObservationCandidates,
  stashCandidate,
  writeCandidateStash,
  type ObservationCandidate,
  type StashedCandidate,
} from '../../../../../../lib/audit/observationDraftApi';
import { promoteWorkspaceCandidate } from '../../../../../../lib/audit/workspaceEntriesApi';

const m = (fn: unknown) => fn as ReturnType<typeof vi.fn>;

const NOTE_A = 'aaaaaaaa-0000-0000-0000-000000000001';
const NOTE_B = 'aaaaaaaa-0000-0000-0000-000000000002';
const ENGINE = { function: 'audit-observation-draft', model: 'gpt-4o-mini' };
const DRAFTED_AT = '2026-09-08T10:00:00Z';
const STASH_KEY = candidateStashKey('user-1', 'audit-1');

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
          {
            chunk_id: 'chunk-e1',
            document_id: 'doc-e',
            content_hash: 'sha-e',
            section_heading: '4.2 Excursions',
            page_start: 3,
            page_end: 3,
          },
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
    origin: 'PIQC_DRAFTED',
    source_note_ids: [NOTE_A],
    evidence_refs: candidate().evidence,
    protocol_ref: null,
    drafting_engine: ENGINE,
    created_by_name: 'Auditor',
    created_at: '2026-09-08T10:00:00Z',
  };
}

function okResponse(
  candidates: ObservationCandidate[],
  extra: Partial<{ withheld_count: number; stripped_protocol_ref_count: number }> = {},
) {
  return {
    ok: true as const,
    data: {
      candidates,
      withheld_count: extra.withheld_count ?? 0,
      stripped_protocol_ref_count: extra.stripped_protocol_ref_count ?? 0,
      engine: ENGINE,
      drafted_at: DRAFTED_AT,
    },
  };
}

function seedStash(cards: StashedCandidate[], withheld = 1) {
  writeCandidateStash('user-1', 'audit-1', {
    candidates: cards,
    withheld_count: withheld,
    stripped_protocol_ref_count: 0,
  });
}

type NotesStatus = 'loading' | 'ready' | 'failed';

function renderPanel(
  overrides: Partial<{
    hasReached: boolean;
    notes: AuditNoteObject[];
    notesStatus: NotesStatus;
    onPromoted: ReturnType<typeof vi.fn>;
  }> = {},
) {
  const onPromoted = overrides.onPromoted ?? vi.fn();
  const utils = render(
    <VendorCandidatePanel
      auditId="audit-1"
      hasReached={overrides.hasReached ?? true}
      isLight
      notes={overrides.notes ?? [note(NOTE_A), note(NOTE_B)]}
      notesStatus={overrides.notesStatus ?? 'ready'}
      onPromoted={onPromoted}
    />,
  );
  return { ...utils, onPromoted };
}

// Waits for the cards to render; returns the FIRST observation textarea
// (the two-card tests address the rest with getAll* queries).
async function draft() {
  fireEvent.click(screen.getByTestId('vendor-candidate-generate'));
  const observations = await screen.findAllByLabelText('Observation');
  return observations[0];
}

const acceptButton = () => screen.getByRole('button', { name: /accept as observation/i });

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
    // The shared locator formatter — the same string the ISA card, report,
    // docx, and clipboard render.
    expect(screen.getByText(/Filed evidence · § 4.2 Excursions \(p\. 3\)/)).toBeTruthy();
    expect(screen.getByTestId('vendor-candidate-count').textContent).toBe('1 candidate to review');
    const counts = screen.getByTestId('vendor-candidate-counts').textContent ?? '';
    expect(counts).toContain('1 proposal was withheld');
    expect(counts).toContain('2 protocol citations');
    // No grading arrives from the engine — the only classification control
    // is the auditor's own select, defaulting to unclassified.
    expect((screen.getByLabelText('Classification') as HTMLSelectElement).value).toBe('NOT_YET_CLASSIFIED');
    expect(screen.queryByText(/severity/i)).toBeNull();
    expect(screen.getByTestId('vendor-candidate-generate').textContent).toBe('Draft again');
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
  it('Accept forwards the provenance bundle with no origin claim, removes the card, hands the entry + consumed notes up, and clears the stash', async () => {
    m(requestObservationCandidates).mockResolvedValue(okResponse([candidate()]));
    m(promoteWorkspaceCandidate).mockResolvedValue({ ok: true, data: entry() });
    const { onPromoted } = renderPanel();
    await draft();

    fireEvent.click(acceptButton());

    await waitFor(() => expect(m(promoteWorkspaceCandidate)).toHaveBeenCalledTimes(1));
    expect(m(promoteWorkspaceCandidate)).toHaveBeenCalledWith('audit-1', {
      candidateKey: expect.any(String),
      vendorDomain: 'Data integrity',
      observationText: 'Temperature excursions were not documented within the required window.',
      checkpointRef: null,
      evidence: candidate().evidence,
      protocolRef: null,
      drafted: {
        vendor_domain: 'Data integrity',
        observation_text: 'Temperature excursions were not documented within the required window.',
        checkpoint_ref: null,
      },
      engine: ENGINE,
      provisionalClassification: 'NOT_YET_CLASSIFIED',
    });
    await waitFor(() => expect(screen.queryByLabelText('Observation')).toBeNull());
    expect(onPromoted).toHaveBeenCalledWith(entry(), [NOTE_A]);
    await waitFor(() => expect(localStorage.getItem(STASH_KEY)).toBeNull());
  });

  it('the Edited chip is derived — it appears on a change and disappears on revert; Accept sends the edit with the original proposal', async () => {
    m(requestObservationCandidates).mockResolvedValue(okResponse([candidate()]));
    m(promoteWorkspaceCandidate).mockResolvedValue({ ok: true, data: entry() });
    renderPanel();
    await draft();
    const original = 'Temperature excursions were not documented within the required window.';

    fireEvent.change(screen.getByLabelText('Observation'), { target: { value: `${original}!` } });
    expect(screen.getByText('Edited')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Observation'), { target: { value: original } });
    expect(screen.queryByText('Edited')).toBeNull();

    fireEvent.change(screen.getByLabelText('Observation'), { target: { value: '  Edited text.  ' } });
    fireEvent.change(screen.getByLabelText('Checkpoint reference'), { target: { value: 'SOP-014 §4.2' } });
    fireEvent.change(screen.getByLabelText('Classification'), { target: { value: 'FINDING' } });
    fireEvent.click(acceptButton());

    await waitFor(() =>
      expect(m(promoteWorkspaceCandidate)).toHaveBeenCalledWith(
        'audit-1',
        expect.objectContaining({
          observationText: 'Edited text.',
          checkpointRef: 'SOP-014 §4.2',
          provisionalClassification: 'FINDING',
          drafted: expect.objectContaining({ observation_text: original, checkpoint_ref: null }),
        }),
      ),
    );
  });

  it('a double click fires the promote RPC exactly once', async () => {
    m(requestObservationCandidates).mockResolvedValue(okResponse([candidate()]));
    let resolvePromote: (v: unknown) => void = () => {};
    m(promoteWorkspaceCandidate).mockImplementation(
      () => new Promise((resolve) => { resolvePromote = resolve; }),
    );
    renderPanel();
    await draft();

    const button = acceptButton();
    fireEvent.click(button);
    fireEvent.click(button);
    expect(m(promoteWorkspaceCandidate)).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Accepting…')).toBeTruthy();
    resolvePromote({ ok: true, data: entry() });
    await waitFor(() => expect(screen.queryByLabelText('Observation')).toBeNull());
    expect(m(promoteWorkspaceCandidate)).toHaveBeenCalledTimes(1);
  });

  it('an edit made to another card while an Accept is in flight survives the Accept resolving', async () => {
    m(requestObservationCandidates).mockResolvedValue(
      okResponse([candidate(), candidate({ observation_text: 'Second candidate.' })]),
    );
    let resolvePromote: (v: unknown) => void = () => {};
    m(promoteWorkspaceCandidate).mockImplementation(
      () => new Promise((resolve) => { resolvePromote = resolve; }),
    );
    renderPanel();
    await draft();

    fireEvent.click(screen.getAllByRole('button', { name: /accept as observation/i })[0]);
    const second = screen.getAllByLabelText('Observation')[1] as HTMLTextAreaElement;
    fireEvent.change(second, { target: { value: 'Edited during accept.' } });
    resolvePromote({ ok: true, data: entry() });

    await waitFor(() => expect(screen.getAllByLabelText('Observation')).toHaveLength(1));
    expect((screen.getByLabelText('Observation') as HTMLTextAreaElement).value).toBe('Edited during accept.');
    expect(screen.getByText('Edited')).toBeTruthy();
  });

  it('a refused Accept keeps the card and reports the reason on it', async () => {
    m(requestObservationCandidates).mockResolvedValue(okResponse([candidate()]));
    m(promoteWorkspaceCandidate).mockResolvedValue({
      ok: false,
      error: 'This candidate was already accepted — it is in the observation record',
    });
    const { onPromoted } = renderPanel();
    await draft();

    fireEvent.click(acceptButton());

    const err = await screen.findByRole('alert');
    expect(err.textContent).toContain('Not accepted');
    expect(err.textContent).toContain('already accepted');
    expect(screen.getByLabelText('Observation')).toBeTruthy();
    expect(onPromoted).not.toHaveBeenCalled();
  });

  it('Dismiss removes the card and clears the stash', async () => {
    m(requestObservationCandidates).mockResolvedValue(okResponse([candidate()]));
    renderPanel();
    await draft();
    await waitFor(() => expect(localStorage.getItem(STASH_KEY)).not.toBeNull());

    fireEvent.click(screen.getByRole('button', { name: /dismiss/i }));

    expect(screen.queryByLabelText('Observation')).toBeNull();
    await waitFor(() => expect(localStorage.getItem(STASH_KEY)).toBeNull());
  });
});

describe('stash', () => {
  it('restores cards with their review state (edit, classification) while the notes are still loading — unarmed', () => {
    seedStash([
      {
        ...stashCandidate(candidate(), ENGINE, DRAFTED_AT, 'k1'),
        observation_text: 'Edited earlier.',
        classification: 'FINDING',
      },
    ]);
    renderPanel({ notesStatus: 'loading', notes: [] });

    expect((screen.getByLabelText('Observation') as HTMLTextAreaElement).value).toBe('Edited earlier.');
    expect(screen.getByText('Edited')).toBeTruthy();
    expect((screen.getByLabelText('Classification') as HTMLSelectElement).value).toBe('FINDING');
    expect(screen.getByText('(note not loaded)')).toBeTruthy();
    expect(screen.getByTestId('vendor-candidate-counts').textContent).toContain('1 proposal was withheld');
    expect((screen.getByTestId('vendor-candidate-generate') as HTMLButtonElement).disabled).toBe(true);
    expect((acceptButton() as HTMLButtonElement).disabled).toBe(true);
  });

  it('is not read for another user or audit', () => {
    seedStash([stashCandidate(candidate(), ENGINE, DRAFTED_AT, 'k1')]);
    localStorage.setItem(candidateStashKey('user-2', 'audit-1'), localStorage.getItem(STASH_KEY) ?? '');
    localStorage.removeItem(STASH_KEY);
    renderPanel();
    expect(screen.queryByLabelText('Observation')).toBeNull();
  });

  it('prunes a card once a note it cites is known to be promoted; evidence-only cards survive', async () => {
    seedStash([stashCandidate(candidate(), ENGINE, DRAFTED_AT, 'k1')]);
    const { unmount } = renderPanel({
      notes: [note(NOTE_A, { promoted_entry_id: 'we-1' }), note(NOTE_B)],
    });
    expect(screen.queryByLabelText('Observation')).toBeNull();
    await waitFor(() => expect(localStorage.getItem(STASH_KEY)).toBeNull());
    unmount();

    seedStash([
      stashCandidate(
        candidate({ evidence: [{ ...candidate().evidence[0], source_note_ids: [] }] }),
        ENGINE,
        DRAFTED_AT,
        'k2',
      ),
    ]);
    renderPanel({ notes: [note(NOTE_A, { promoted_entry_id: 'we-1' })] });
    expect(screen.getByLabelText('Observation')).toBeTruthy();
  });
});

describe('notes unknown', () => {
  it('a failed notes read disarms Draft and Accept and says why — candidates are reviewed against notes, not instead of them', () => {
    seedStash([stashCandidate(candidate(), ENGINE, DRAFTED_AT, 'k1')]);
    renderPanel({ notesStatus: 'failed', notes: [] });
    expect(screen.getByTestId('vendor-candidate-notes-hint').textContent).toContain('could not be loaded');
    expect((screen.getByTestId('vendor-candidate-generate') as HTMLButtonElement).disabled).toBe(true);
    expect((acceptButton() as HTMLButtonElement).disabled).toBe(true);
    // The card is still readable and editable — only the latch is held.
    expect((screen.getByLabelText('Observation') as HTMLTextAreaElement).disabled).toBe(false);
  });
});

describe('preview from ahead', () => {
  it('hides Draft, Accept, Dismiss, and Classification; keeps stashed cards readable', () => {
    seedStash([stashCandidate(candidate(), ENGINE, DRAFTED_AT, 'k1')], 0);
    renderPanel({ hasReached: false });
    expect(screen.queryByTestId('vendor-candidate-generate')).toBeNull();
    expect(screen.queryByRole('button', { name: /accept as observation/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /dismiss/i })).toBeNull();
    expect(screen.queryByLabelText('Classification')).toBeNull();
    expect((screen.getByLabelText('Observation') as HTMLTextAreaElement).disabled).toBe(true);
    expect(screen.getByText('Two excursions were logged five days late.')).toBeTruthy();
  });
});
