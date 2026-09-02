import { describe, it, expect } from 'vitest';
import { formatPassageWhere } from '../passageLocator';

describe('formatPassageWhere', () => {
  it('formats section and pages exactly like the shared protocol-citation locator', () => {
    expect(formatPassageWhere({ section_heading: '4.2 Excursions', page_start: 3, page_end: 3 })).toBe(
      '§ 4.2 Excursions (p. 3)',
    );
    expect(formatPassageWhere({ section_heading: '4.2 Excursions', page_start: 3, page_end: 5 })).toBe(
      '§ 4.2 Excursions (p. 3–5)',
    );
    expect(formatPassageWhere({ section_heading: null, page_start: 12, page_end: null })).toBe('p. 12');
    expect(formatPassageWhere({ section_heading: 'Scope', page_start: null, page_end: null })).toBe('§ Scope');
  });

  it("a passage with neither section nor page yields '' — never the protocol fallback word", () => {
    expect(formatPassageWhere({ section_heading: null, page_start: null, page_end: null })).toBe('');
    expect(formatPassageWhere({ section_heading: '', page_start: null, page_end: 4 })).toBe('');
  });
});
