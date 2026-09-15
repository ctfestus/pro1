import { describe, expect, it } from 'vitest';
import {
  normalizeRecordingAttachments,
  recordingAttachmentBadge,
  recordingAttachmentHref,
} from '@/lib/recording-attachments';

const STORAGE = 'https://proj.supabase.co/storage/v1/object/public/form-assets/recording-files/u/1.xlsx';

describe('normalizeRecordingAttachments', () => {
  it('returns an empty list for anything that is not an array', () => {
    expect(normalizeRecordingAttachments(null)).toEqual([]);
    expect(normalizeRecordingAttachments(undefined)).toEqual([]);
    expect(normalizeRecordingAttachments({ url: STORAGE })).toEqual([]);
  });

  it('keeps well-formed rows and drops ones with no usable destination', () => {
    const rows = normalizeRecordingAttachments([
      { id: 'a', name: 'Class workbook', url: STORAGE, kind: 'file', size: 2048 },
      { id: 'b', name: 'Reading', url: 'https://example.com/notes', kind: 'link', size: null },
      { id: 'c', name: 'Bad', url: 'javascript:alert(1)', kind: 'link' },
      { id: 'd', name: 'Missing url' },
      'not an object',
    ]);
    expect(rows.map(r => r.name)).toEqual(['Class workbook', 'Reading']);
  });

  it('infers the kind from the host when the stored row has none', () => {
    const [upload, link] = normalizeRecordingAttachments([
      { url: STORAGE },
      { url: 'https://drive.google.com/file/d/1/view' },
    ]);
    expect(upload.kind).toBe('file');
    expect(link.kind).toBe('link');
  });

  it('falls back to the file name in the URL when no name was saved', () => {
    const [row] = normalizeRecordingAttachments([{ url: STORAGE }]);
    expect(row.name).toBe('1.xlsx');
  });

  it('ignores sizes that are not positive numbers', () => {
    const rows = normalizeRecordingAttachments([
      { url: STORAGE, size: 0 },
      { url: STORAGE, size: '2048' },
      { url: STORAGE, size: 2048 },
    ]);
    expect(rows.map(r => r.size)).toEqual([null, null, 2048]);
  });
});

describe('student-facing destinations', () => {
  it('asks storage for a real download, and leaves external links alone', () => {
    const [upload] = normalizeRecordingAttachments([{ name: 'Class workbook.xlsx', url: STORAGE, kind: 'file' }]);
    expect(recordingAttachmentHref(upload)).toContain('download=Class+workbook.xlsx');

    const [link] = normalizeRecordingAttachments([{ name: 'Reading', url: 'https://example.com/notes', kind: 'link' }]);
    expect(recordingAttachmentHref(link)).toBe('https://example.com/notes');
  });

  it('badges by file type, falling back to the kind when there is no extension', () => {
    const [xlsx, link] = normalizeRecordingAttachments([
      { name: 'Class workbook.xlsx', url: STORAGE, kind: 'file' },
      { name: 'Reading', url: 'https://example.com/notes', kind: 'link' },
    ]);
    expect(recordingAttachmentBadge(xlsx)).toBe('XLSX');
    expect(recordingAttachmentBadge(link)).toBe('LINK');
  });
});
