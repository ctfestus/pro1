/**
 * Read a book's own table of contents in the browser, to pre-fill the chapter list in the editor.
 * Browser-only (DOMParser). The result is a suggestion the author edits before saving; the server
 * re-validates every chapter (lib/books/admin.ts chaptersFromInput).
 *
 *   EPUB  the EPUB 3 navigation document, else the EPUB 2 NCX, else the reading order
 *   HTML  <section data-chapter id>, else h1/h2 headings located by their own id or the id of the
 *         section that opens with them
 *   PDF   lib/books/pdf.ts (the PDF's bookmarks)
 *
 * When a file has no usable structure the editor asks AI instead (lib/books/chapter-suggestions.ts),
 * sending the outline built by htmlOutline / epubOutline here.
 *
 * EPUB hrefs are returned relative to the package document (the OPF), which is how epub.js
 * addresses sections.
 */
import JSZip from 'jszip';

export interface SuggestedChapter {
  title: string;
  locator: { href: string } | { anchor: string } | { pageStart: number; pageEnd?: number };
}

/** One outline item for the AI fallback, with the locator its index maps back to. */
export interface OutlineEntry {
  text: string;
  level?: number;
  locator: SuggestedChapter['locator'] | null;
}

const MAX_CHAPTERS = 500;
const MAX_OUTLINE = 1000;
const VALID_ID = /^[A-Za-z][\w:.-]*$/;
const CONTENTS_TITLE = /^(table of )?contents$/i;

function dirOf(path: string): string {
  const i = path.lastIndexOf('/');
  return i >= 0 ? path.slice(0, i + 1) : '';
}

/** Resolve `rel` against directory `base` ("a/b/") into a normalized zip path. */
function resolvePath(base: string, rel: string): string {
  const [pathPart, hash] = rel.split('#');
  const parts = (base + decodeURIComponent(pathPart)).split('/');
  const out: string[] = [];
  for (const p of parts) {
    if (p === '..') out.pop();
    else if (p !== '.' && p !== '') out.push(p);
  }
  return out.join('/') + (hash ? `#${hash}` : '');
}

/** Make a zip path relative to the package directory, as epub.js expects. */
function relativeTo(packageDir: string, zipPath: string): string {
  return packageDir && zipPath.startsWith(packageDir) ? zipPath.slice(packageDir.length) : zipPath;
}

function clean(text: string | null | undefined): string {
  return (text ?? '').replace(/\s+/g, ' ').trim().slice(0, 300);
}

function parseXml(source: string, type: DOMParserSupportedType = 'application/xml'): Document {
  return new DOMParser().parseFromString(source, type);
}

/** Elements by local name, ignoring XML namespaces (OPF, NCX and XHTML all use them). */
function byLocalName(root: Document | Element, name: string): Element[] {
  return Array.from(root.getElementsByTagName('*')).filter(el => el.localName === name);
}

function childrenByLocalName(el: Element, name: string): Element[] {
  return Array.from(el.children).filter(c => c.localName === name);
}

async function readText(zip: JSZip, path: string): Promise<string | null> {
  const file = zip.file(path);
  return file ? file.async('string') : null;
}

/** Top-level <li> of a nav list, dropping a lone wrapper item (a common "Contents" header). */
function topLevelItems(list: Element): Element[] {
  const items = childrenByLocalName(list, 'li');
  if (items.length === 1) {
    const inner = childrenByLocalName(items[0], 'ol')[0];
    if (inner) return childrenByLocalName(inner, 'li');
  }
  return items;
}

/**
 * The EPUB's chapters. fromToc is false when the book had no table of contents and the list is
 * just its reading order ("Section 1", "Section 2"...), which the editor treats as a weak result.
 */
export async function chaptersFromEpub(data: ArrayBuffer | Blob): Promise<{ chapters: SuggestedChapter[]; fromToc: boolean }> {
  const zip = await JSZip.loadAsync(data);
  const container = await readText(zip, 'META-INF/container.xml');
  if (!container) throw new Error('This file is not a valid EPUB.');
  const opfPath = byLocalName(parseXml(container), 'rootfile')[0]?.getAttribute('full-path');
  const opfSource = opfPath ? await readText(zip, opfPath) : null;
  if (!opfPath || !opfSource) throw new Error('This EPUB has no package document.');

  const opf = parseXml(opfSource);
  const packageDir = dirOf(opfPath);
  const manifest = new Map<string, { href: string; properties: string; type: string }>();
  for (const item of byLocalName(opf, 'item')) {
    const id = item.getAttribute('id');
    const href = item.getAttribute('href');
    if (id && href) {
      manifest.set(id, {
        href,
        properties: item.getAttribute('properties') ?? '',
        type: item.getAttribute('media-type') ?? '',
      });
    }
  }

  // EPUB 3 navigation document.
  const navItem = [...manifest.values()].find(m => m.properties.split(/\s+/).includes('nav'));
  if (navItem) {
    const navPath = resolvePath(packageDir, navItem.href);
    const navSource = await readText(zip, navPath.split('#')[0]);
    if (navSource) {
      const doc = parseXml(navSource, 'application/xhtml+xml');
      const navs = byLocalName(doc, 'nav');
      const toc = navs.find(n => (n.getAttribute('epub:type') ?? n.getAttributeNS('http://www.idpf.org/2007/ops', 'type') ?? '').includes('toc')) ?? navs[0];
      const list = toc ? childrenByLocalName(toc, 'ol')[0] : undefined;
      if (list) {
        const chapters: SuggestedChapter[] = [];
        for (const li of topLevelItems(list)) {
          const a = childrenByLocalName(li, 'a')[0];
          const href = a?.getAttribute('href');
          const title = clean(a?.textContent);
          if (!href || !title) continue;
          chapters.push({ title, locator: { href: relativeTo(packageDir, resolvePath(dirOf(navPath), href)) } });
          if (chapters.length >= MAX_CHAPTERS) break;
        }
        if (chapters.length) return { chapters, fromToc: true };
      }
    }
  }

  // EPUB 2 NCX.
  const spine = byLocalName(opf, 'spine')[0];
  const ncxId = spine?.getAttribute('toc');
  const ncxItem = (ncxId && manifest.get(ncxId)) || [...manifest.values()].find(m => m.type === 'application/x-dtbncx+xml');
  if (ncxItem) {
    const ncxPath = resolvePath(packageDir, ncxItem.href);
    const ncxSource = await readText(zip, ncxPath);
    if (ncxSource) {
      const navMap = byLocalName(parseXml(ncxSource), 'navMap')[0];
      const chapters: SuggestedChapter[] = [];
      for (const point of navMap ? childrenByLocalName(navMap, 'navPoint') : []) {
        const title = clean(byLocalName(point, 'text')[0]?.textContent);
        const src = childrenByLocalName(point, 'content')[0]?.getAttribute('src');
        if (!title || !src) continue;
        chapters.push({ title, locator: { href: relativeTo(packageDir, resolvePath(dirOf(ncxPath), src)) } });
        if (chapters.length >= MAX_CHAPTERS) break;
      }
      if (chapters.length) return { chapters, fromToc: true };
    }
  }

  // No table of contents: one chapter per reading-order document.
  const chapters: SuggestedChapter[] = [];
  for (const ref of spine ? childrenByLocalName(spine, 'itemref') : []) {
    const item = manifest.get(ref.getAttribute('idref') ?? '');
    if (!item) continue;
    chapters.push({ title: `Section ${chapters.length + 1}`, locator: { href: item.href } });
    if (chapters.length >= MAX_CHAPTERS) break;
  }
  return { chapters, fromToc: false };
}

/**
 * Where a heading can be linked to: its own id, else the id of the nearest enclosing element that
 * opens with it (a <section id="intro"> whose first heading it is). A wrapper around many headings
 * belongs to its first one only, so it cannot turn every heading into the same chapter.
 */
function anchorFor(h: Element): string | null {
  if (h.id && VALID_ID.test(h.id)) return h.id;
  for (let el = h.parentElement; el && el.localName !== 'body' && el.localName !== 'html'; el = el.parentElement) {
    if (el.id && VALID_ID.test(el.id)) return el.querySelector('h1, h2, h3, h4, h5, h6') === h ? el.id : null;
  }
  return null;
}

/** Inside a cover or title page (<section class="cover">, <div id="bookcover">...). */
function inCover(el: Element): boolean {
  for (let n: Element | null = el; n && n.localName !== 'body'; n = n.parentElement) {
    if (/cover|title-?page/i.test(`${n.id} ${n.getAttribute('class') ?? ''}`)) return true;
  }
  return false;
}

export function chaptersFromHtml(source: string): SuggestedChapter[] {
  const doc = parseXml(source, 'text/html');
  const chapters: SuggestedChapter[] = [];
  const sections = Array.from(doc.querySelectorAll('section[data-chapter][id]'));
  if (sections.length) {
    for (const el of sections) {
      const title = clean(el.getAttribute('data-chapter') || el.querySelector('h1, h2, h3')?.textContent || el.id);
      if (!title || !VALID_ID.test(el.id)) continue;
      chapters.push({ title, locator: { anchor: el.id } });
      if (chapters.length >= MAX_CHAPTERS) break;
    }
    return chapters;
  }
  // h1 chapters when the book has several; else h1 and h2 together (one h1 is usually the title).
  // The cover is not a chapter: headings inside an element named like a cover, and a heading that
  // only repeats the book's title, are left out.
  const bookTitle = clean(doc.title).toLowerCase();
  const located = (selector: string) => Array.from(doc.querySelectorAll(selector))
    .filter(h => !inCover(h) && !(bookTitle && clean(h.textContent).toLowerCase() === bookTitle))
    .map(h => ({ title: clean(h.textContent), anchor: anchorFor(h) }))
    .filter((c): c is { title: string; anchor: string } => !!c.title && !!c.anchor && !CONTENTS_TITLE.test(c.title));
  const h1s = located('h1');
  const picked = h1s.length >= 2 ? h1s : located('h1, h2');
  const seen = new Set<string>();
  for (const c of picked) {
    if (seen.has(c.anchor)) continue;
    seen.add(c.anchor);
    chapters.push({ title: c.title, locator: { anchor: c.anchor } });
    if (chapters.length >= MAX_CHAPTERS) break;
  }
  return chapters;
}

/** Every heading of an HTML book, for the AI fallback. Headings that cannot be linked carry no locator. */
export function htmlOutline(source: string): OutlineEntry[] {
  const doc = parseXml(source, 'text/html');
  return Array.from(doc.querySelectorAll('h1, h2, h3, h4'))
    .map(h => {
      const anchor = anchorFor(h);
      return { text: clean(h.textContent).slice(0, 200), level: Number(h.localName.slice(1)), locator: anchor ? { anchor } : null };
    })
    .filter(e => e.text)
    .slice(0, MAX_OUTLINE);
}

/** One entry per reading-order document of an EPUB, shown by its first heading or opening words. */
export async function epubOutline(data: ArrayBuffer | Blob): Promise<OutlineEntry[]> {
  const zip = await JSZip.loadAsync(data);
  const container = await readText(zip, 'META-INF/container.xml');
  const opfPath = container ? byLocalName(parseXml(container), 'rootfile')[0]?.getAttribute('full-path') : null;
  const opfSource = opfPath ? await readText(zip, opfPath) : null;
  if (!opfPath || !opfSource) throw new Error('This EPUB has no package document.');
  const opf = parseXml(opfSource);
  const packageDir = dirOf(opfPath);
  const hrefs = new Map<string, string>();
  for (const item of byLocalName(opf, 'item')) {
    const id = item.getAttribute('id');
    const href = item.getAttribute('href');
    if (id && href) hrefs.set(id, href);
  }
  const out: OutlineEntry[] = [];
  const spine = byLocalName(opf, 'spine')[0];
  for (const ref of spine ? childrenByLocalName(spine, 'itemref') : []) {
    const href = hrefs.get(ref.getAttribute('idref') ?? '');
    if (!href) continue;
    const source = await readText(zip, resolvePath(packageDir, href));
    let text = '';
    if (source) {
      const doc = parseXml(source, 'application/xhtml+xml');
      const heading = byLocalName(doc, 'h1')[0] ?? byLocalName(doc, 'h2')[0] ?? byLocalName(doc, 'h3')[0];
      const body = byLocalName(doc, 'body')[0];
      text = clean(heading?.textContent) || clean(body?.textContent).slice(0, 160) || clean(byLocalName(doc, 'title')[0]?.textContent);
    }
    out.push({ text: text.slice(0, 200), locator: { href } });
    if (out.length >= MAX_OUTLINE) break;
  }
  return out;
}

/**
 * The self-contained rule for HTML books: everything inline. Returns the external references found
 * (scripts, styles, images, frames loaded from elsewhere), so the editor can warn before upload.
 */
export function externalReferencesInHtml(source: string): string[] {
  const doc = parseXml(source, 'text/html');
  const found = new Set<string>();
  const check = (value: string | null) => {
    if (value && /^(https?:)?\/\//i.test(value.trim())) found.add(value.trim().slice(0, 200));
  };
  doc.querySelectorAll('script[src], img[src], iframe[src], audio[src], video[src], source[src], embed[src]')
    .forEach(el => check(el.getAttribute('src')));
  doc.querySelectorAll('link[href]').forEach(el => check(el.getAttribute('href')));
  return [...found].slice(0, 20);
}
