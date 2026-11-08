/**
 * Cut a free sample out of an EPUB or HTML book: everything before the chapter the sample stops
 * at. Browser-only (DOMParser). PDF samples are cut by page range in lib/books/pdf.ts.
 *
 * The sample must not carry the rest of the book, and cutting the page is not enough on its own:
 * a book can keep its text somewhere other than the chapter it belongs to (a JSON script in
 * <head>, a <template>, a hidden element, an attribute, an EPUB script file). So:
 *   1. Content after the cut is removed (HTML: the element where the next chapter starts and
 *      everything after it; EPUB: the later reading-order documents, plus the end of the document
 *      the cut falls inside, and media only they used).
 *   2. Everything that carries content without showing it is stripped from what is left, before
 *      the cut too: scripts of every type, templates, noscript, frames, objects and embeds,
 *      comments, on* handlers and javascript: links. EPUB script files and files the package does
 *      not list are dropped. The sample is static: a book's scripts do not run in it.
 *   3. The result is checked, and the cut refused, when isolation cannot be confirmed: text from
 *      the left-out chapters still found anywhere in the sample's source; a large encoded payload
 *      (base64 or an oversized attribute) that is not an image or a font; or, for HTML, almost no
 *      visible text left (a book that builds its pages with scripts). The author is then asked to
 *      upload a sample file instead.
 */
import JSZip from 'jszip';

const UPLOAD_INSTEAD = 'Upload a sample file instead.';
const PAYLOAD_ELEMENTS = ['script', 'template', 'noscript', 'iframe', 'frame', 'object', 'embed', 'applet'];
const SHOW_COMMENT = 128; // NodeFilter.SHOW_COMMENT

/** Remove `start` and everything after it in document order, up to the end of <body>. */
function truncateFrom(start: Element): void {
  for (let node: Node | null = start; node && node.parentNode; node = node.parentNode) {
    const parent: Node = node.parentNode;
    if ((parent as Element).localName === 'html') break;
    while (node.nextSibling) parent.removeChild(node.nextSibling);
    if ((parent as Element).localName === 'body') break;
  }
  start.parentNode?.removeChild(start);
}

/** The text truncateFrom(start) would remove. Read before cutting. */
function textFrom(start: Element): string {
  const parts = [start.textContent ?? ''];
  for (let node: Node = start; node.parentNode; node = node.parentNode) {
    const parent = node.parentNode as Element;
    if (parent.localName === 'html') break;
    for (let sib = node.nextSibling; sib; sib = sib.nextSibling) parts.push(sib.textContent ?? '');
    if (parent.localName === 'body') break;
  }
  return parts.join(' ');
}

/** Strip everything that can hold content without displaying it. Returns true if a script went. */
function stripPayloads(doc: Document): boolean {
  let hadScript = false;
  for (const name of PAYLOAD_ELEMENTS) {
    for (const el of byLocalName(doc, name)) {
      if (name === 'script') hadScript = true;
      el.parentNode?.removeChild(el);
    }
  }
  const comments: Node[] = [];
  const walker = doc.createTreeWalker(doc, SHOW_COMMENT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) comments.push(n);
  comments.forEach(c => c.parentNode?.removeChild(c));
  for (const el of Array.from(doc.getElementsByTagName('*'))) {
    for (const attr of Array.from(el.attributes)) {
      if (/^on/i.test(attr.localName) || /^\s*javascript:/i.test(attr.value)) el.removeAttribute(attr.name);
    }
  }
  return hadScript;
}

const normalize = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const PROBES = 24;
const PROBE_CHARS = 50;
const MIN_EXCLUDED_CHARS = 300;
const MAX_PAYLOAD_CHARS = 4096;
// Images and fonts may be embedded; nothing else of any size is.
const EMBEDDED_ASSET = /data:(?:image\/|font\/|application\/(?:x-)?font)[^,;]*(?:;[^,]*)?,/gi;
// The same, with its data, for measuring what else an attribute holds.
const EMBEDDED_ASSET_WITH_DATA = /data:(?:image\/|font\/|application\/(?:x-)?font)[^"')\s]*/gi;

/**
 * Throw unless the sample source holds none of the left-out text and no large hidden payload.
 * `excluded` is the text of everything that was cut; `sample` the sample's full source.
 */
function assertIsolated(excluded: string, sample: string): void {
  const leftOut = normalize(excluded);
  if (leftOut.length >= MIN_EXCLUDED_CHARS) {
    const haystack = normalize(sample);
    const step = Math.max(1, Math.floor((leftOut.length - PROBE_CHARS) / PROBES));
    let checked = 0;
    let found = 0;
    for (let at = 0; at + PROBE_CHARS <= leftOut.length && checked < PROBES; at += step) {
      const probe = leftOut.slice(at, at + PROBE_CHARS).trim();
      if (probe.split(' ').length < 4) continue; // too little text to tell anything apart
      checked += 1;
      if (haystack.includes(probe)) found += 1;
    }
    if (checked && found / checked >= 0.25) {
      throw new Error(`Text from the chapters left out of the sample is stored elsewhere in this book, so a sample cannot be cut from it safely. ${UPLOAD_INSTEAD}`);
    }
  }
  // An encoded blob the page cannot show, but anyone could decode, is refused the same way.
  const runs = sample.matchAll(new RegExp(`[A-Za-z0-9+/=_-]{${MAX_PAYLOAD_CHARS},}`, 'g'));
  for (const m of runs) {
    const before = sample.slice(Math.max(0, (m.index ?? 0) - 80), m.index);
    if (!new RegExp(`${EMBEDDED_ASSET.source}$`, 'i').test(before)) {
      throw new Error(`This book contains encoded data that may hold the rest of the book, so a sample cannot be cut from it safely. ${UPLOAD_INSTEAD}`);
    }
  }
}

/** Refuse oversized attribute values that are not embedded images or fonts. */
function assertNoLargeAttributes(doc: Document): void {
  for (const el of Array.from(doc.getElementsByTagName('*'))) {
    for (const attr of Array.from(el.attributes)) {
      if (attr.value.length > MAX_PAYLOAD_CHARS && attr.value.replace(EMBEDDED_ASSET_WITH_DATA, '').length > MAX_PAYLOAD_CHARS) {
        throw new Error(`This book stores data in its markup that may hold the rest of the book, so a sample cannot be cut from it safely. ${UPLOAD_INSTEAD}`);
      }
    }
  }
}

/**
 * The HTML book up to (not including) the element with id `stopAnchor`, where the first chapter
 * left out of the sample starts. Static: the book's scripts are not carried over.
 */
export function cutHtmlSample(source: string, stopAnchor: string): string {
  const doc = new DOMParser().parseFromString(source, 'text/html');
  const stop = doc.getElementById(stopAnchor);
  if (!stop) throw new Error('The chapter the sample stops at was not found in the book. Find the chapters again, then save.');
  const excluded = textFrom(stop);
  truncateFrom(stop);
  const hadScript = stripPayloads(doc);
  if (normalize(doc.body?.textContent ?? '').length < 200) {
    throw new Error(hadScript
      ? `This book builds its pages with scripts, so a readable sample cannot be cut from it. ${UPLOAD_INSTEAD}`
      : 'The sample would be almost empty. Include more chapters.');
  }
  assertNoLargeAttributes(doc);
  const out = `<!DOCTYPE html>\n${doc.documentElement.outerHTML}`;
  assertIsolated(excluded, out);
  return out;
}

function dirOf(path: string): string {
  const i = path.lastIndexOf('/');
  return i >= 0 ? path.slice(0, i + 1) : '';
}

function resolvePath(base: string, rel: string): string {
  const parts = (base + decodeURIComponent(rel.split('#')[0].split('?')[0])).split('/');
  const out: string[] = [];
  for (const p of parts) {
    if (p === '..') out.pop();
    else if (p !== '.' && p !== '') out.push(p);
  }
  return out.join('/');
}

function byLocalName(root: Document | Element, name: string): Element[] {
  return Array.from(root.getElementsByTagName('*')).filter(el => el.localName === name);
}

const XML_DECL = '<?xml version="1.0" encoding="UTF-8"?>\n';
const isMedia = (type: string) => /^(image|audio|video)\//.test(type);

/**
 * The EPUB up to (not including) `stopHref`, the location where the first chapter left out of the
 * sample starts (a path relative to the package document, optionally with #fragment).
 */
export async function cutEpubSample(data: ArrayBuffer | Blob, stopHref: string): Promise<Blob> {
  const zip = await JSZip.loadAsync(data);
  const container = await zip.file('META-INF/container.xml')?.async('string');
  const opfPath = container ? byLocalName(new DOMParser().parseFromString(container, 'application/xml'), 'rootfile')[0]?.getAttribute('full-path') : null;
  const opfSource = opfPath ? await zip.file(opfPath)?.async('string') : null;
  if (!opfPath || !opfSource) throw new Error('This EPUB has no package document.');
  const opf = new DOMParser().parseFromString(opfSource, 'application/xml');
  const packageDir = dirOf(opfPath);

  const items = new Map<string, Element>();
  for (const item of byLocalName(opf, 'item')) {
    const id = item.getAttribute('id');
    if (id) items.set(id, item);
  }
  const spine = byLocalName(opf, 'spine')[0];
  const refs = spine ? byLocalName(spine, 'itemref') : [];
  const pathOf = (item: Element | undefined) => (item ? resolvePath(packageDir, item.getAttribute('href') ?? '') : '');

  const [stopFile, fragment] = stopHref.split('#');
  const stopPath = resolvePath(packageDir, stopFile);
  const stopIndex = refs.findIndex(r => pathOf(items.get(r.getAttribute('idref') ?? '')) === stopPath);
  if (stopIndex < 0) throw new Error('The chapter the sample stops at was not found in the book. Find the chapters again, then save.');
  if (stopIndex === 0 && !fragment) throw new Error('The sample would be empty. Include at least one chapter.');

  // Text of everything cut, for the isolation check at the end.
  const excluded: string[] = [];
  const bodyText = (source: string) => {
    const doc = new DOMParser().parseFromString(source, 'application/xhtml+xml');
    return byLocalName(doc, 'body')[0]?.textContent ?? '';
  };

  // The document the cut falls inside keeps what comes before the next chapter.
  let firstDropped = stopIndex;
  if (fragment) {
    const source = await zip.file(stopPath)?.async('string');
    const doc = source ? new DOMParser().parseFromString(source, 'application/xhtml+xml') : null;
    const stop = doc?.getElementById(fragment) ?? null;
    if (doc && stop) {
      excluded.push(textFrom(stop));
      truncateFrom(stop);
      // Keep the document only if something is left before the cut; else it goes with the rest.
      const body = byLocalName(doc, 'body')[0];
      const left = !!body && (!!body.textContent?.trim() || byLocalName(body, 'img').length + byLocalName(body, 'svg').length > 0);
      if (left) {
        zip.file(stopPath, XML_DECL + new XMLSerializer().serializeToString(doc).replace(/^<\?xml[^>]*>\s*/, ''));
        firstDropped = stopIndex + 1;
      } else if (source) {
        excluded.push(bodyText(source));
      }
    }
  }
  if (firstDropped === 0) throw new Error('The sample would be empty. Include at least one chapter.');

  // Reading-order documents after the cut leave the archive and the package.
  for (const ref of refs.slice(firstDropped)) {
    const id = ref.getAttribute('idref') ?? '';
    const item = items.get(id);
    ref.parentNode?.removeChild(ref);
    if (item && !(item.getAttribute('properties') ?? '').split(/\s+/).includes('nav')) {
      const dropped = await zip.file(pathOf(item))?.async('string');
      if (dropped) excluded.push(bodyText(dropped));
      zip.remove(pathOf(item));
      item.parentNode?.removeChild(item);
      items.delete(id);
    }
  }

  // Media only the dropped documents used goes too. Anything still mentioned by a remaining
  // document or stylesheet stays (a cover named in the package metadata is kept as well).
  const mentioned = new Set<string>();
  const coverId = byLocalName(opf, 'meta').find(m => m.getAttribute('name') === 'cover')?.getAttribute('content');
  for (const item of items.values()) {
    if (isMedia(item.getAttribute('media-type') ?? '')) continue;
    const path = pathOf(item);
    const text = await zip.file(path)?.async('string');
    if (!text) continue;
    for (const m of text.matchAll(/(?:src|href|xlink:href|poster)\s*=\s*["']([^"']+)["']|url\(\s*["']?([^"')]+)["']?\s*\)/g)) {
      const ref = m[1] ?? m[2];
      if (ref && !/^[a-z]+:/i.test(ref)) mentioned.add(resolvePath(dirOf(path), ref));
    }
  }
  for (const [id, item] of items) {
    const props = (item.getAttribute('properties') ?? '').split(/\s+/);
    if (!isMedia(item.getAttribute('media-type') ?? '') || props.includes('cover-image') || id === coverId) continue;
    const path = pathOf(item);
    if (mentioned.has(path)) continue;
    zip.remove(path);
    item.parentNode?.removeChild(item);
  }

  // Scripts go (files and inline), along with every other content carrier, so the sample is
  // static; files the package does not list are dropped, since nothing should be riding along.
  for (const [id, item] of items) {
    if (!/(java|ecma)script/i.test(item.getAttribute('media-type') ?? '')) continue;
    zip.remove(pathOf(item));
    item.parentNode?.removeChild(item);
    items.delete(id);
  }
  const sampleSources: string[] = [];
  for (const item of items.values()) {
    const type = item.getAttribute('media-type') ?? '';
    const path = pathOf(item);
    if (!/xhtml|html/i.test(type)) {
      if (!isMedia(type) && !/font/i.test(type)) {
        const text = await zip.file(path)?.async('string');
        if (text) sampleSources.push(text);
      }
      continue;
    }
    const source = await zip.file(path)?.async('string');
    if (!source) continue;
    const doc = new DOMParser().parseFromString(source, 'application/xhtml+xml');
    stripPayloads(doc);
    assertNoLargeAttributes(doc);
    const props = (item.getAttribute('properties') ?? '').split(/\s+/).filter(p => p && p !== 'scripted');
    if (props.length) item.setAttribute('properties', props.join(' '));
    else item.removeAttribute('properties');
    const out = XML_DECL + new XMLSerializer().serializeToString(doc).replace(/^<\?xml[^>]*>\s*/, '');
    zip.file(path, out);
    sampleSources.push(out);
  }
  const listed = new Set([...items.values()].map(pathOf));
  for (const name of Object.keys(zip.files)) {
    if (zip.files[name].dir || name === 'mimetype' || name.startsWith('META-INF/') || name === opfPath || listed.has(name)) continue;
    zip.remove(name);
  }

  zip.file(opfPath, XML_DECL + new XMLSerializer().serializeToString(opf).replace(/^<\?xml[^>]*>\s*/, ''));
  sampleSources.push(await zip.file(opfPath)!.async('string'));
  assertIsolated(excluded.join(' '), sampleSources.join('\n'));
  // The EPUB rule: "mimetype" first and stored uncompressed.
  zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' });
  return zip.generateAsync({ type: 'blob', mimeType: 'application/epub+zip', compression: 'DEFLATE' });
}
