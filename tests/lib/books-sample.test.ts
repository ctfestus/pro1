import { describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { chaptersFromPicks, cutPdfSample, startsToChapters } from '@/lib/books/pdf';
import { parseSampleSpec } from '@/lib/books/schema';
import { bookColumnsFromInput } from '@/lib/books/admin';

async function pdfWithPages(n: number): Promise<ArrayBuffer> {
  const doc = await PDFDocument.create();
  doc.setTitle('Field Guide');
  for (let i = 0; i < n; i++) doc.addPage([200 + i, 300]); // widths tell the pages apart
  const bytes = await doc.save();
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

describe('cutPdfSample', () => {
  it('keeps exactly the requested pages, in order', async () => {
    const sample = await cutPdfSample(await pdfWithPages(30), 3, 7);
    const doc = await PDFDocument.load(await sample.arrayBuffer());
    expect(doc.getPageCount()).toBe(5);
    expect(doc.getPages().map(p => p.getWidth())).toEqual([202, 203, 204, 205, 206]);
    expect(doc.getTitle()).toBe('Field Guide (sample)');
    expect(sample.type).toBe('application/pdf');
  });

  it('stops at the last page when the range runs past it', async () => {
    const doc = await PDFDocument.load(await (await cutPdfSample(await pdfWithPages(12), 5, 40)).arrayBuffer());
    expect(doc.getPageCount()).toBe(8);
  });

  it('refuses a range that is the whole book or starts past the end', async () => {
    await expect(cutPdfSample(await pdfWithPages(8), 1, 10)).rejects.toThrow('whole book');
    await expect(cutPdfSample(await pdfWithPages(8), 9, 10)).rejects.toThrow('has 8 pages');
  });

  it('leaves the caller\'s bytes usable', async () => {
    const data = await pdfWithPages(5);
    await cutPdfSample(data, 1, 2);
    expect(data.byteLength).toBeGreaterThan(0);
    await expect(cutPdfSample(data, 2, 3)).resolves.toBeInstanceOf(Blob);
  });
});

describe('startsToChapters', () => {
  it('runs each chapter to the page before the next one', () => {
    expect(startsToChapters([{ title: 'One', page: 1 }, { title: 'Two', page: 5 }, { title: 'Three', page: 6 }], 9)).toEqual([
      { title: 'One', locator: { pageStart: 1, pageEnd: 4 } },
      { title: 'Two', locator: { pageStart: 5 } },
      { title: 'Three', locator: { pageStart: 6, pageEnd: 9 } },
    ]);
  });
});

describe('chaptersFromPicks', () => {
  it('never turns a pick without a location into a blank one', () => {
    const outline = [
      { text: 'Intro', level: 2, locator: { anchor: 'intro' } },
      { text: 'Loose heading', level: 2, locator: null },
      { text: 'Part 1', level: 2, locator: { anchor: 'part-1' } },
    ];
    const picks = [{ index: 0, title: 'Intro' }, { index: 1, title: 'Loose' }, { index: 2, title: 'Part 1' }, { index: 9, title: 'Gone' }];
    expect(chaptersFromPicks('html', picks, outline, null)).toEqual([
      { title: 'Intro', locator: { anchor: 'intro' } },
      { title: 'Part 1', locator: { anchor: 'part-1' } },
    ]);
  });

  it('maps PDF picks to page ranges', () => {
    const outline = Array.from({ length: 20 }, (_, i) => ({ text: `p${i + 1}`, locator: { pageStart: i + 1 } }));
    expect(chaptersFromPicks('pdf', [{ index: 0, title: 'A' }, { index: 9, title: 'B' }], outline, 20)).toEqual([
      { title: 'A', locator: { pageStart: 1, pageEnd: 9 } },
      { title: 'B', locator: { pageStart: 10, pageEnd: 20 } },
    ]);
  });
});

describe('sample spec', () => {
  it('accepts a page range or a chapter count, nothing else', () => {
    expect(parseSampleSpec({ pages: { from: 1, to: 10 } })).toEqual({ pages: { from: 1, to: 10 } });
    expect(parseSampleSpec({ chapters: 2 })).toEqual({ chapters: 2 });
    expect(parseSampleSpec({ pages: { from: 5, to: 2 } })).toBeNull();
    expect(parseSampleSpec({ pages: { from: 0, to: 2 } })).toBeNull();
    expect(parseSampleSpec({ chapters: 1.5 })).toBeNull();
    expect(parseSampleSpec({ chapters: '2' })).toBeNull();
    expect(parseSampleSpec([])).toBeNull();
    expect(parseSampleSpec(null)).toBeNull();
  });

  it('is saved only when sent, and cleared by anything invalid', () => {
    expect(bookColumnsFromInput({ title: 'x' })).not.toHaveProperty('sample_spec');
    expect(bookColumnsFromInput({ sampleSpec: { chapters: 3, extra: true } }).sample_spec).toEqual({ chapters: 3 });
    expect(bookColumnsFromInput({ sampleSpec: null }).sample_spec).toBeNull();
    expect(bookColumnsFromInput({ sampleSpec: { pages: { from: 'a' } } }).sample_spec).toBeNull();
  });
});
