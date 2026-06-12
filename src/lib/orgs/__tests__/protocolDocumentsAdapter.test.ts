import { describe, expect, it } from 'vitest';
import {
  adaptProtocolDocument,
  fileFamily,
  formatBytes,
  type ProtocolDocumentRow,
} from '../protocolDocumentsAdapter';

const baseRow: ProtocolDocumentRow = {
  id: 'd-1',
  protocol_id: 'p-1',
  org_id: null,
  storage_path: 'p-1/abc-file.pdf',
  mime_type: 'application/pdf',
  size_bytes: 2_500_000,
  original_filename: 'file.pdf',
  uploaded_by_user_id: 'u-1',
  created_at: '2026-06-04T00:00:00Z',
};

describe('adaptProtocolDocument', () => {
  it('passes every column through', () => {
    const out = adaptProtocolDocument(baseRow);
    expect(out.id).toBe('d-1');
    expect(out.protocol_id).toBe('p-1');
    expect(out.org_id).toBeNull();
    expect(out.size_bytes).toBe(2_500_000);
  });
});

describe('formatBytes', () => {
  it('formats < 1KB as bytes', () => {
    expect(formatBytes(500)).toBe('500 B');
  });
  it('formats KB without decimals', () => {
    expect(formatBytes(50 * 1024)).toBe('50 KB');
  });
  it('formats MB with 1 decimal', () => {
    expect(formatBytes(2.5 * 1024 * 1024)).toBe('2.5 MB');
  });
  it('formats GB with 1 decimal', () => {
    expect(formatBytes(3 * 1024 * 1024 * 1024)).toBe('3.0 GB');
  });
});

describe('fileFamily', () => {
  it('identifies PDFs by mime', () => {
    expect(fileFamily('application/pdf', 'foo.pdf')).toBe('pdf');
  });
  it('identifies xlsx by mime + ext', () => {
    expect(
      fileFamily('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'a.xlsx'),
    ).toBe('xlsx');
  });
  it('identifies csv as xlsx-family', () => {
    expect(fileFamily('text/csv', 'a.csv')).toBe('xlsx');
  });
  it('identifies docx', () => {
    expect(
      fileFamily('application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'a.docx'),
    ).toBe('docx');
  });
  it('identifies images', () => {
    expect(fileFamily('image/png', 'a.png')).toBe('image');
  });
  it('falls back to other when nothing matches', () => {
    expect(fileFamily('application/zip', 'a.zip')).toBe('other');
  });
});
