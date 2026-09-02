// EntryProvenance (fieldwork lane, slice 3) — the provenance surface of a
// Stage-6 observation. Pins:
//   - a hand-typed (AUDITOR) entry renders nothing — those rows are untouched
//   - PIQC_DRAFTED / PIQC_EDITED render the server-decided origin pill
//   - Sources is collapsed by default; opening it shows the chain PER
//     claim: the claim's text, the notes it cites (body, or "(note not
//     loaded)" while the read is unknown, or "Note unavailable" once the
//     notes are known), the filed passages' locators in the shared format,
//     then the protocol quote and the engine line scoped to acceptance
//   - the toggle summary names the claim count and the DISTINCT sources
//   - every test id is row-scoped (two PIQC rows never collide)

import { describe, it, expect } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { AuditNoteObject } from '../../../../../../types/audit';
import type { MockWorkspaceEntry } from '../../../../../../lib/audit/mockWorkspaceEntries';
import EntryProvenance from '../EntryProvenance';

const NOTE_A = 'aaaaaaaa-0000-0000-0000-000000000001';
const NOTE_B = 'aaaaaaaa-0000-0000-0000-000000000002';

function note(id: string, body: string): AuditNoteObject {
  return {
    id,
    audit_id: 'audit-1',
    body,
    isa_domain: null,
    is_positive: false,
    deleted_at: null,
    promoted_finding_id: null,
    promoted_entry_id: 'we-1',
    created_by: 'user-1',
    created_at: '2026-09-08T09:30:00Z',
    updated_at: '2026-09-08T09:30:00Z',
  };
}

const PASSAGE = {
  chunk_id: 'chunk-e1',
  document_id: 'doc-e',
  content_hash: 'sha-e',
  section_heading: '4.2 Excursions',
  page_start: 3,
  page_end: 3,
};

function entry(overrides: Partial<MockWorkspaceEntry> = {}): MockWorkspaceEntry {
  return {
    id: 'we-1',
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
    source_note_ids: [NOTE_A, NOTE_B],
    evidence_refs: [
      { text: 'Two excursions logged late.', source_note_ids: [NOTE_A], source_passages: [PASSAGE] },
      { text: 'Monthly review overdue.', source_note_ids: [NOTE_B], source_passages: [PASSAGE] },
    ],
    protocol_ref: {
      chunk_id: 'chunk-p1',
      document_id: 'doc-p',
      quote: 'any excursion documented and reported to the sponsor',
      section_heading: '6.3 Storage',
      page_start: 47,
      page_end: 47,
    },
    drafting_engine: { function: 'audit-observation-draft', model: 'gpt-4o-mini' },
    created_by_name: 'Auditor',
    created_at: '2026-09-08T10:00:00Z',
    ...overrides,
  };
}

const notesById = () => new Map([[NOTE_A, note(NOTE_A, 'Fridge log gap 03–05 Sep')]]);

function renderIt(e: MockWorkspaceEntry, notesStatus: 'loading' | 'ready' | 'failed' = 'ready') {
  return render(<EntryProvenance entry={e} notesById={notesById()} notesStatus={notesStatus} isLight />);
}

const toggle = (id = 'we-1') => screen.getByTestId(`entry-provenance-toggle-${id}`);
const detail = (id = 'we-1') => screen.queryByTestId(`entry-provenance-detail-${id}`);

describe('EntryProvenance', () => {
  it('renders nothing for a hand-typed entry', () => {
    const { container } = renderIt(
      entry({ origin: 'AUDITOR', source_note_ids: [], evidence_refs: [], protocol_ref: null, drafting_engine: null }),
    );
    expect(container.innerHTML).toBe('');
  });

  it('shows the origin pill and a collapsed Sources toggle naming the claim count and the distinct sources', () => {
    renderIt(entry());
    expect(screen.getByTestId('entry-origin-pill-we-1').textContent).toBe('PIQC-drafted');
    expect(toggle().textContent).toContain('Sources · 2 claims · 2 notes · 1 filed passage · protocol quote');
    expect(detail()).toBeNull();
  });

  it('PIQC_EDITED reads as edited on the pill and in the engine line', () => {
    renderIt(entry({ origin: 'PIQC_EDITED' }));
    expect(screen.getByTestId('entry-origin-pill-we-1').textContent).toBe('PIQC-drafted, edited');
    fireEvent.click(toggle());
    expect(screen.getByTestId('entry-provenance-engine-we-1').textContent).toContain(
      'accepted with edits by the auditor',
    );
  });

  it('opening Sources shows each claim with the notes and passages it cites, then the quote and the engine', () => {
    renderIt(entry());
    fireEvent.click(toggle());
    const text = detail()?.textContent ?? '';
    // The claim text survives on the record, paired with what supported it.
    expect(text).toContain('Two excursions logged late.');
    expect(text).toContain('Monthly review overdue.');
    expect(text).toContain('Your note: Fridge log gap 03–05 Sep');
    // NOTE_B is not in the read while the notes are known → genuinely gone.
    expect(text).toContain('Your note: Note unavailable');
    // One distinct passage (the summary's count), listed under each of the
    // two claims that cite it, in the shared locator format.
    expect(screen.getAllByText(/Filed evidence · § 4.2 Excursions \(p\. 3\)/)).toHaveLength(2);
    expect(text).toContain('Protocol requirement · § 6.3 Storage (p. 47)');
    expect(text).toContain('“any excursion documented and reported to the sponsor”');
    // Scoped to the moment of acceptance — origin does not flip on later
    // entry-form edits, so the line never claims the CURRENT text is verbatim.
    expect(screen.getByTestId('entry-provenance-engine-we-1').textContent).toBe(
      'Drafted by gpt-4o-mini (audit-observation-draft); accepted as proposed by the auditor. Changes since acceptance are in History.',
    );
    expect(toggle().getAttribute('aria-expanded')).toBe('true');

    fireEvent.click(toggle());
    expect(detail()).toBeNull();
  });

  it('while the notes read is loading or failed, a missing note is "(note not loaded)", never "unavailable"', () => {
    for (const status of ['loading', 'failed'] as const) {
      const { unmount } = renderIt(entry(), status);
      fireEvent.click(toggle());
      const text = detail()?.textContent ?? '';
      expect(text).toContain('(note not loaded)');
      expect(text).not.toContain('Note unavailable');
      unmount();
    }
  });

  it('an evidence-only entry shows the claim with its passage and no note or protocol lines', () => {
    render(
      <EntryProvenance
        entry={entry({
          source_note_ids: [],
          evidence_refs: [{ text: 'Log entries were late.', source_note_ids: [], source_passages: [PASSAGE] }],
          protocol_ref: null,
        })}
        notesById={new Map()}
        notesStatus="ready"
        isLight
      />,
    );
    expect(toggle().textContent).toBe('Sources · 1 claim · 1 filed passage');
    fireEvent.click(toggle());
    expect(screen.getByText('Log entries were late.')).toBeTruthy();
    expect(screen.queryByText(/Your note/)).toBeNull();
    expect(screen.queryByText(/Protocol requirement/)).toBeNull();
  });

  it('two PIQC rows side by side keep their own toggles and details', () => {
    render(
      <>
        <EntryProvenance entry={entry()} notesById={notesById()} notesStatus="ready" isLight />
        <EntryProvenance entry={entry({ id: 'we-2', origin: 'PIQC_EDITED' })} notesById={notesById()} notesStatus="ready" isLight />
      </>,
    );
    fireEvent.click(toggle('we-2'));
    expect(detail('we-1')).toBeNull();
    expect(detail('we-2')).toBeTruthy();
    expect(screen.getByTestId('entry-origin-pill-we-2').textContent).toBe('PIQC-drafted, edited');
  });
});
