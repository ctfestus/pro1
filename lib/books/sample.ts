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
 *
 * What this protects against, and what it does not. The book file comes from its author (an
 * instructor or admin), so the realistic risk is accidental: a book-making tool that embeds the
 * whole text (a search index, a data file, a hidden full-text block). Those are caught. A book
 * built on purpose to defeat the checks is not reliably caught, and no text scan could do that:
 * text split into pieces shorter than a few words, disguised with look-alike letters, encoded in
 * small chunks, or a script holding paid chapters as structured data (a JS quiz bank with answer
 * keys) rather than as their prose. Books are in English; non-Latin text is not compared.
 *
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
  /**
   * Every chapter title of the book. Titles are public (the store lists them), so a contents list
   * naming paid chapters is not a leak. Without them, only h1 and h2 headings are treated as titles.
   */
  chapterTitles?: string[];
}
const SHOW_COMMENT = 128; // NodeFilter.SHOW_COMMENT

/**
 * Remove `start` and everything after it in document order, up to the end of <body>. With
 * keepScripts, a script that sits between chapters rather than inside one (a page-level script,
 * typically at the end of <body>) stays where it is: it belongs to the whole page. Its content is
 * still checked for left-out text afterwards (checkSubstantialCopy and findLeftOutText).
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

/**
 * Chapter titles, which are public (the store lists them): the ones the editor passes, or else the
 * book's h1 and h2 headings. Lower headings are not titles and are not exempt.
 */
function chapterTitlesText(root: Document | Element, links?: SampleLinks): string {
  const given = (links?.chapterTitles ?? []).filter(t => typeof t === 'string' && t.trim());
  if (given.length) return given.join('. ');
  return ['h1', 'h2'].flatMap(h => byLocalName(root, h)).map(el => spacedText(el)).join('. ');
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
    // A <style media="print"> sheet hides nothing on screen.
    if (printOnly(sheet.getAttribute('media') ?? '')) continue;
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
  label.textContent = ' (in the full version)';
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
  next.textContent = title ? `The full version continues with ${title}.` : 'The full version continues from here.';
  const cta = doc.createElementNS(ns, 'a');
  cta.setAttribute('href', storeUrl);
  cta.setAttribute('target', '_blank');
  cta.setAttribute('rel', 'noopener');
  cta.setAttribute('style', 'display:inline-block;margin-top:1em;padding:0.7em 1.4em;border-radius:999px;background:#0f172a;color:#ffffff;text-decoration:none;font-weight:600');
  cta.textContent = 'Get the full version';
  box.append(lead, next, cta);
  return box;
}

function fragmentOf(href: string): string {
  const raw = href.slice(href.indexOf('#') + 1);
  try { return decodeURIComponent(raw); } catch { return raw; }
}

// Soft hyphens and zero-width characters are dropped first: they are invisible, so a copy that
// carries them reads the same as one that does not, and must compare the same.
const normalize = (text: string) => text.replace(/[\u00ad\u200b-\u200d\u2060\ufeff]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const PROBES = 24;
const PROBE_CHARS = 50;
const MIN_EXCLUDED_CHARS = 300;
const MAX_PAYLOAD_CHARS = 4096;
// Embedded images and fonts. (Fonts labelled octet-stream or as an EOT object are only accepted
// inside an @font-face rule: see isFontFaceData.)
const ASSET_TYPES = 'image\\/|font\\/|application\\/(?:x-)?font';
const FONT_FACE_DATA = /data:application\/(?:octet-stream|vnd\.ms-fontobject)[^,]*,$/i;

/** Whether the data at `index` in a stylesheet sits inside an @font-face rule. */
function isFontFaceData(text: string, index: number): boolean {
  const back = text.slice(Math.max(0, index - 4000), index);
  return back.lastIndexOf('@font-face') > back.lastIndexOf('}');
}
const EMBEDDED_ASSET = new RegExp(`data:(?:${ASSET_TYPES})[^,;]*(?:;[^,]*)?,`, 'gi');
const EMBEDDED_ASSET_WITH_DATA = new RegExp(`data:(?:${ASSET_TYPES})[^"')\\s]*`, 'gi');

/** A place in the sample that may carry text from the left-out chapters, for the author to review. */
export interface SampleFinding {
  /** Where it was found, in words ("a script", "the aria-label attribute of <svg>"). */
  where: string;
  /** The matching text, or the start of it. */
  excerpt: string;
}

/**
 * The sample would plainly carry the paid chapters (much of their text is in it): refused outright.
 * Anything less certain is returned as findings for the author to review instead.
 */
export class SampleRefusedError extends Error {}

const SUBSTANTIAL = `Much of the text of the chapters left out of the sample is also inside it, so it would give away the paid chapters. Choose fewer chapters, or ${UPLOAD_INSTEAD.toLowerCase()}`;
const MAX_FINDINGS = 12;

function addFinding(findings: SampleFinding[], where: string, excerpt: string): void {
  const clean = excerpt.replace(/\s+/g, ' ').trim().slice(0, 200);
  if (findings.length < MAX_FINDINGS && !findings.some(f => f.where === where && f.excerpt === clean)) findings.push({ where, excerpt: clean });
}

/**
 * The sampling check. Refuses (SampleRefusedError) when a quarter or more of 24 probes of the
 * left-out text are found anywhere in the sample, visible or not: that is a substantial copy, not
 * a coincidence. Large encoded data the page cannot show is returned as a finding.
 */
function checkSubstantialCopy(excluded: string, sample: string): SampleFinding[] {
  const findings: SampleFinding[] = [];
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
    if (checked && found / checked >= 0.25) throw new SampleRefusedError(SUBSTANTIAL);
  }
  for (const m of sample.matchAll(new RegExp(`[A-Za-z0-9+/=_-]{${MAX_PAYLOAD_CHARS},}`, 'g'))) {
    const before = sample.slice(Math.max(0, (m.index ?? 0) - 80), m.index);
    // Embedded images and fonts are fine; text data (an inlined script, stylesheet or JSON) is
    // decoded and read with everything else wherever it appears (carriersOf), so its encoding
    // hides nothing.
    const fontFace = FONT_FACE_DATA.test(before) && isFontFaceData(sample, m.index ?? 0);
    if (!new RegExp(`${EMBEDDED_ASSET.source}$`, 'i').test(before) && !INLINED_TEXT_PREFIX.test(before) && !fontFace) {
      addFinding(findings, 'encoded data in the product that a reader cannot see', `${m[0].slice(0, 60)}...`);
    }
  }
  return findings;
}

// A run of this many words within one sentence, found only in the left-out chapters, is treated
// as possibly copied from them. Runs never cross a sentence boundary: the same text laid out
// differently (a prompt shown line by line with a tag after each line, and held whole in a copy
// button) would otherwise produce runs that exist in one layout and not the other.
const RUN_WORDS = 6;

function runsOf(text: string): string[] {
  const out: string[] = [];
  for (const sentence of text.split(/[.!?;:\n\r]+/)) {
    const words = normalize(sentence).split(' ').filter(Boolean);
    for (let i = 0; i + RUN_WORDS <= words.length; i++) out.push(words.slice(i, i + RUN_WORDS).join(' '));
  }
  return out;
}

/** The sentence of `text` that holds `run`, for showing the author what matched. */
function excerptOf(text: string, run: string): string {
  return text.split(/(?<=[.!?;:\n\r])/).find(sentence => normalize(sentence).includes(run)) ?? run;
}

// Quiz explanations may repeat paid text (an answers chapter quoting them), but only up to a small
// allowance before the author is asked to look: a few explanations, not a chapter.
const FEEDBACK_LEAK_MAX_CHARS = 3000;
const FEEDBACK_LEAK_SHARE = 0.02;

/** Something in the sample that is not its visible text, with where it was found. */
type Carrier = { where: string; text: string };

/**
 * The detailed check of what a sample carries besides its visible text: scripts, styles,
 * templates, attribute values, hidden elements, titles and descriptions, and (EPUB) other files.
 * Any run of RUN_WORDS words there that appears only in the left-out chapters -- not in the visible
 * sample, not in a chapter title -- is a finding. So are paid code lines (code splits into short
 * pieces the word runs miss) and quiz explanations beyond their allowance. Findings are for the
 * author to review; this check does not refuse.
 */
function findLeftOutText(
  excluded: string,
  visibleText: string,
  carriers: Carrier[],
  publicText = '',
  feedback: Carrier[] = [],
  paidCodeLines: string[] = [],
): SampleFinding[] {
  const findings: SampleFinding[] = [];
  const leftOut = new Set(runsOf(excluded));
  for (const free of runsOf(visibleText)) leftOut.delete(free);
  for (const title of runsOf(publicText)) leftOut.delete(title);
  if (leftOut.size) {
    for (const carrier of carriers) {
      const run = runsOf(carrier.text).find(r => leftOut.has(r));
      if (run) addFinding(findings, carrier.where, excerptOf(carrier.text, run));
    }
    const allowance = Math.min(FEEDBACK_LEAK_MAX_CHARS, normalize(excluded).length * FEEDBACK_LEAK_SHARE);
    let repeated = 0;
    const repeating: Carrier[] = [];
    for (const fb of feedback) {
      if (runsOf(fb.text).some(run => leftOut.has(run))) { repeated += normalize(fb.text).length; repeating.push(fb); }
    }
    if (repeated > allowance) {
      for (const fb of repeating.slice(0, 3)) addFinding(findings, `${fb.where} (${repeating.length} explanations repeat paid text)`, fb.text);
    }
  }
  if (paidCodeLines.length) {
    const seen = normalize(visibleText);
    const lines = paidCodeLines.filter(line => !seen.includes(line));
    for (const carrier of carriers) {
      const text = normalize(carrier.text);
      const line = lines.find(l => text.includes(l));
      if (line) addFinding(findings, `${carrier.where} (code from a paid chapter)`, line);
    }
  }
  return findings;
}

// The end of a data: URL prefix for text content: an inlined script, stylesheet or JSON.
const INLINED_TEXT_PREFIX = /data:(?:text\/[a-z0-9.+-]+|application\/(?:javascript|json|ecmascript))[^,]*,$/i;

/** A data: URL's text, when it is a text type (an inlined script or stylesheet). */
function decodeTextDataUrl(value: string): string | null {
  const m = /^\s*data:(text\/[a-z0-9.+-]+|application\/(?:javascript|json|ecmascript))([^,]*),([\s\S]*)$/i.exec(value);
  if (!m) return null;
  try {
    return /;base64/i.test(m[2]) ? atob(m[3].replace(/\s+/g, '')) : decodeURIComponent(m[3]);
  } catch {
    return null;
  }
}

/** Readable text, as opposed to the bytes of an image or font: printable, with spaces between words. */
function isReadableText(text: string): boolean {
  if (text.length < 40) return false;
  let printable = 0;
  let spaces = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c === 9 || c === 10 || c === 13 || (c >= 32 && c < 127)) printable++;
    if (c === 32) spaces++;
  }
  return printable / text.length > 0.9 && spaces >= 6;
}

/**
 * Every data: URL inside a piece of text (a script, a stylesheet, an attribute), decoded when it
 * holds readable text -- whatever it is labelled. A text type is decoded as such; any other label
 * (octet-stream, an image type...) is decoded too and kept only if the result reads as text, so a
 * real font or image is left alone and a mislabelled text file is not.
 */
function decodedDataIn(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/data:([a-z]+\/[a-z0-9.+-]+)?([^,"'\s)]*),([^"'\s)]+)/gi)) {
    const decoded = decodeTextDataUrl(m[0]);
    if (decoded) { out.push(decoded); continue; }
    if (!/;base64/i.test(m[2])) continue;
    try {
      const raw = atob(m[3]);
      if (isReadableText(raw)) out.push(raw);
    } catch { /* not base64 */ }
  }
  return out;
}

/** An element in words for the author: "div element .note", "svg element #logo". */
function describe(el: Element): string {
  const cls = (el.getAttribute('class') ?? '').trim().split(/\s+/)[0];
  return `${el.localName} element${el.id ? ` #${el.id}` : cls ? ` .${cls}` : ''}`;
}

/**
 * Split what a document carries into its visible body text and everything else (script, style and
 * template contents, attribute values other than embedded images and fonts, hidden elements,
 * titles and descriptions). Inlined scripts and stylesheets (data: URLs) are decoded and read.
 */
function carriersOf(doc: Document): { visible: string; carriers: Carrier[]; feedback: Carrier[] } {
  const carriers: Carrier[] = [];
  for (const el of byLocalName(doc, 'script')) carriers.push({ where: 'a script', text: el.textContent ?? '' });
  for (const el of byLocalName(doc, 'style')) carriers.push({ where: 'a stylesheet', text: el.textContent ?? '' });
  for (const el of byLocalName(doc, 'template')) {
    const content = (el as HTMLTemplateElement).content;
    carriers.push({ where: 'a template', text: content ? Array.from(content.childNodes).map(n => n.textContent ?? '').join(' ') : el.textContent ?? '' });
  }
  // Text a page holds but does not show in the page itself: the document title (and SVG titles),
  // SVG descriptions and metadata.
  const unshown = ['title', 'desc', 'metadata'].flatMap(name => byLocalName(doc, name));
  for (const el of unshown) carriers.push({ where: el.localName === 'title' ? 'a title' : `an SVG ${el.localName}`, text: spacedText(el) });
  for (const el of Array.from(doc.getElementsByTagName('*'))) {
    for (const attr of Array.from(el.attributes)) {
      if (attr.value.length <= 20 || /^\s*data:(?:image|font)\//i.test(attr.value) || isSvgGeometry(el, attr.localName)) continue;
      const decoded = decodeTextDataUrl(attr.value);
      carriers.push({ where: `the ${attr.name} attribute of the ${describe(el)}`, text: decoded ?? attr.value });
    }
  }
  // Text data (base64 or percent-encoded) inside scripts, styles and attributes is read decoded.
  for (const c of [...carriers]) {
    for (const decoded of decodedDataIn(c.text)) carriers.push({ where: `${c.where} (encoded data)`, text: decoded });
  }
  // Hidden text is a carrier. A quiz's answer explanation (quizFeedback) is set apart: it belongs
  // to the free chapter it sits in and is revealed when the reader answers, so it may repeat paid
  // text a little (findLeftOutText bounds how much), but it is never visible text, so it can never
  // vouch for a script, attribute or other hidden block carrying the same words.
  const allHidden = hiddenElements(doc);
  const feedbackEls = quizFeedback(allHidden);
  const hidden = new Set([...allHidden].filter(el => !feedbackEls.has(el)));
  for (const el of hidden) carriers.push({ where: `hidden content (${describe(el)})`, text: spacedText(el) });
  const body = byLocalName(doc, 'body')[0];
  const skip = new Set([...hidden, ...feedbackEls, ...unshown]);
  const visible = body ? spacedText(body, ['script', 'style', 'template'], skip) : '';
  return { visible, carriers, feedback: [...feedbackEls].map(el => ({ where: 'quiz explanations', text: spacedText(el) })) };
}

// SVG drawing data: long, but numbers and letters, never prose. Only on SVG elements.
const SVG_GEOMETRY = new Set(['d', 'points', 'transform', 'viewbox', 'path', 'values', 'keytimes', 'keysplines']);
const SVG_NS = 'http://www.w3.org/2000/svg';

function isSvgGeometry(el: Element, attrName: string): boolean {
  return el.namespaceURI === SVG_NS && SVG_GEOMETRY.has(attrName.toLowerCase());
}

// What marks a widget as a quiz: its class, id, role or data attribute names.
const QUIZ_MARK = /(^|[\s_-])(quiz|question|choice|choices|mcq|poll|exercise|knowledge-?check|self-?check|check-?yourself|answer-?options)([\s_-]|$)/i;
// Buttons that are tools, not answers -- recognised by explicit markers (a class or id token, or
// a tool data attribute), never by their wording: "Copy the report" can be a real answer.
const TOOL_TOKEN = /^(copy|clipboard|theme|toggle|menu|close|print|share|download|expand|collapse)([-_].*)?$/i;
const TOOL_DATA = /^(copy|clipboard|code|theme|toggle)$/i;

function isToolButton(el: Element): boolean {
  const tokens = [...(el.getAttribute('class') ?? '').split(/\s+/), el.id].filter(Boolean);
  if (tokens.some(t => TOOL_TOKEN.test(t))) return true;
  return Array.from(el.attributes).some(a => a.name.startsWith('data-') && TOOL_DATA.test(a.name.slice(5)));
}
const NOT_A_WIDGET = new Set(['body', 'html', 'main', 'section', 'article', 'nav', 'aside', 'header', 'footer']);
// One explanation is a sentence or a short paragraph. Longer hidden text is checked like any other.
const FEEDBACK_MAX_CHARS = 800;

function widgetMarker(el: Element): string {
  const dataNames = Array.from(el.attributes).filter(a => a.name.startsWith('data-')).map(a => a.name.slice(5));
  return [el.getAttribute('class') ?? '', el.id, el.getAttribute('role') ?? '', ...dataNames].join(' ');
}

/** The answer choices a widget offers: buttons, radio/checkbox inputs and options that are not tools. */
function answerChoices(widget: Element): number {
  let n = 0;
  for (const el of Array.from(widget.getElementsByTagName('*'))) {
    if (el.localName === 'button') {
      if (!isToolButton(el)) n++;
    } else if (el.localName === 'input') {
      if (/^(radio|checkbox)$/i.test(el.getAttribute('type') ?? '')) n++;
    } else if (el.localName === 'option') {
      n++;
    }
  }
  return n;
}

/**
 * Hidden quiz explanations: a hidden element whose own widget (its parent, or the one above, never
 * a chapter-level container) is marked as a quiz and offers at least two answer choices, and whose
 * text is no longer than an explanation. How much of their text may repeat the left-out chapters
 * is bounded in findLeftOutText.
 */
function quizFeedback(hidden: Set<Element>): Set<Element> {
  const found = new Set<Element>();
  for (const el of hidden) {
    if (normalize(spacedText(el)).length > FEEDBACK_MAX_CHARS) continue;
    let widget = el.parentElement;
    for (let depth = 0; widget && depth < 2; depth++, widget = widget.parentElement) {
      if (NOT_A_WIDGET.has(widget.localName)) break;
      if (QUIZ_MARK.test(widgetMarker(widget)) && answerChoices(widget) >= 2) {
        found.add(el);
        break;
      }
    }
  }
  return found;
}

/** Oversized attribute values that are not embedded images, fonts, inlined code or SVG drawing data. */
function largeAttributes(doc: Document): SampleFinding[] {
  const findings: SampleFinding[] = [];
  for (const el of Array.from(doc.getElementsByTagName('*'))) {
    for (const attr of Array.from(el.attributes)) {
      if (attr.value.length <= MAX_PAYLOAD_CHARS || isSvgGeometry(el, attr.localName)) continue;
      if (decodeTextDataUrl(attr.value) !== null) continue; // decoded and read as a carrier instead
      if (attr.value.replace(EMBEDDED_ASSET_WITH_DATA, '').length > MAX_PAYLOAD_CHARS) {
        addFinding(findings, `a large ${attr.name} attribute of the ${describe(el)}`, `${attr.value.slice(0, 80)}...`);
      }
    }
  }
  return findings;
}

/** Normalised lines of code (pre and code elements) at least this long, from the left-out part. */
const CODE_LINE_MIN = 30;

function codeLinesOf(roots: Element[]): string[] {
  const lines = new Set<string>();
  for (const root of roots) {
    const blocks = ['pre', 'code'].flatMap(name => byLocalName(root, name));
    if (root.localName === 'pre' || root.localName === 'code') blocks.push(root);
    for (const block of blocks) {
      for (const line of (block.textContent ?? '').split(/\n/)) {
        const n = normalize(line);
        if (n.length >= CODE_LINE_MIN) lines.add(n);
      }
    }
  }
  return [...lines];
}

/** The elements truncateFrom(start, keepScripts) would remove. Read before cutting. */
function removedRoots(start: Element, keepScripts: boolean): Element[] {
  const roots: Element[] = [start];
  for (let node: Node = start; node.parentNode; node = node.parentNode) {
    const parent = node.parentNode as Element;
    if (parent.localName === 'html') break;
    for (let sib = node.nextSibling; sib; sib = sib.nextSibling) {
      if (sib.nodeType !== 1 || (keepScripts && (sib as Element).localName === 'script')) continue;
      roots.push(sib as Element);
    }
    if (parent.localName === 'body') break;
  }
  return roots;
}

/** A cut HTML sample, and what the author should review before using it. */
export interface HtmlSample {
  html: string;
  findings: SampleFinding[];
}

/**
 * The HTML book up to (not including) the element with id `stopAnchor`, where the first chapter
 * left out of the sample starts. The book's own behaviour is kept (see the header); with `links`,
 * links into the left-out chapters lead to the store and a closing note ends the sample.
 * Throws SampleRefusedError for a substantial copy of the left-out text; returns findings (places
 * that may carry it) for the author to review.
 */
export function cutHtmlSample(source: string, stopAnchor: string, links?: SampleLinks): HtmlSample {
  const doc = new DOMParser().parseFromString(source, 'text/html');
  const stop = doc.getElementById(stopAnchor);
  if (!stop) throw new Error('The chapter the sample stops at was not found in the product. Find the chapters again, then save.');
  const excluded = textFrom(stop, true);
  const paidCode = codeLinesOf(removedRoots(stop, true));
  const titles = chapterTitlesText(doc, links);
  const cutParent = stop.parentElement;
  const hasScripts = byLocalName(doc, 'script').length > 0;
  truncateFrom(stop, true);
  stripPayloads(doc, true);
  if (normalize(doc.body?.textContent ?? '').length < 200) {
    throw new Error(hasScripts
      ? `This product builds its pages with scripts, so a readable sample cannot be cut from it. ${UPLOAD_INSTEAD}`
      : 'The sample would be almost empty. Include more chapters.');
  }
  // Checked before the store links and the closing note go in: they are ours, not the book's.
  const findings = [
    ...checkSubstantialCopy(excluded, `<!DOCTYPE html>\n${doc.documentElement.outerHTML}`),
    ...largeAttributes(doc),
  ];
  const { visible, carriers, feedback } = carriersOf(doc);
  for (const f of findLeftOutText(excluded, visible, carriers, titles, feedback, paidCode)) addFinding(findings, f.where, f.excerpt);

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
  return { html: `<!DOCTYPE html>\n${doc.documentElement.outerHTML}`, findings };
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
// The files the EPUB standard (OCF) defines under META-INF. Anything else there is dropped.
const META_INF_FILES = new Set(['container.xml', 'encryption.xml', 'manifest.xml', 'metadata.xml', 'rights.xml', 'signatures.xml']);

const isMedia = (type: string) => /^(image|audio|video)\//.test(type);

/** A cut EPUB sample, and what the author should review before using it. */
export interface EpubSample {
  blob: Blob;
  findings: SampleFinding[];
}

// What an EPUB sample may carry besides its documents: styles, images, fonts, audio and video, the
// EPUB 2 table of contents and media overlays. Anything else in the package (a bundled PDF, a zip,
// data files) is dropped -- a reading sample does not need it.
const SAMPLE_MEDIA_TYPES = /^(application\/xhtml\+xml|text\/html|text\/css|image\/|audio\/|video\/|font\/|application\/(x-)?font|application\/vnd\.ms-opentype|application\/octet-stream|application\/x-dtbncx\+xml|application\/smil\+xml|application\/oebps-page-map\+xml)/i;

const startsWith = (bytes: Uint8Array, sig: number[], at = 0) => sig.every((b, i) => bytes[at + i] === b);
const ascii = (s: string) => Array.from(s, c => c.charCodeAt(0));

/**
 * A real image, font, audio or video file, by its first bytes. Anything else in a package is read
 * as text and checked, whatever it is labelled -- a search index or data file can hold the book's
 * text after a binary header.
 */
function isKnownMedia(bytes: Uint8Array): boolean {
  return startsWith(bytes, [0x89, 0x50, 0x4e, 0x47]) // PNG
    || startsWith(bytes, [0xff, 0xd8, 0xff]) // JPEG
    || startsWith(bytes, ascii('GIF8'))
    || (startsWith(bytes, ascii('RIFF')) && (startsWith(bytes, ascii('WEBP'), 8) || startsWith(bytes, ascii('WAVE'), 8)))
    || startsWith(bytes, ascii('ftyp'), 4) // MP4, M4A, AVIF, HEIC
    || startsWith(bytes, ascii('BM'))
    || startsWith(bytes, ascii('wOFF')) || startsWith(bytes, ascii('wOF2')) || startsWith(bytes, ascii('OTTO'))
    || startsWith(bytes, [0x00, 0x01, 0x00, 0x00]) || startsWith(bytes, ascii('true')) || startsWith(bytes, ascii('ttcf'))
    || startsWith(bytes, ascii('ID3')) || (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0) // MP3
    || startsWith(bytes, ascii('OggS')) || startsWith(bytes, ascii('fLaC'))
    || startsWith(bytes, [0x1a, 0x45, 0xdf, 0xa3]); // WebM, Matroska
}

/** A zip or PDF, whatever its label says. */
function isBundle(bytes: Uint8Array): boolean {
  return (bytes[0] === 0x50 && bytes[1] === 0x4b) // PK: zip
    || (bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46); // %PDF
}

/**
 * The EPUB up to (not including) `stopHref`, the location where the first chapter left out of the
 * sample starts (a path relative to the package document, optionally with #fragment). With
 * `links`, links into the left-out chapters lead to the store and the last document ends with a
 * closing note.
 */
export async function cutEpubSample(data: ArrayBuffer | Blob, stopHref: string, links?: SampleLinks): Promise<EpubSample> {
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
  if (stopIndex < 0) throw new Error('The chapter the sample stops at was not found in the product. Find the chapters again, then save.');
  if (stopIndex === 0 && !fragment) throw new Error('The sample would be empty. Include at least one chapter.');

  // Text of everything cut, for the isolation check at the end.
  const excluded: string[] = [];
  const titles: string[] = [];
  const paidCode: string[] = [];
  const bodyText = (source: string) => {
    const doc = new DOMParser().parseFromString(source, 'application/xhtml+xml');
    titles.push(chapterTitlesText(doc, links));
    const body = byLocalName(doc, 'body')[0];
    if (body) paidCode.push(...codeLinesOf([body]));
    return body ? spacedText(body) : '';
  };

  // The document the cut falls inside keeps what comes before the next chapter.
  let firstDropped = stopIndex;
  if (fragment) {
    const source = await zip.file(stopPath)?.async('string');
    const doc = source ? new DOMParser().parseFromString(source, 'application/xhtml+xml') : null;
    const stop = doc?.getElementById(fragment) ?? null;
    if (doc && stop) {
      titles.push(chapterTitlesText(doc, links));
      excluded.push(textFrom(stop));
      paidCode.push(...codeLinesOf(removedRoots(stop, false)));
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
    // srcset lists several images ("a.webp 1x, b.webp 2x"); each is in use.
    for (const m of text.matchAll(/srcset\s*=\s*["']([^"']+)["']/g)) {
      for (const candidate of m[1].split(',')) {
        const ref = candidate.trim().split(/\s+/)[0];
        if (ref && !/^[a-z]+:/i.test(ref)) mentioned.add(resolvePath(dirOf(path), ref));
      }
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
  // Files a reading sample does not need go: unexpected media types, and anything that is really a
  // zip or a PDF whatever it is labelled.
  for (const [id, item] of items) {
    const type = item.getAttribute('media-type') ?? '';
    const bytes = await zip.file(pathOf(item))?.async('uint8array');
    if (SAMPLE_MEDIA_TYPES.test(type) && !(bytes && isBundle(bytes))) continue;
    zip.remove(pathOf(item));
    item.parentNode?.removeChild(item);
    items.delete(id);
    // Leave no reference to it behind: a reading-order entry or another item's fallback.
    for (const ref of byLocalName(opf, 'itemref').filter(r => r.getAttribute('idref') === id)) ref.parentNode?.removeChild(ref);
    for (const other of items.values()) if (other.getAttribute('fallback') === id) other.removeAttribute('fallback');
  }
  // Every remaining file is read. Documents in the reading order (and the navigation document) are
  // what a reader sees; everything else that holds text -- the EPUB 2 table of contents, documents
  // outside the reading order, SVG images, any file labelled image, font or audio whose bytes are
  // in fact text -- is a carrier and is checked as such.
  const readingOrder = new Set(byLocalName(spine ?? opf, 'itemref').map(r => pathOf(items.get(r.getAttribute('idref') ?? ''))));
  const sampleSources: Carrier[] = [];
  const findings: SampleFinding[] = [];
  const docs = new Map<string, Document>();
  const shown = new Set<string>();
  for (const item of items.values()) {
    const type = item.getAttribute('media-type') ?? '';
    const path = pathOf(item);
    if (!/xhtml|html/i.test(type)) {
      const bytes = await zip.file(path)?.async('uint8array');
      if (!bytes) continue;
      if (/svg|xml|text|css|json|dtbncx/i.test(type) || !isKnownMedia(bytes)) {
        // Text types as UTF-8; anything else that is not real media byte by byte (latin1), so text
        // stored after a binary header still compares.
        const text = new TextDecoder(/svg|xml|text|css|json|dtbncx/i.test(type) ? 'utf-8' : 'latin1').decode(bytes);
        // The whole file goes to the carrier check, so text in an SVG's attributes (aria-label,
        // title, data-*) is read as well as its text nodes, and to the sampling check unchanged.
        sampleSources.push({ where: `the file ${path}`, text });
        if (/svg/i.test(type)) {
          const svg = new DOMParser().parseFromString(text, 'image/svg+xml');
          sampleSources.push({ where: `the image ${path}`, text: spacedText(svg) });
          for (const el of Array.from(svg.getElementsByTagName('*'))) {
            for (const attr of Array.from(el.attributes)) {
              if (attr.value.length > 20 && !/^\s*data:(?:image|font)\//i.test(attr.value) && !isSvgGeometry(el, attr.localName)) {
                sampleSources.push({ where: `the ${attr.name} attribute in the image ${path}`, text: attr.value });
              }
            }
          }
        }
      }
      continue;
    }
    const source = await zip.file(path)?.async('string');
    if (!source) continue;
    const doc = new DOMParser().parseFromString(source, 'application/xhtml+xml');
    stripPayloads(doc, false);
    for (const f of largeAttributes(doc)) addFinding(findings, `${f.where} in ${path}`, f.excerpt);
    const props = (item.getAttribute('properties') ?? '').split(/\s+/).filter(p => p && p !== 'scripted');
    if (props.length) item.setAttribute('properties', props.join(' '));
    else item.removeAttribute('properties');
    docs.set(path, doc);
    if (readingOrder.has(path) || props.includes('nav')) shown.add(path);
  }
  // Files under META-INF other than the ones the EPUB standard defines are dropped; the standard
  // ones that remain are read like any other file.
  for (const name of Object.keys(zip.files)) {
    if (!name.startsWith('META-INF/') || zip.files[name].dir) continue;
    if (!META_INF_FILES.has(name.slice('META-INF/'.length))) { zip.remove(name); continue; }
    if (name !== 'META-INF/container.xml') sampleSources.push({ where: `the file ${name}`, text: await zip.file(name)!.async('string') });
  }
  const serialize = (doc: Document) => XML_DECL + new XMLSerializer().serializeToString(doc).replace(/^<\?xml[^>]*>\s*/, '');
  const parts = [...docs].map(([path, doc]) => ({ path, ...carriersOf(doc) }));
  const visibleText = parts.filter(p => shown.has(p.path)).map(p => p.visible).join(' ');
  const carriers: Carrier[] = [
    ...parts.flatMap(p => p.carriers.map(c => ({ where: `${c.where} in ${p.path}`, text: c.text }))),
    // A document outside the reading order is not something a reader pages through.
    ...parts.filter(p => !shown.has(p.path)).map(p => ({ where: `a document outside the reading order (${p.path})`, text: p.visible })),
    ...sampleSources,
  ];
  for (const f of findLeftOutText(excluded.join(' '), visibleText, carriers, titles.join('. '), parts.flatMap(p => p.feedback), paidCode)) {
    addFinding(findings, f.where, f.excerpt);
  }
  // Checked before the store links and the closing note go in: they are ours, not the book's.
  const isolationSources = [...sampleSources.map(c => c.text), ...[...docs.values()].map(serialize)];

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
  for (const f of checkSubstantialCopy(excluded.join(' '), isolationSources.join('\n'))) addFinding(findings, f.where, f.excerpt);
  // The EPUB rule: "mimetype" first and stored uncompressed.
  zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' });
  const blob = await zip.generateAsync({ type: 'blob', mimeType: 'application/epub+zip', compression: 'DEFLATE' });
  return { blob, findings };
}
