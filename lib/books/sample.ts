/**
 * Cut a free sample out of an EPUB or HTML book: everything before the chapter the sample stops
 * at. Browser-only (DOMParser). PDF samples are cut by page range in lib/books/pdf.ts.
 *
 * The sample must not carry the rest of the book, and cutting the page is not enough on its own:
 * a book can keep its text somewhere other than the chapter it belongs to (a JSON script, a
 * <template>, a hidden element, an attribute, an EPUB script file). So:
 *   1. Content after the cut is removed (HTML: the element where the next chapter starts and
 *      everything after it; EPUB: the later reading-order documents, plus the end of the document
 *      the cut falls inside, and media only they used).
 *   2. Containers that carry content without being part of the page's behaviour are stripped
 *      from what is left, before the cut too: noscript, frames, objects and embeds, comments.
 *      An HTML sample keeps the book's own behaviour -- its scripts, templates and handlers -- so
 *      a theme switch, quizzes or copy buttons still work: a page-level script that came after the
 *      cut is carried over, while scripts inside a removed chapter go with it. EPUB samples stay
 *      static (scripts, script files and files the package does not list are dropped), since most
 *      reading apps do not run EPUB scripts anyway.
 *   3. The result is checked, and the cut refused, when isolation cannot be confirmed: text from
 *      the left-out chapters still found anywhere in the sample's source, scripts included; a large
 *      encoded payload (base64 or an oversized attribute) that is not an image or a font; or, for
 *      HTML, almost no visible text left (a book that builds its pages with scripts). The author is
 *      then asked to upload a sample file instead.
 *   4. Links into the left-out chapters (the book's own table of contents, cross-references) would
 *      otherwise lead nowhere. They are relabelled "in the full book" and point to the book's store
 *      page, and a closing note where the sample ends names the next chapter and links there too.
 */
import JSZip from 'jszip';

const UPLOAD_INSTEAD = 'Upload a sample file instead.';
// Content carriers that are never part of a page's behaviour. Scripts and templates are added for
// a static (EPUB) sample.
const CONTENT_CARRIERS = ['noscript', 'iframe', 'frame', 'object', 'embed', 'applet'];
const XHTML_NS = 'http://www.w3.org/1999/xhtml';

/** Where the full book is sold, for links out of the sample. */
export interface SampleLinks {
  /** Absolute http(s) URL of the book's store page. */
  storeUrl: string;
  /** The first chapter left out, named in the closing note. */
  nextChapterTitle?: string;
}
const SHOW_COMMENT = 128; // NodeFilter.SHOW_COMMENT

/**
 * Remove `start` and everything after it in document order, up to the end of <body>. With
 * keepScripts, a script that sits between chapters rather than inside one (a page-level script,
 * typically at the end of <body>) stays where it is: it belongs to the whole page. Its content is
 * still checked for left-out text afterwards (assertIsolated).
 */
function truncateFrom(start: Element, keepScripts = false): void {
  for (let node: Node | null = start; node && node.parentNode; node = node.parentNode) {
    const parent: Node = node.parentNode;
    if ((parent as Element).localName === 'html') break;
    let sib = node.nextSibling;
    while (sib) {
      const next = sib.nextSibling;
      if (!(keepScripts && sib.nodeType === 1 && (sib as Element).localName === 'script')) parent.removeChild(sib);
      sib = next;
    }
    if ((parent as Element).localName === 'body') break;
  }
  start.parentNode?.removeChild(start);
}

const SHOW_TEXT = 4; // NodeFilter.SHOW_TEXT

/**
 * The text under a node with a space at every text-node boundary. textContent glues neighbouring
 * elements together ("<span>Role</span><span>Identify</span>" reads "RoleIdentify"), which would
 * make the same words compare unequal in the leak checks. `skip` leaves out whole elements
 * (scripts and styles when reading what a reader sees).
 */
function spacedText(node: Node, skip: readonly string[] = [], skipElements?: ReadonlySet<Element>): string {
  const doc = node.ownerDocument ?? (node as Document);
  const parts: string[] = [];
  const walker = doc.createTreeWalker(node, SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (skip.length || skipElements?.size) {
      let hidden = false;
      for (let p = n.parentNode; p && p !== node; p = p.parentNode) {
        if (p.nodeType === 1 && (skip.includes((p as Element).localName) || skipElements?.has(p as Element))) { hidden = true; break; }
      }
      if (hidden) continue;
    }
    parts.push(n.nodeValue ?? '');
  }
  return parts.join(' ');
}

/** Headings' text: chapter and section titles, which are public (the store lists them). */
function headingText(root: Document | Element): string {
  return ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'].flatMap(h => byLocalName(root, h)).map(el => spacedText(el)).join('. ');
}

/** A media query that only ever applies when printing ("print", "only print and (...)"). */
function printOnly(query: string): boolean {
  const queries = query.toLowerCase().split(',').map(q => q.trim()).filter(Boolean);
  return queries.length > 0 && queries.every(q => /^(only\s+)?print\b/.test(q));
}

/**
 * The rules of a stylesheet that can hide content on a screen. Conservative on purpose: only a
 * print-only @media block is left out (a print stylesheet hiding the theme switch and copy buttons
 * hides nothing from a reader). Every other block -- @media screen, @media all, width queries,
 * @supports, @container, @layer -- is unwrapped and its rules count, since any of them can hide
 * content during normal reading. Blocks with no selectors (@font-face, @keyframes, @page) go.
 */
function screenRules(css: string): string {
  let out = '';
  let i = 0;
  while (i < css.length) {
    const at = css.indexOf('@', i);
    if (at < 0) { out += css.slice(i); break; }
    out += css.slice(i, at);
    const open = css.indexOf('{', at);
    const semi = css.indexOf(';', at);
    // A block-less at-rule (@import, @charset) ends at its semicolon.
    if (open < 0 || (semi >= 0 && semi < open)) { i = semi < 0 ? css.length : semi + 1; continue; }
    let depth = 0;
    let close = open;
    for (; close < css.length; close++) {
      if (css[close] === '{') depth++;
      else if (css[close] === '}' && --depth === 0) break;
    }
    const prelude = css.slice(at + 1, open).trim();
    const name = prelude.split(/\s/)[0].toLowerCase();
    const inner = css.slice(open + 1, close);
    if (name === 'media') {
      if (!printOnly(prelude.slice(5))) out += screenRules(inner);
    } else if (['supports', 'container', 'layer', 'document', 'scope'].includes(name)) {
      out += screenRules(inner);
    }
    i = close + 1;
  }
  return out;
}

/**
 * Elements a reader does not see: the hidden attribute, an inline display:none or
 * visibility:hidden, or a rule in the book's own stylesheets that hides them -- including rules
 * inside @media screen, width queries and the like; only print-only rules are left out
 * (screenRules).
 * Their text is not "already visible" and is checked like a script's.
 */
function hiddenElements(doc: Document): Set<Element> {
  const found = new Set<Element>();
  const add = (el: Element) => { found.add(el); };
  for (const el of Array.from(doc.getElementsByTagName('*'))) {
    if (el.hasAttribute('hidden')) add(el);
    const style = el.getAttribute('style') ?? '';
    if (/display\s*:\s*none|visibility\s*:\s*hidden/i.test(style)) add(el);
  }
  for (const sheet of byLocalName(doc, 'style')) {
    const css = screenRules((sheet.textContent ?? '').replace(/\/\*[\s\S]*?\*\//g, ''));
    for (const rule of css.matchAll(/([^{}@]+)\{([^{}]*)\}/g)) {
      if (!/display\s*:\s*none|visibility\s*:\s*hidden/i.test(rule[2])) continue;
      for (const selector of rule[1].split(',').map(x => x.trim()).filter(Boolean)) {
        try {
          doc.querySelectorAll(selector).forEach(add);
        } catch { /* a selector this parser cannot run matches nothing here */ }
      }
    }
  }
  // Only the outermost: a hidden element's text already includes its hidden descendants.
  return new Set([...found].filter(el => {
    for (let p = el.parentElement; p; p = p.parentElement) if (found.has(p)) return false;
    return true;
  }));
}

/**
 * The text truncateFrom(start, keepScripts) would remove. Read before cutting. A script it keeps is
 * not removed, so it is not counted as left-out text either (it is checked as part of the sample).
 */
function textFrom(start: Element, keepScripts = false): string {
  const parts = [spacedText(start)];
  for (let node: Node = start; node.parentNode; node = node.parentNode) {
    const parent = node.parentNode as Element;
    if (parent.localName === 'html') break;
    for (let sib = node.nextSibling; sib; sib = sib.nextSibling) {
      if (keepScripts && sib.nodeType === 1 && (sib as Element).localName === 'script') continue;
      parts.push(sib.nodeType === 1 ? spacedText(sib) : sib.nodeValue ?? '');
    }
    if (parent.localName === 'body') break;
  }
  return parts.join(' ');
}

/**
 * Strip content carriers. keepBehaviour (HTML samples) leaves the page's scripts, templates and
 * handlers in place; without it (EPUB) the sample is fully static.
 */
function stripPayloads(doc: Document, keepBehaviour: boolean): void {
  const names = keepBehaviour ? CONTENT_CARRIERS : [...CONTENT_CARRIERS, 'script', 'template'];
  for (const name of names) {
    for (const el of byLocalName(doc, name)) el.parentNode?.removeChild(el);
  }
  const comments: Node[] = [];
  const walker = doc.createTreeWalker(doc, SHOW_COMMENT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) comments.push(n);
  comments.forEach(c => c.parentNode?.removeChild(c));
  if (keepBehaviour) return;
  for (const el of Array.from(doc.getElementsByTagName('*'))) {
    for (const attr of Array.from(el.attributes)) {
      if (/^on/i.test(attr.localName) || /^\s*javascript:/i.test(attr.value)) el.removeAttribute(attr.name);
    }
  }
}

/** Only an absolute http(s) URL is ever written into a sample. */
function safeStoreUrl(links?: SampleLinks): string | null {
  const url = links?.storeUrl?.trim() ?? '';
  return /^https?:\/\/[^\s"'<>]+$/i.test(url) ? url : null;
}

/** Point a link at the store, labelled as leading to the full book. */
function pointToStore(doc: Document, a: Element, storeUrl: string): void {
  a.setAttribute('href', storeUrl);
  a.setAttribute('target', '_blank');
  a.setAttribute('rel', 'noopener');
  const label = doc.createElementNS(a.namespaceURI || XHTML_NS, 'span');
  label.setAttribute('style', 'opacity:0.7;font-size:0.85em;white-space:nowrap');
  label.textContent = ' (in the full book)';
  a.appendChild(label);
}

/** The closing note where the sample ends, built from text nodes only (titles are never parsed as markup). */
function endNote(doc: Document, storeUrl: string, nextChapterTitle: string | undefined, ns: string): Element {
  const box = doc.createElementNS(ns, 'aside');
  box.setAttribute('data-sample-end', '');
  box.setAttribute('style', 'margin:3em auto;max-width:42em;padding:1.5em;border:1px solid rgba(127,127,127,0.35);border-radius:16px;text-align:center');
  const lead = doc.createElementNS(ns, 'p');
  lead.setAttribute('style', 'margin:0;font-weight:700');
  lead.textContent = 'This is the end of the free sample.';
  const next = doc.createElementNS(ns, 'p');
  next.setAttribute('style', 'margin:0.5em 0 0');
  const title = nextChapterTitle?.replace(/\s+/g, ' ').trim().slice(0, 300);
  next.textContent = title ? `The full book continues with ${title}.` : 'The full book continues from here.';
  const cta = doc.createElementNS(ns, 'a');
  cta.setAttribute('href', storeUrl);
  cta.setAttribute('target', '_blank');
  cta.setAttribute('rel', 'noopener');
  cta.setAttribute('style', 'display:inline-block;margin-top:1em;padding:0.7em 1.4em;border-radius:999px;background:#0f172a;color:#ffffff;text-decoration:none;font-weight:600');
  cta.textContent = 'Get the full book';
  box.append(lead, next, cta);
  return box;
}

function fragmentOf(href: string): string {
  const raw = href.slice(href.indexOf('#') + 1);
  try { return decodeURIComponent(raw); } catch { return raw; }
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

// A run of this many words within one sentence, found only in the left-out chapters, is treated
// as a copy of them. Runs never cross a sentence boundary: the same text laid out differently (a
// prompt shown line by line with a tag after each line, and held whole in a copy button) would
// otherwise produce runs that exist in one layout and not the other.
const RUN_WORDS = 6;

function runsOf(text: string): string[] {
  const out: string[] = [];
  for (const sentence of text.split(/[.!?;:\n\r]+/)) {
    const words = normalize(sentence).split(' ').filter(Boolean);
    for (let i = 0; i + RUN_WORDS <= words.length; i++) out.push(words.slice(i, i + RUN_WORDS).join(' '));
  }
  return out;
}

/**
 * The exhaustive check for what a sample carries besides its visible text: scripts, templates,
 * styles and attribute values. assertIsolated samples the left-out text, which catches a copy of
 * the whole book but can miss a partial one (a script holding a few paragraphs of a paid chapter).
 * Here every run of RUN_WORDS consecutive words in those carriers is compared with the
 * left-out text, so any such run is refused. Runs that also appear in the sample's visible text
 * are free already and do not count, nor do headings (chapter titles are public). Hidden elements
 * are carriers, not visible text (hiddenElements).
 */
function assertNoLeftOutTextInCarriers(excluded: string, visibleText: string, carriers: string[], publicText = ''): void {
  const leftOut = new Set(runsOf(excluded));
  if (!leftOut.size) return;
  // Free already: what the reader sees, and titles, which the store and every contents list show.
  for (const free of runsOf(visibleText)) leftOut.delete(free);
  for (const title of runsOf(publicText)) leftOut.delete(title);
  if (!leftOut.size) return;
  for (const carrier of carriers) {
    for (const run of runsOf(carrier)) {
      if (leftOut.has(run)) {
        throw new Error(`Text from the chapters left out of the sample is stored elsewhere in this book, so a sample cannot be cut from it safely. ${UPLOAD_INSTEAD}`);
      }
    }
  }
}

/**
 * Split what a document carries into its visible body text and everything else (script, style and
 * template contents, attribute values other than embedded images and fonts).
 */
function carriersOf(doc: Document): { visible: string; carriers: string[] } {
  const carriers: string[] = [];
  for (const el of byLocalName(doc, 'script')) carriers.push(el.textContent ?? '');
  for (const el of byLocalName(doc, 'style')) carriers.push(el.textContent ?? '');
  for (const el of byLocalName(doc, 'template')) {
    const content = (el as HTMLTemplateElement).content;
    carriers.push(content ? Array.from(content.childNodes).map(n => n.textContent ?? '').join(' ') : el.textContent ?? '');
  }
  for (const el of Array.from(doc.getElementsByTagName('*'))) {
    for (const attr of Array.from(el.attributes)) {
      if (attr.value.length > 20 && !/^\s*data:(?:image|font)\//i.test(attr.value)) carriers.push(attr.value);
    }
  }
  const hidden = hiddenElements(doc);
  for (const el of hidden) carriers.push(spacedText(el));
  const body = byLocalName(doc, 'body')[0];
  const visible = body ? spacedText(body, ['script', 'style', 'template'], hidden) : '';
  return { visible, carriers };
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
 * left out of the sample starts. The book's own behaviour is kept (see the header); with `links`,
 * links into the left-out chapters lead to the store and a closing note ends the sample.
 */
export function cutHtmlSample(source: string, stopAnchor: string, links?: SampleLinks): string {
  const doc = new DOMParser().parseFromString(source, 'text/html');
  const stop = doc.getElementById(stopAnchor);
  if (!stop) throw new Error('The chapter the sample stops at was not found in the book. Find the chapters again, then save.');
  const excluded = textFrom(stop, true);
  const titles = headingText(doc);
  const cutParent = stop.parentElement;
  const hasScripts = byLocalName(doc, 'script').length > 0;
  truncateFrom(stop, true);
  stripPayloads(doc, true);
  if (normalize(doc.body?.textContent ?? '').length < 200) {
    throw new Error(hasScripts
      ? `This book builds its pages with scripts, so a readable sample cannot be cut from it. ${UPLOAD_INSTEAD}`
      : 'The sample would be almost empty. Include more chapters.');
  }
  assertNoLargeAttributes(doc);
  // Checked before the store links and the closing note go in: they are ours, not the book's.
  assertIsolated(excluded, `<!DOCTYPE html>\n${doc.documentElement.outerHTML}`);
  const { visible, carriers } = carriersOf(doc);
  assertNoLeftOutTextInCarriers(excluded, visible, carriers, titles);

  const storeUrl = safeStoreUrl(links);
  if (storeUrl) {
    const ids = new Set(Array.from(doc.querySelectorAll('[id]')).map(el => el.id));
    for (const a of byLocalName(doc, 'a')) {
      const href = a.getAttribute('href') ?? '';
      if (href.startsWith('#') && href.length > 1 && !ids.has(fragmentOf(href))) pointToStore(doc, a, storeUrl);
    }
    const host = cutParent && cutParent.isConnected ? cutParent : doc.body;
    // Before any page script that was kept at the end, so the note sits with the content.
    const firstScript = Array.from(host.children).find(el => el.localName === 'script') ?? null;
    host.insertBefore(endNote(doc, storeUrl, links?.nextChapterTitle, XHTML_NS), firstScript);
  }
  return `<!DOCTYPE html>\n${doc.documentElement.outerHTML}`;
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
 * sample starts (a path relative to the package document, optionally with #fragment). With
 * `links`, links into the left-out chapters lead to the store and the last document ends with a
 * closing note.
 */
export async function cutEpubSample(data: ArrayBuffer | Blob, stopHref: string, links?: SampleLinks): Promise<Blob> {
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
  const titles: string[] = [];
  const bodyText = (source: string) => {
    const doc = new DOMParser().parseFromString(source, 'application/xhtml+xml');
    titles.push(headingText(doc));
    const body = byLocalName(doc, 'body')[0];
    return body ? spacedText(body) : '';
  };

  // The document the cut falls inside keeps what comes before the next chapter.
  let firstDropped = stopIndex;
  if (fragment) {
    const source = await zip.file(stopPath)?.async('string');
    const doc = source ? new DOMParser().parseFromString(source, 'application/xhtml+xml') : null;
    const stop = doc?.getElementById(fragment) ?? null;
    if (doc && stop) {
      titles.push(headingText(doc));
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
  const removedPaths = new Set<string>();
  for (const ref of refs.slice(firstDropped)) {
    const id = ref.getAttribute('idref') ?? '';
    const item = items.get(id);
    ref.parentNode?.removeChild(ref);
    if (item && !(item.getAttribute('properties') ?? '').split(/\s+/).includes('nav')) {
      const dropped = await zip.file(pathOf(item))?.async('string');
      if (dropped) excluded.push(bodyText(dropped));
      removedPaths.add(pathOf(item));
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
  const tocSources: string[] = [];
  const docs = new Map<string, Document>();
  for (const item of items.values()) {
    const type = item.getAttribute('media-type') ?? '';
    const path = pathOf(item);
    if (!/xhtml|html/i.test(type)) {
      if (!isMedia(type) && !/font/i.test(type)) {
        const text = await zip.file(path)?.async('string');
        // The EPUB 2 table of contents lists every chapter title, paid ones included: a reader
        // sees it, so it counts as visible text rather than as a hidden carrier.
        if (text) (/dtbncx/i.test(type) ? tocSources : sampleSources).push(text);
      }
      continue;
    }
    const source = await zip.file(path)?.async('string');
    if (!source) continue;
    const doc = new DOMParser().parseFromString(source, 'application/xhtml+xml');
    stripPayloads(doc, false);
    assertNoLargeAttributes(doc);
    const props = (item.getAttribute('properties') ?? '').split(/\s+/).filter(p => p && p !== 'scripted');
    if (props.length) item.setAttribute('properties', props.join(' '));
    else item.removeAttribute('properties');
    docs.set(path, doc);
  }
  const serialize = (doc: Document) => XML_DECL + new XMLSerializer().serializeToString(doc).replace(/^<\?xml[^>]*>\s*/, '');
  {
    const split = [...docs.values()].map(carriersOf);
    assertNoLeftOutTextInCarriers(excluded.join(' '), [...split.map(p => p.visible), ...tocSources].join(' '),
      [...split.flatMap(p => p.carriers), ...sampleSources], titles.join('. '));
  }
  // Checked before the store links and the closing note go in: they are ours, not the book's.
  const isolationSources = [...sampleSources, ...tocSources, ...[...docs.values()].map(serialize)];

  const storeUrl = safeStoreUrl(links);
  if (storeUrl) {
    const idsOf = new Map([...docs].map(([path, doc]) => [path, new Set(Array.from(doc.getElementsByTagName('*')).map(el => el.getAttribute('id')).filter(Boolean) as string[])]));
    for (const [path, doc] of docs) {
      for (const a of byLocalName(doc, 'a')) {
        const href = a.getAttribute('href') ?? '';
        if (!href || /^[a-z][a-z0-9+.-]*:/i.test(href)) continue;
        const filePart = href.split('#')[0];
        const target = filePart ? resolvePath(dirOf(path), filePart) : path;
        const gone = removedPaths.has(target)
          || (href.includes('#') && idsOf.has(target) && !idsOf.get(target)!.has(fragmentOf(href)));
        if (gone) pointToStore(doc, a, storeUrl);
      }
    }
    // The closing note ends the last document a reader reaches.
    const lastRef = byLocalName(spine ?? opf, 'itemref').at(-1);
    const lastPath = lastRef ? pathOf(items.get(lastRef.getAttribute('idref') ?? '')) : '';
    const lastBody = docs.get(lastPath) ? byLocalName(docs.get(lastPath)!, 'body')[0] : undefined;
    if (lastBody) lastBody.appendChild(endNote(docs.get(lastPath)!, storeUrl, links?.nextChapterTitle, XHTML_NS));
  }
  for (const [path, doc] of docs) zip.file(path, serialize(doc));
  const listed = new Set([...items.values()].map(pathOf));
  for (const name of Object.keys(zip.files)) {
    if (zip.files[name].dir || name === 'mimetype' || name.startsWith('META-INF/') || name === opfPath || listed.has(name)) continue;
    zip.remove(name);
  }

  zip.file(opfPath, XML_DECL + new XMLSerializer().serializeToString(opf).replace(/^<\?xml[^>]*>\s*/, ''));
  isolationSources.push(await zip.file(opfPath)!.async('string'));
  assertIsolated(excluded.join(' '), isolationSources.join('\n'));
  // The EPUB rule: "mimetype" first and stored uncompressed.
  zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' });
  return zip.generateAsync({ type: 'blob', mimeType: 'application/epub+zip', compression: 'DEFLATE' });
}
