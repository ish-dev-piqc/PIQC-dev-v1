// EntryProvenance (fieldwork lane, slice 3) — the provenance surface of a
// Stage-6 observation. Pins:
//   - a hand-typed (AUDITOR) entry renders nothing — those rows are untouched
//   - PIQC_DRAFTED / PIQC_EDITED render the server-decided origin pill
//   - Sources is collapsed by default; opening it shows the consumed notes'
//     bodies (or "Note unavailable"), the filed passages' locators in the
//     shared format (deduped by chunk), the protocol quote, and the engine
//   - the toggle summary counts what the chain holds

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
      { text: 'Review overdue.', source_note_ids: [NOTE_B], source_passages: [PASSAGE] },
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

describe('EntryProvenance', () => {
  it('renders nothing for a hand-typed entry', () => {
    const { container } = render(
      <EntryProvenance entry={entry({ origin: 'AUDITOR', source_note_ids: [], evidence_refs: [], protocol_ref: null, drafting_engine: null })} notesById={notesById()} isLight />,
    );
    expect(container.innerHTML).toBe('');
  });

  it('shows the origin pill and a collapsed Sources toggle whose summary counts the chain', () => {
    render(<EntryProvenance entry={entry()} notesById={notesById()} isLight />);
    expect(screen.getByTestId('entry-origin-pill').textContent).toBe('PIQC-drafted');
    expect(screen.getByTestId('entry-provenance-toggle').textContent).toContain(
      'Sources · 2 notes · 1 filed passage · protocol quote',
    );
    expect(screen.queryByTestId('entry-provenance-detail')).toBeNull();
  });

  it('PIQC_EDITED reads as edited on the pill and in the engine line', () => {
    render(<EntryProvenance entry={entry({ origin: 'PIQC_EDITED' })} notesById={notesById()} isLight />);
    expect(screen.getByTestId('entry-origin-pill').textContent).toBe('PIQC-drafted, edited');
    fireEvent.click(screen.getByTestId('entry-provenance-toggle'));
    expect(screen.getByTestId('entry-provenance-engine').textContent).toContain('accepted with edits by the auditor');
  });

  it('opening Sources shows note bodies (or unavailable), deduped passage locators in the shared format, the quote, and the engine', () => {
    render(<EntryProvenance entry={entry()} notesById={notesById()} isLight />);
    fireEvent.click(screen.getByTestId('entry-provenance-toggle'));
    const detail = screen.getByTestId('entry-provenance-detail');
    expect(detail.textContent).toContain('From 2 fieldwork notes');
    expect(detail.textContent).toContain('Fridge log gap 03–05 Sep');
    expect(detail.textContent).toContain('Note unavailable');
    // Cited by two evidence items, listed once, in formatProtocolRefWhere's format.
    expect(detail.textContent).toContain('From 1 filed-evidence passage');
    expect(screen.getAllByText(/Filed evidence · § 4.2 Excursions \(p\. 3\)/)).toHaveLength(1);
    expect(detail.textContent).toContain('Protocol requirement · § 6.3 Storage (p. 47)');
    expect(detail.textContent).toContain('“any excursion documented and reported to the sponsor”');
    expect(screen.getByTestId('entry-provenance-engine').textContent).toBe(
      'Drafted by gpt-4o-mini (audit-observation-draft); accepted verbatim by the auditor.',
    );
    expect(screen.getByTestId('entry-provenance-toggle').getAttribute('aria-expanded')).toBe('true');

    fireEvent.click(screen.getByTestId('entry-provenance-toggle'));
    expect(screen.queryByTestId('entry-provenance-detail')).toBeNull();
  });

  it('an evidence-only entry lists no notes section', () => {
    render(
      <EntryProvenance
        entry={entry({ source_note_ids: [], evidence_refs: [{ text: 'x', source_note_ids: [], source_passages: [PASSAGE] }], protocol_ref: null })}
        notesById={new Map()}
        isLight
      />,
    );
    expect(screen.getByTestId('entry-provenance-toggle').textContent).toBe('Sources · 1 filed passage');
    fireEvent.click(screen.getByTestId('entry-provenance-toggle'));
    expect(screen.queryByText(/fieldwork note/)).toBeNull();
    expect(screen.queryByText(/Protocol requirement/)).toBeNull();
  });
});
