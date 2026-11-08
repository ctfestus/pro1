/**
 * PDF helpers for the book editor. Browser-only, and both libraries are imported on first use so
 * they only ever load in the editor, when a PDF is actually being read:
 *   pdf.js  (pdfjs-dist) reads the bookmarks and each page's opening words
 *   pdf-lib cuts a page range into a new file for the free sample
 *
 * Every call takes its own copy of the bytes: pdf.js transfers the buffer it is given to its
 * worker, which would leave the caller holding an empty one.
 */
import type { OutlineEntry, SuggestedChapter } from '@/lib/books/chapters';
import type { BookFormat } from '@/lib/books/schema';

const MAX_OUTLINE = 1000;

async function openWithPdfJs(data: ArrayBuffer) {
  const pdfjs = await import('pdfjs-dist');
  if (!pdfjs.GlobalWorkerOptions.workerSrc) {
    pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString();
  }
  const task = pdfjs.getDocument({ data: new Uint8Array(data.slice(0)) });
  try {
    const doc = await task.promise;
    return { doc, close: () => task.destroy() };
  } catch (e: any) {
    await task.destroy().catch(() => {});
    if (e?.name === 'PasswordException') throw new Error('This PDF is password-protected, so it cannot be read.');
    throw new Error('This PDF could not be read.');
  }
}

/**
 * Chapters from the PDF's own bookmarks (its outline): the top-level entries, each running to the
 * page before the next one starts. Empty when the PDF has no bookmarks.
 */
export async function pdfChapters(data: ArrayBuffer): Promise<{ chapters: SuggestedChapter[]; pageCount: number }> {
  const { doc, close } = await openWithPdfJs(data);
  try {
    const outline = (await doc.getOutline()) ?? [];
    const starts: { title: string; page: number }[] = [];
    for (const item of outline) {
      try {
        const dest = typeof item.dest === 'string' ? await doc.getDestination(item.dest) : item.dest;
        const ref = Array.isArray(dest) ? dest[0] : null;
        if (!ref) continue;
        const page = typeof ref === 'number' ? ref + 1 : (await doc.getPageIndex(ref)) + 1;
        const title = String(item.title ?? '').replace(/\s+/g, ' ').trim().slice(0, 300);
        if (title && page >= 1 && page <= doc.numPages) starts.push({ title, page });
      } catch {
        // A bookmark pointing nowhere (or at a missing page) is skipped, not fatal.
      }
    }
    starts.sort((a, b) => a.page - b.page);
    return { chapters: startsToChapters(starts, doc.numPages), pageCount: doc.numPages };
  } finally {
    await close();
  }
}

/** Chapter starts to page ranges: each chapter ends where the next begins. */
export function startsToChapters(starts: { title: string; page: number }[], pageCount: number): SuggestedChapter[] {
  return starts.map((s, i) => {
    const next = starts[i + 1]?.page ?? pageCount + 1;
    const end = Math.max(s.page, next - 1);
    return { title: s.title, locator: end > s.page ? { pageStart: s.page, pageEnd: end } : { pageStart: s.page } };
  });
}

/**
 * AI picks (indices into the outline that was sent) to chapters. PDF picks are pages, run to the
 * next pick. Elsewhere each pick takes its outline item's locator; a pick whose item has none, or
 * that points outside the outline, is dropped -- a chapter is never saved without a location.
 */
export function chaptersFromPicks(
  format: BookFormat,
  picks: { index: number; title: string }[],
  outline: OutlineEntry[],
  pageCount: number | null,
): SuggestedChapter[] {
  const valid = picks.filter(p => Number.isInteger(p.index) && p.index >= 0 && p.index < outline.length && p.title);
  if (format === 'pdf') return startsToChapters(valid.map(p => ({ title: p.title, page: p.index + 1 })), pageCount ?? outline.length);
  return valid.flatMap(p => {
    const locator = outline[p.index].locator;
    return locator ? [{ title: p.title, locator }] : [];
  });
}

/** One entry per page with its opening words, for the AI fallback. */
export async function pdfOutline(data: ArrayBuffer): Promise<{ outline: OutlineEntry[]; pageCount: number }> {
  const { doc, close } = await openWithPdfJs(data);
  try {
    const outline: OutlineEntry[] = [];
    const pages = Math.min(doc.numPages, MAX_OUTLINE);
    for (let n = 1; n <= pages; n++) {
      const page = await doc.getPage(n);
      const content = await page.getTextContent();
      const text = content.items
        .map(item => ('str' in item ? item.str : ''))
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 110);
      outline.push({ text, locator: { pageStart: n } });
      page.cleanup();
    }
    return { outline, pageCount: doc.numPages };
  } finally {
    await close();
  }
}

/** Number of pages, for the sample range hint. */
export async function pdfPageCount(data: ArrayBuffer): Promise<number> {
  const { PDFDocument } = await import('pdf-lib');
  const doc = await PDFDocument.load(data.slice(0), { ignoreEncryption: true, updateMetadata: false });
  return doc.getPageCount();
}

/** A new PDF holding pages from..to (1-based, inclusive) of the book. */
export async function cutPdfSample(data: ArrayBuffer, from: number, to: number): Promise<Blob> {
  const { PDFDocument } = await import('pdf-lib');
  let source;
  try {
    source = await PDFDocument.load(data.slice(0), { updateMetadata: false });
  } catch (e: any) {
    if (/encrypt/i.test(String(e?.message ?? e))) {
      throw new Error('This PDF is password-protected, so a sample cannot be cut from it. Upload a sample file instead.');
    }
    throw new Error('This PDF could not be read to cut a sample. Upload a sample file instead.');
  }
  const count = source.getPageCount();
  if (from > count) throw new Error(`The book has ${count} pages, so the sample cannot start on page ${from}.`);
  const last = Math.min(to, count);
  if (from === 1 && last === count) throw new Error('That range is the whole book. Choose fewer pages for the sample.');
  const sample = await PDFDocument.create();
  const pages = await sample.copyPages(source, Array.from({ length: last - from + 1 }, (_, i) => from - 1 + i));
  pages.forEach(p => sample.addPage(p));
  const title = source.getTitle();
  if (title) sample.setTitle(`${title} (sample)`);
  const bytes = await sample.save();
  return new Blob([bytes as BlobPart], { type: 'application/pdf' });
}
