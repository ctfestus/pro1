import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import {
  normalizeInstructorReport,
  normalizeInstructorReports,
  reportableRequirementIds,
} from '@/lib/ve-instructor-report';
import { extractDocxText, extractPptxText } from '@/lib/office-text';

describe('normalizeInstructorReport', () => {
  it('maps AI severities, clamps scores, and drops untitled rows', () => {
    const report = normalizeInstructorReport({
      score: 140,
      summary: '  Solid work  ',
      findings: [
        { location: 'Slide 2', severity: 'critical', title: 'Wrong total', detail: 'd', fix: 'f' },
        { severity: 'improvement', title: 'Labels', detail: '', fix: '' },
        { severity: 'bogus', title: 'Tone' },
        { severity: 'critical', title: '   ' },
      ],
      categories: [
        { name: 'Accuracy', score: -5, summary: 's', strengths: ['a', '', '  '], gaps: ['g'] },
        { name: '', score: 50 },
      ],
      recommendations: ['one', '', 'two'],
    });
    expect(report).not.toBeNull();
    expect(report!.score).toBe(100);
    expect(report!.summary).toBe('Solid work');
    expect(report!.findings.map(f => f.severity)).toEqual(['error', 'warning', 'suggestion']);
    expect(report!.categories).toEqual([{ name: 'Accuracy', score: 0, summary: 's', strengths: ['a'], gaps: ['g'] }]);
    expect(report!.recommendations).toEqual(['one', 'two']);
  });

  it('requires a score, and treats 0 as a real score', () => {
    expect(normalizeInstructorReport({ score: 80, summary: '', findings: [{ title: '' }] })!.score).toBe(80);
    expect(normalizeInstructorReport({ score: 0 })!.score).toBe(0);
    expect(normalizeInstructorReport({ score: null, summary: 'has text' })).toBeNull();
    expect(normalizeInstructorReport({ score: '', summary: 'has text' })).toBeNull();
    expect(normalizeInstructorReport({ summary: 'has text' })).toBeNull();
    expect(normalizeInstructorReport('nope')).toBeNull();
    expect(normalizeInstructorReport([])).toBeNull();
  });

  it('only keeps aiDrafted when it is literally true', () => {
    expect(normalizeInstructorReport({ score: 1, summary: 'x', aiDrafted: 'yes' })!.aiDrafted).toBeUndefined();
    expect(normalizeInstructorReport({ score: 1, summary: 'x', aiDrafted: true })!.aiDrafted).toBe(true);
  });
});

describe('normalizeInstructorReports', () => {
  const modules = [{ lessons: [{ requirements: [{ id: 'u1', type: 'upload' }, { id: 't1', type: 'text' }, { id: 'd1', type: 'deliverable' }, { id: 'k1', type: 'task' }] }] }];

  it('keeps reports only for upload steps in the VE', () => {
    const allowed = reportableRequirementIds(modules);
    expect([...allowed]).toEqual(['u1', 'd1']);
    const out = normalizeInstructorReports({ u1: { score: 1, summary: 'ok' }, t1: { score: 1, summary: 'no' }, ghost: { score: 1, summary: 'no' } }, allowed);
    expect(Object.keys(out)).toEqual(['u1']);
  });

  it('ignores non-object input', () => {
    expect(normalizeInstructorReports(null, new Set(['u1']))).toEqual({});
    expect(normalizeInstructorReports([{ summary: 'x' }], new Set(['0']))).toEqual({});
  });
});

describe('office text extraction', () => {
  it('reads paragraphs from a .docx', async () => {
    const zip = new JSZip();
    zip.file('word/document.xml',
      '<w:document><w:body><w:p><w:pPr/><w:r><w:t>Hello</w:t></w:r><w:r><w:t xml:space="preserve"> world &amp; co</w:t></w:r></w:p><w:p><w:r><w:t>Second</w:t></w:r></w:p></w:body></w:document>');
    const text = await extractDocxText(await zip.generateAsync({ type: 'arraybuffer' }));
    expect(text).toBe('Hello world & co\nSecond');
  });

  it('reads slides from a .pptx in slide order', async () => {
    const zip = new JSZip();
    zip.file('ppt/slides/slide10.xml', '<p:sld><a:p><a:r><a:t>Ten</a:t></a:r></a:p></p:sld>');
    zip.file('ppt/slides/slide2.xml', '<p:sld><a:p><a:r><a:t>Two</a:t></a:r></a:p></p:sld>');
    const text = await extractPptxText(await zip.generateAsync({ type: 'arraybuffer' }));
    expect(text).toBe('Slide 2:\nTwo\n\nSlide 10:\nTen');
  });

  it('rejects a zip that is not an Office file', async () => {
    const zip = new JSZip();
    zip.file('readme.txt', 'x');
    await expect(extractDocxText(await zip.generateAsync({ type: 'arraybuffer' }))).rejects.toThrow();
  });
});

describe('assertZipWithinLimit', () => {
  it('rejects an archive that unpacks past the limit, and accepts one under it', async () => {
    const { assertZipWithinLimit, ArchiveTooLargeError } = await import('@/lib/office-text');
    const zip = new JSZip();
    zip.file('word/document.xml', 'a'.repeat(5000));
    const buffer = await zip.generateAsync({ type: 'arraybuffer', compression: 'DEFLATE' });
    expect(buffer.byteLength).toBeLessThan(1000);
    await expect(assertZipWithinLimit(buffer, 4000)).rejects.toBeInstanceOf(ArchiveTooLargeError);
    await expect(assertZipWithinLimit(buffer, 10_000)).resolves.toBeUndefined();
  });
});

describe('worksheet lists on File Upload steps', () => {
  it('are cleaned on save like Excel Review steps', async () => {
    const { normalizeExperienceReviewSheetNames } = await import('@/lib/excel-review-config');
    const { modules, error } = normalizeExperienceReviewSheetNames([{ lessons: [{ requirements: [
      { id: 'u1', type: 'upload', reviewSheetNames: [' Summary ', '', 'summary', 'Data'] },
    ] }] }]);
    expect(error).toBeUndefined();
    expect(modules[0].lessons[0].requirements[0].reviewSheetNames).toEqual(['Summary', 'Data']);
  });
});

describe('isReportStale', () => {
  it('is stale only when the report names a different file', async () => {
    const { isReportStale } = await import('@/lib/ve-instructor-report');
    expect(isReportStale({ fileUrl: 'a' }, 'a')).toBe(false);
    expect(isReportStale({ fileUrl: 'a' }, 'b')).toBe(true);
    expect(isReportStale({ fileUrl: 'a' }, undefined)).toBe(true);
    expect(isReportStale({}, 'b')).toBe(false);
    expect(isReportStale(null, 'b')).toBe(false);
  });
});

describe('assertZipWithinLimit against a zip that lies about its size', () => {
  // A crafted archive declares a tiny unpacked size but really expands far past it. The guard must
  // stop on the real byte count, not trust the declared one.
  async function lyingZip(realBytes: number): Promise<ArrayBuffer> {
    const zip = new JSZip();
    zip.file('word/document.xml', 'a'.repeat(realBytes));
    const bytes = Buffer.from(await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' }));
    for (let i = 0; i < bytes.length - 4; i++) {
      const sig = bytes.readUInt32LE(i);
      if (sig === 0x04034b50) bytes.writeUInt32LE(100, i + 22);  // local file header: uncompressed size
      if (sig === 0x02014b50) bytes.writeUInt32LE(100, i + 24);  // central directory: uncompressed size
    }
    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  }

  it('rejects it by counting the bytes it really unpacks', async () => {
    const { assertZipWithinLimit, ArchiveTooLargeError } = await import('@/lib/office-text');
    const buffer = await lyingZip(5 * 1024 * 1024);
    await expect(assertZipWithinLimit(buffer, 1024 * 1024)).rejects.toBeInstanceOf(ArchiveTooLargeError);
  });
});

describe('assertZipWithinLimit with an empty part', () => {
  it('accepts a valid archive that contains a zero-byte entry', async () => {
    const { assertZipWithinLimit } = await import('@/lib/office-text');
    const zip = new JSZip();
    zip.file('word/document.xml', '<w:document/>');
    zip.file('customXml/empty.xml', '');
    const buffer = await zip.generateAsync({ type: 'arraybuffer', compression: 'DEFLATE' });
    await expect(assertZipWithinLimit(buffer, 10_000)).resolves.toBeUndefined();
  });
});
