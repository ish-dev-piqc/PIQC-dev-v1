import { formatProtocolRefWhere } from './isaReportModel';

// =============================================================================
// Filed-evidence passage locator (fieldwork lane) — "§ 4.2 Excursions (p. 3)".
//
// One function for the candidate panel and the observation record, so a
// passage reads identically wherever it is cited. Delegates the formatting
// to the shared protocol-citation locator (report, docx, clipboard, ISA card
// all use it) but decides "no locator" from the fields themselves: the
// shared formatter's no-locator fallback is the word "Protocol", which a
// vendor's filed document is not — and that word is the ISA lane's to
// change, so it is never compared against here.
// =============================================================================

export interface PassageLocatorFields {
  section_heading: string | null;
  page_start: number | null;
  page_end: number | null;
}

/** '' when the passage carries neither a section nor a page. */
export function formatPassageWhere(p: PassageLocatorFields): string {
  if (!p.section_heading && p.page_start === null) return '';
  return formatProtocolRefWhere({
    chunk_id: null,
    document_id: null,
    quote: '',
    section_heading: p.section_heading,
    page_start: p.page_start,
    page_end: p.page_end,
  });
}
