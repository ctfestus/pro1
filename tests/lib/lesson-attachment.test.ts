import { describe, expect, it } from 'vitest';
import {
  attachmentDownloadUrl,
  attachmentExtension,
  fileNameFromUrl,
  formatAttachmentSize,
  safeAttachmentUrl,
} from '@/lib/lesson-attachment';

describe('attachment destinations', () => {
  it('accepts web URLs and same-origin paths, rejects executable ones', () => {
    expect(safeAttachmentUrl('https://example.com/workbook.xlsx')).toBe('https://example.com/workbook.xlsx');
    expect(safeAttachmentUrl('/files/brief.pdf')).toBe('/files/brief.pdf');
    expect(safeAttachmentUrl('javascript:alert(1)')).toBeNull();
    expect(safeAttachmentUrl('')).toBeNull();
  });
});

describe('attachment naming', () => {
  it('reads the extension from the name first, then the URL', () => {
    expect(attachmentExtension('Campaign Calendar.xlsx')).toBe('XLSX');
    expect(attachmentExtension('', 'https://example.com/a/brief.pdf')).toBe('PDF');
    expect(attachmentExtension('', 'https://example.com/a/brief.pdf?download=brief.pdf')).toBe('PDF');
    expect(attachmentExtension('no extension here')).toBe('');
  });

  it('falls back to the last path segment for a name', () => {
    expect(fileNameFromUrl('https://example.com/files/Q3%20Report.xlsx')).toBe('Q3 Report.xlsx');
    expect(fileNameFromUrl('https://example.com/files/brief.pdf?v=2')).toBe('brief.pdf');
    expect(fileNameFromUrl('https://example.com/')).toBe('example.com');
  });
});

describe('attachment sizes', () => {
  it('formats bytes, and omits unknown sizes entirely', () => {
    expect(formatAttachmentSize(900)).toBe('900 B');
    expect(formatAttachmentSize(254_000)).toBe('248 KB');
    expect(formatAttachmentSize(1_258_291)).toBe('1.2 MB');
    expect(formatAttachmentSize(null)).toBe('');
    expect(formatAttachmentSize(0)).toBe('');
  });
});

describe('attachment download URLs', () => {
  const supabase = 'https://abc.supabase.co/storage/v1/object/public/form-assets/lesson-files/u1/1712.xlsx';

  it('asks Supabase Storage to send the file under the author filename', () => {
    expect(attachmentDownloadUrl(supabase, 'Campaign Calendar.xlsx'))
      .toBe(`${supabase}?download=Campaign+Calendar.xlsx`);
  });

  it('leaves other hosts untouched', () => {
    expect(attachmentDownloadUrl('https://example.com/brief.pdf', 'brief.pdf'))
      .toBe('https://example.com/brief.pdf');
  });
});
