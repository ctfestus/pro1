// @vitest-environment happy-dom
//
// The sample cutters (lib/books/sample.ts) run in the browser on DOMParser; happy-dom provides it.
// What matters most here: a free sample never carries text from the chapters left out of it.
import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { chaptersFromEpub, chaptersFromHtml, epubOutline } from '@/lib/books/chapters';
import { cutHtmlSample, cutEpubSample, SampleRefusedError, type EpubSample, type HtmlSample } from '@/lib/books/sample';

// A sample that may carry paid text is either refused outright (a substantial copy) or returned
// with findings for the author to review. Both count as "flagged"; "clean" means neither.
function flagged(cut: () => HtmlSample): boolean {
  try {
    return cut().findings.length > 0;
  } catch (e) {
    if (e instanceof SampleRefusedError) return true;
    throw e;
  }
}
function clean(cut: () => HtmlSample): boolean {
  return cut().findings.length === 0;
}
async function flaggedEpub(cut: Promise<EpubSample>): Promise<boolean> {
  try {
    return (await cut).findings.length > 0;
  } catch (e) {
    if (e instanceof SampleRefusedError) return true;
    throw e;
  }
}

async function makeEpub() {
  const zip = new JSZip();
  zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' });
  zip.file('META-INF/container.xml', '<?xml version="1.0"?><container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>');
  const x = (body: string) => `<?xml version="1.0" encoding="UTF-8"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>t</title></head><body>${body}</body></html>`;
  zip.file('OEBPS/c1.xhtml', x('<h1>One</h1><p>first</p><img src="img/a.png"/>'));
  zip.file('OEBPS/c2.xhtml', x('<h1 id="two">Two</h1><p>second</p><h1 id="three">Three</h1><p>third SECRET</p><img src="img/b.png"/>'));
  zip.file('OEBPS/c3.xhtml', x('<h1>Four</h1><p>fourth SECRET</p><img src="img/c.png"/>'));
  zip.file('OEBPS/nav.xhtml', x('<nav epub:type="toc" xmlns:epub="http://www.idpf.org/2007/ops"><ol><li><a href="c1.xhtml">One</a></li><li><a href="c2.xhtml#two">Two</a></li><li><a href="c2.xhtml#three">Three</a></li><li><a href="c3.xhtml">Four</a></li></ol></nav>'));
  for (const n of ['a', 'b', 'c']) zip.file(`OEBPS/img/${n}.png`, 'png');
  zip.file('OEBPS/content.opf', `<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0"><metadata/><manifest>
<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
<item id="c1" href="c1.xhtml" media-type="application/xhtml+xml"/><item id="c2" href="c2.xhtml" media-type="application/xhtml+xml"/><item id="c3" href="c3.xhtml" media-type="application/xhtml+xml"/>
<item id="a" href="img/a.png" media-type="image/png"/><item id="b" href="img/b.png" media-type="image/png"/><item id="c" href="img/c.png" media-type="image/png"/>
</manifest><spine><itemref idref="c1"/><itemref idref="c2"/><itemref idref="c3"/></spine></package>`);
  return zip.generateAsync({ type: 'arraybuffer' });
}

describe('EPUB', () => {
  it('cuts mid-document and drops later documents and their images', async () => {
    const data = await makeEpub();
    const { chapters, fromToc } = await chaptersFromEpub(data);
    expect(fromToc).toBe(true);
    expect(chapters.map(c => (c.locator as any).href)).toEqual(['c1.xhtml', 'c2.xhtml#two', 'c2.xhtml#three', 'c3.xhtml']);
    const sample = await cutEpubSample(data, 'c2.xhtml#three');
    expect(sample.findings).toEqual([]);
    const z = await JSZip.loadAsync(await sample.blob.arrayBuffer());
    const names = Object.keys(z.files);
    expect(names[0]).toBe('mimetype');
    expect(names).not.toContain('OEBPS/c3.xhtml');
    expect(names).not.toContain('OEBPS/img/c.png');
    expect(names).not.toContain('OEBPS/img/b.png');
    expect(names).toContain('OEBPS/img/a.png');
    const c2 = await z.file('OEBPS/c2.xhtml')!.async('string');
    expect(c2).toContain('second');
    expect(c2).not.toContain('SECRET');
    const opf = await z.file('OEBPS/content.opf')!.async('string');
    expect(opf).not.toContain('c3.xhtml');
    expect(opf).toContain('idref="c2"');
    const outline = await epubOutline(data);
    expect(outline.map(o => o.text)).toEqual(['One', 'Two', 'Four']);
  });

  it('cuts at a document boundary', async () => {
    const z = await JSZip.loadAsync(await (await cutEpubSample(await makeEpub(), 'c2.xhtml#two')).blob.arrayBuffer());
    // c2 opens with the cut point, so nothing of it is left: it goes too, not an empty page.
    expect(Object.keys(z.files)).not.toContain('OEBPS/c3.xhtml');
    expect(Object.keys(z.files)).not.toContain('OEBPS/c2.xhtml');
    expect(await z.file('OEBPS/content.opf')!.async('string')).not.toContain('idref="c2"');
  });
});

const para = (tag: string, n: number) => Array.from({ length: n }, (_, i) => `<p>${tag} paragraph ${i} explains the method with enough distinct words to be recognised later on ${tag}${i}.</p>`).join('');
const FREE = para('freechapter', 6);
const PAID = para('paidchapter', 30);
const PAID_TEXT = PAID.replace(/<[^>]+>/g, ' ');
const book = (head: string, beforeCut: string, after = '') => `<html><head><title>T</title>${head}</head><body><section id="one"><h2>One</h2>${FREE}${beforeCut}</section><section id="two"><h2>Two</h2>${PAID}</section>${after}</body></html>`;
const b64 = (n: number) => 'QUJD'.repeat(n);

describe('isolation', () => {
  it('refuses a script or template holding the left-out chapters, in head or before the cut', () => {
    const json = `<script type="application/json">${JSON.stringify(PAID_TEXT)}</script>`;
    expect(flagged(() => cutHtmlSample(book(json, ''), 'two'))).toBe(true);
    expect(flagged(() => cutHtmlSample(book('', json), 'two'))).toBe(true);
    expect(flagged(() => cutHtmlSample(book('', `<template>${PAID}</template>`), 'two'))).toBe(true);
    expect(flagged(() => cutHtmlSample(book('', `<div onclick="show('${PAID_TEXT.replace(/'/g, '')}')">x</div>`), 'two'))).toBe(true);
  });
  it('strips noscript fallbacks and comments, which carry content but no behaviour', () => {
    const out = cutHtmlSample(book('', `<noscript>${PAID}</noscript><!-- ${PAID_TEXT} -->`), 'two').html;
    expect(out).not.toContain('paidchapter');
    expect(out).toContain('freechapter');
  });
  it('refuses a hidden copy of later chapters before the cut', () => {
    expect(flagged(() => cutHtmlSample(book('', `<div hidden>${PAID}</div>`), 'two'))).toBe(true);
  });
  it('refuses later text in an attribute or CSS', () => {
    expect(() => cutHtmlSample(book('', `<div data-x="${PAID_TEXT}">x</div>`), 'two')).toThrow();
    expect(flagged(() => cutHtmlSample(book(`<style>.a::after{content:"${PAID_TEXT}"}</style>`, ''), 'two'))).toBe(true);
  });
  it('flags encoded payloads for review but allows embedded images and fonts', () => {
    const attr = cutHtmlSample(book('', `<div data-book="${b64(2000)}">x</div>`), 'two');
    expect(attr.findings.map(f => f.where).join(' ')).toContain('data-book');
    const css = cutHtmlSample(book(`<style>:root{--book:"${b64(2000)}"}</style>`, ''), 'two');
    expect(css.findings.map(f => f.where).join(' ')).toContain('encoded data');
    expect(clean(() => cutHtmlSample(book(`<style>@font-face{src:url(data:font/woff2;base64,${b64(3000)})}</style>`, `<img src="data:image/png;base64,${b64(3000)}"><div style="background:url(data:image/png;base64,${b64(3000)})">x</div>`), 'two'))).toBe(true);
  });
  it('allows fonts labelled octet-stream or EOT, large SVG drawings, and inlined code', () => {
    const fonts = `<style>@font-face{src:url(data:application/octet-stream;base64,${b64(3000)})} @font-face{src:url(data:application/vnd.ms-fontobject;base64,${b64(3000)})}</style>`;
    expect(clean(() => cutHtmlSample(book(fonts, ''), 'two'))).toBe(true);
    const path = 'M0 0 ' + Array.from({ length: 1500 }, (_, i) => `L${i} ${i % 7}`).join(' ');
    expect(clean(() => cutHtmlSample(book('', `<svg viewBox="0 0 10 10"><path d="${path}"/><polyline points="${path.replace(/[ML]/g, '')}"/></svg>`), 'two'))).toBe(true);
    const js = btoa('document.documentElement.dataset.ready = "1";'.repeat(200));
    const style = btoa('.box { color: #333; margin: 0 auto; }\n'.repeat(200));
    expect(clean(() => cutHtmlSample(book(`<script src="data:text/javascript;base64,${js}"></script><link rel="stylesheet" href="data:text/css;base64,${style}">`, ''), 'two'))).toBe(true);
  });
  it('reads an inlined script (data: URL) and flags paid text inside it', () => {
    const js = btoa(`var t = ${JSON.stringify(PAID_TEXT)};`);
    expect(flagged(() => cutHtmlSample(book(`<script src="data:text/javascript;base64,${js}"></script>`, ''), 'two'))).toBe(true);
  });
  it('refuses a book that builds its pages with scripts', () => {
    const html = `<html><head><script>render()</script></head><body><div id="app"></div><section id="two"><h2>Two</h2></section></body></html>`;
    expect(() => cutHtmlSample(html, 'two')).toThrow('builds its pages with scripts');
  });
});

describe('EPUB isolation', () => {
  async function epub(extra: (zip: JSZip) => void, c1Body = '<h1>One</h1>' + FREE) {
    const zip = new JSZip();
    zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' });
    zip.file('META-INF/container.xml', '<?xml version="1.0"?><container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>');
    const x = (b: string) => `<?xml version="1.0" encoding="UTF-8"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>t</title></head><body>${b}</body></html>`;
    zip.file('OEBPS/c1.xhtml', x(c1Body));
    zip.file('OEBPS/c2.xhtml', x('<h1>Two</h1>' + PAID));
    zip.file('OEBPS/app.js', `var book=${JSON.stringify(PAID_TEXT)}`);
    extra(zip);
    zip.file('OEBPS/content.opf', `<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0"><metadata/><manifest>
<item id="c1" href="c1.xhtml" media-type="application/xhtml+xml" properties="scripted"/><item id="c2" href="c2.xhtml" media-type="application/xhtml+xml"/><item id="js" href="app.js" media-type="application/javascript"/>
</manifest><spine><itemref idref="c1"/><itemref idref="c2"/></spine></package>`);
    return zip.generateAsync({ type: 'arraybuffer' });
  }
  it('drops script files and files the package does not list', async () => {
    const data = await epub(z => z.file('OEBPS/secret.txt', PAID_TEXT));
    const z = await JSZip.loadAsync(await (await cutEpubSample(data, 'c2.xhtml')).blob.arrayBuffer());
    expect(Object.keys(z.files)).not.toContain('OEBPS/app.js');
    expect(Object.keys(z.files)).not.toContain('OEBPS/secret.txt');
    const opf = await z.file('OEBPS/content.opf')!.async('string');
    expect(opf).not.toContain('scripted');
    expect(opf).not.toContain('app.js');
  });
  it('refuses a hidden copy in a kept document', async () => {
    const data = await epub(() => {}, '<h1>One</h1>' + FREE + '<div hidden="hidden">' + PAID + '</div>');
    expect(await flaggedEpub(cutEpubSample(data, 'c2.xhtml'))).toBe(true);
  });
});

describe('HTML chapters', () => {
  it('locates chapters by their section id and leaves the cover out', () => {
    const html = `<html><head><title>Field Guide</title></head><body><main id="top">
<section class="bookcover"><h1>Field Guide</h1></section>
<section id="contents"><h2>Contents</h2></section>
<section id="preface"><h2>Before you begin</h2><h2>Not a chapter</h2></section>
<section id="intro"><h2>Why read this</h2></section></main></body></html>`;
    expect(chaptersFromHtml(html)).toEqual([
      { title: 'Before you begin', locator: { anchor: 'preface' } },
      { title: 'Why read this', locator: { anchor: 'intro' } },
    ]);
  });
});

describe('HTML samples keep the book working', () => {
  const STORE = 'https://academy.example/books/field-guide';
  // Distinct prose per paragraph, like a real book: the leak check compares stretches of text, so
  // free and paid paragraphs built from one shared sentence would look like copies of each other.
  const prose = (tag: string, n: number) => Array.from({ length: n }, (_, i) =>
    `<p>${tag}${i} ${['harbour', 'lantern', 'meadow', 'quarry', 'violet', 'walnut', 'zephyr'][i % 7]}${i * 7} ` +
    `${['ledger', 'compass', 'orchard', 'pylon', 'saddle', 'tundra'][i % 6]}${i * 13} ${tag}notes${i} ` +
    `${['amber', 'basalt', 'cedar', 'delta', 'ember'][i % 5]}${i * 31} closing${tag}${i}.</p>`).join('');
  const page = `<html><head><title>T</title><style>.a{}</style><script>window.HEAD = 1</script></head><body>
<nav id="toc"><a href="#one">One</a> <a href="#two">Two</a> <a href="https://elsewhere.example">Elsewhere</a></nav>
<main><section id="one"><h2>One</h2>${prose('free', 12)}<button onclick="toggle()">Theme</button><div class="quiz" data-ok="1">Q</div></section>
<section id="two"><h2>Two</h2>${prose('paid', 40)}<script>var paidOnlyScript = 1</script></section></main>
<script>(function () { document.querySelectorAll('.quiz'); })()</script></body></html>`;

  it("keeps the page's scripts and handlers, including one placed after the cut", () => {
    const out = cutHtmlSample(page, 'two', { storeUrl: STORE, nextChapterTitle: 'Two' }).html;
    expect(out).toContain('window.HEAD = 1');
    expect(out).toContain("document.querySelectorAll('.quiz')");
    expect(out).toContain('onclick="toggle()"');
    expect(out).toContain('data-ok="1"');
    // A script inside a removed chapter goes with it.
    expect(out).not.toContain('paidOnlyScript');
    expect(out).not.toContain('closingpaid');
  });

  it('points links into left-out chapters at the store, labelled, and leaves the rest alone', () => {
    const doc = new DOMParser().parseFromString(cutHtmlSample(page, 'two', { storeUrl: STORE, nextChapterTitle: 'Two' }).html, 'text/html');
    const [one, two, elsewhere] = Array.from(doc.querySelectorAll('#toc a'));
    expect(one.getAttribute('href')).toBe('#one');
    expect(two.getAttribute('href')).toBe(STORE);
    expect(two.getAttribute('target')).toBe('_blank');
    expect(two.textContent).toContain('(in the full version)');
    expect(elsewhere.getAttribute('href')).toBe('https://elsewhere.example');
  });

  it('ends with a note naming the next chapter, before the kept page script', () => {
    const doc = new DOMParser().parseFromString(cutHtmlSample(page, 'two', { storeUrl: STORE, nextChapterTitle: 'Two <b>x</b>' }).html, 'text/html');
    const note = doc.querySelector('[data-sample-end]')!;
    expect(note.textContent).toContain('This is the end of the free sample.');
    expect(note.textContent).toContain('The full version continues with Two <b>x</b>.');
    expect(note.querySelector('b')).toBeNull(); // a title is text, never markup
    expect(note.querySelector('a')!.getAttribute('href')).toBe(STORE);
    expect(note.parentElement!.localName).toBe('main');
  });

  it('writes no link for a store URL that is not http(s)', () => {
    const out = cutHtmlSample(page, 'two', { storeUrl: 'javascript:alert(1)' }).html;
    expect(out).not.toContain('javascript:alert');
    expect(out).not.toContain('data-sample-end');
  });
});

describe('EPUB samples link to the full book', () => {
  it('relabels links to removed documents and ends the last document with the note', async () => {
    const STORE = 'https://academy.example/books/field-guide';
    const z = await JSZip.loadAsync(await (await cutEpubSample(await makeEpub(), 'c2.xhtml#three', { storeUrl: STORE, nextChapterTitle: 'Three' })).blob.arrayBuffer());
    const nav = await z.file('OEBPS/nav.xhtml')!.async('string');
    const navDoc = new DOMParser().parseFromString(nav, 'application/xhtml+xml');
    const hrefs = Array.from(navDoc.getElementsByTagName('a')).map(a => a.getAttribute('href'));
    expect(hrefs).toEqual(['c1.xhtml', 'c2.xhtml#two', STORE, STORE]);
    expect(nav).toContain('(in the full version)');
    const last = await z.file('OEBPS/c2.xhtml')!.async('string');
    expect(last).toContain('This is the end of the free sample.');
    expect(last).toContain('The full version continues with Three.');
    expect(last).not.toContain('SECRET');
  });
});

describe('partial copies of left-out chapters are refused', () => {
  const words = ['harbour', 'lantern', 'meadow', 'quarry', 'violet', 'walnut', 'zephyr', 'ledger', 'compass', 'orchard', 'pylon', 'saddle', 'tundra', 'amber', 'basalt', 'cedar', 'delta', 'ember'];
  // Distinct prose: every sentence different, as in a real book.
  const sentence = (tag: string, i: number) =>
    `${tag} ${words[i % 18]}${i} ${words[(i * 5) % 18]}${i * 3} ${words[(i * 7) % 18]}${i * 11} ${words[(i * 11) % 18]}${i * 17} ${words[(i * 13) % 18]}${i * 19} ${tag}end${i}`;
  const prose = (tag: string, n: number) => Array.from({ length: n }, (_, i) => `<p>${sentence(tag, i)}.</p>`).join('');
  const paidParagraphs = (from: number, to: number) => Array.from({ length: to - from }, (_, k) => sentence('paid', from + k)).join(' ');
  const page = (head: string, extraFree: string) => `<html><head><title>T</title>${head}</head><body>
<nav><a href="#one">One</a> <a href="#two">The second chapter has a long title of many words</a></nav>
<section id="one"><h2>One</h2>${prose('free', 15)}${extraFree}</section>
<section id="two"><h2>The second chapter has a long title of many words</h2>${prose('paid', 60)}</section>
</body></html>`;

  it('refuses a kept script holding a few paragraphs of a paid chapter (about 500 characters)', () => {
    const partial = paidParagraphs(20, 28);
    expect(partial.length).toBeGreaterThan(500);
    expect(flagged(() => cutHtmlSample(page('', `<script>var extra = ${JSON.stringify(partial)};</script>`), 'two'))).toBe(true);
    expect(flagged(() => cutHtmlSample(page(`<script type="application/json">${JSON.stringify({ q: partial })}</script>`, ''), 'two'))).toBe(true);
  });

  it('refuses two sentences of a paid chapter (14 words) in a data attribute, a style or a template', () => {
    const one = paidParagraphs(33, 35);
    expect(flagged(() => cutHtmlSample(page('', `<div data-explain="${one}">x</div>`), 'two'))).toBe(true);
    expect(flagged(() => cutHtmlSample(page(`<style>.x::after{content:"${one}"}</style>`, ''), 'two'))).toBe(true);
    expect(flagged(() => cutHtmlSample(page('', `<template><p>${one}</p></template>`), 'two'))).toBe(true);
  });

  it('allows what the reader can already see, such as a paid chapter title listed in the contents', () => {
    const out = cutHtmlSample(page('', `<script>var titles = ["The second chapter has a long title of many words"];</script><button data-label="free ${words[1]}1 ${words[5]}3 ${words[7]}11 ${words[11]}17 ${words[13]}19 freeend1">x</button>`), 'two').html;
    expect(out).toContain('var titles');
    expect(out).not.toContain('paidend');
  });

  it('allows a copy button holding free text that the page shows split across elements', () => {
    // As a real book does: the visible prompt is split into lines with a tag after each, and the
    // copy button holds the same prompt whole. A paid chapter later quotes the prompt again.
    const prompt = 'You have recently joined a new fintech company as a Competitive Research Analyst. Identify five leading fintech companies operating in Africa, including Paystack.';
    const shown = '<div class="pl"><span class="pt">You have recently joined a new fintech company as a Competitive Research Analyst.</span><span class="ptag">Role</span></div><div class="pl"><span class="pt">Identify five leading fintech companies operating in Africa, including Paystack.</span><span class="ptag">Task</span></div>';
    const html = `<html><head><title>T</title></head><body>
<section id="one"><h2>One</h2>${prose('free', 15)}<button class="copy" data-code="${prompt}">Copy</button>${shown}</section>
<section id="two"><h2>Two</h2>${prose('paid', 60)}<p>${prompt}</p></section></body></html>`;
    expect(clean(() => cutHtmlSample(html, 'two'))).toBe(true);
  });

  it('does not let a hidden copy vouch for a script copy (hidden text is not visible text)', () => {
    const partial = paidParagraphs(20, 28);
    const script = `<script>var extra = ${JSON.stringify(partial)};</script>`;
    expect(flagged(() => cutHtmlSample(page('', `<div hidden>${partial}</div>${script}`), 'two'))).toBe(true);
  });

  it('refuses a partial copy hidden by attribute, inline style or the book stylesheet', () => {
    const partial = paidParagraphs(44, 46);
    expect(flagged(() => cutHtmlSample(page('', `<div hidden><p>${partial}</p></div>`), 'two'))).toBe(true);
    expect(flagged(() => cutHtmlSample(page('', `<div style="display: none">${partial}</div>`), 'two'))).toBe(true);
    expect(flagged(() => cutHtmlSample(page('<style>.later { display:none }</style>', `<div class="later">${partial}</div>`), 'two'))).toBe(true);
  });

  it('allows a contents menu hidden on every screen when it only lists paid chapter titles', () => {
    const html = page('<style>.toc { display: none }</style>',
      '<nav class="toc"><a href="#two">The second chapter has a long title of many words</a></nav><p class="qe" hidden>Correct, well done.</p>');
    expect(clean(() => cutHtmlSample(html, 'two'))).toBe(true);
  });

  it('ignores print-only rules, which hide nothing on screen', () => {
    // A free cover the print stylesheet hides, quoting text a paid chapter repeats.
    const quoted = paidParagraphs(50, 52);
    const html = page('<style>@media print { .cover { display: none } } @media only print and (orientation: portrait) { .cover { display: none } }</style>',
      `<div class="cover"><p>${quoted}</p></div><button data-code="${quoted}">Copy</button>`);
    expect(clean(() => cutHtmlSample(html, 'two'))).toBe(true);
  });

  it('counts every other media rule as hiding: screen, all, width queries, supports', () => {
    const partial = paidParagraphs(20, 28);
    const script = `<script>var extra = ${JSON.stringify(partial)};</script>`;
    for (const css of [
      '@media screen { .later { display:none } }',
      '@media all { .later { display:none } }',
      '@media screen and (min-width: 1px) { .later { display:none } }',
      '@media (max-width: 600px) { .later { display:none } }',
      '@media print, screen { .later { visibility: hidden } }',
      '@supports (display: grid) { @media screen { .later { display:none } } }',
    ]) {
      expect(flagged(() => cutHtmlSample(page(`<style>${css}</style>`, `<div class="later">${partial}</div>${script}`), 'two')), css).toBe(true);
    }
  });

  it('refuses a partial copy in an EPUB document attribute', async () => {
    const zip = new JSZip();
    zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' });
    zip.file('META-INF/container.xml', '<?xml version="1.0"?><container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>');
    const x = (b: string) => `<?xml version="1.0" encoding="UTF-8"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>t</title></head><body>${b}</body></html>`;
    zip.file('OEBPS/c1.xhtml', x(`<h1>One</h1>${prose('free', 15)}<div title="${paidParagraphs(40, 42)}">x</div>`));
    zip.file('OEBPS/c2.xhtml', x(`<h1>Two</h1>${prose('paid', 60)}`));
    zip.file('OEBPS/content.opf', `<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0"><metadata/><manifest>
<item id="c1" href="c1.xhtml" media-type="application/xhtml+xml"/><item id="c2" href="c2.xhtml" media-type="application/xhtml+xml"/>
</manifest><spine><itemref idref="c1"/><itemref idref="c2"/></spine></package>`);
    const data = await zip.generateAsync({ type: 'arraybuffer' });
    expect(await flaggedEpub(cutEpubSample(data, 'c2.xhtml'))).toBe(true);
  });
});

describe('legitimate repetition is not a leak', () => {
  const words = ['harbour', 'lantern', 'meadow', 'quarry', 'violet', 'walnut', 'zephyr', 'ledger', 'compass', 'orchard', 'pylon', 'saddle', 'tundra', 'amber', 'basalt', 'cedar', 'delta', 'ember'];
  const sentence = (tag: string, i: number) =>
    `${tag} ${words[i % 18]}${i} ${words[(i * 5) % 18]}${i * 3} ${words[(i * 7) % 18]}${i * 11} ${words[(i * 11) % 18]}${i * 17} ${words[(i * 13) % 18]}${i * 19} ${tag}end${i}`;
  const prose = (tag: string, n: number) => Array.from({ length: n }, (_, i) => `<p>${sentence(tag, i)}.</p>`).join('');
  const explanation = (i: number) => `${sentence('answer', i)}. ${sentence('answer', i + 40)}.`;
  // A quiz as real books build it: several answer buttons, and an explanation hidden until answered.
  const quiz = (i: number) => `<div class="quiz"><p>Question ${i}?</p><button data-ok="1">A</button><button>B</button><button>C</button><p class="qe" hidden>${explanation(i)}</p></div>`;
  const book = (free: string, paid: string) => `<html><head><title>T</title><style>.quiz .qe { display: none }</style></head><body>
<section id="one"><h2>One</h2>${prose('free', 15)}${free}</section>
<section id="answers"><h2>Answers to the exercises</h2>${prose('paid', 400)}${paid}</section></body></html>`;

  // The paid part is the rest of a book (400 sentences here), as it is for a real sample: the
  // explanations repeated in its answers chapter are a small share of it.
  it("allows quiz explanations in the free chapters that the paid answers chapter repeats", () => {
    const answers = [1, 2, 3].map(i => `<p>${explanation(i)}</p>`).join('');
    const out = cutHtmlSample(book([1, 2, 3].map(quiz).join(''), answers), 'answers').html;
    expect(out).toContain('class="qe"');
    expect(out).not.toContain('paidend');
  });

  it('allows a paid chapter that repeats visible free text (a prompt library, a summary)', () => {
    const repeated = prose('free', 15);
    expect(clean(() => cutHtmlSample(book('', repeated + repeated), 'answers'))).toBe(true);
  });

  it('still refuses paid text hidden next to a single Copy button, which is not a quiz', () => {
    const paid = `${sentence('paid', 7)}. ${sentence('paid', 8)}.`;
    expect(flagged(() => cutHtmlSample(book(`<div class="card"><button class="copy">Copy</button><p hidden>${paid}</p></div>`, ''), 'answers'))).toBe(true);
  });

  it('still refuses a paid chapter split into many small hidden pieces', () => {
    const pieces = Array.from({ length: 12 }, (_, k) => `<span hidden>${sentence('paid', k)}. ${sentence('paid', k + 1)}.</span>`).join('');
    expect(flagged(() => cutHtmlSample(book(pieces, ''), 'answers'))).toBe(true);
  });

  it('does not count a chapter-wide container as a quiz widget', () => {
    const paid = `${sentence('paid', 9)}. ${sentence('paid', 10)}.`;
    // Buttons elsewhere in the section do not make a hidden block in it a quiz explanation.
    const html = `<html><head><title>T</title></head><body>
<section id="one"><h2>One</h2>${prose('free', 15)}<button>A</button><button>B</button><p hidden>${paid}</p></section>
<section id="answers"><h2>Answers</h2>${prose('paid', 40)}</section></body></html>`;
    expect(flagged(() => cutHtmlSample(html, 'answers'))).toBe(true);
  });
});

describe('the quiz exception cannot be used to smuggle paid text', () => {
  const words = ['harbour', 'lantern', 'meadow', 'quarry', 'violet', 'walnut', 'zephyr', 'ledger', 'compass', 'orchard', 'pylon', 'saddle', 'tundra', 'amber', 'basalt', 'cedar', 'delta', 'ember'];
  const sentence = (tag: string, i: number) =>
    `${tag} ${words[i % 18]}${i} ${words[(i * 5) % 18]}${i * 3} ${words[(i * 7) % 18]}${i * 11} ${words[(i * 11) % 18]}${i * 17} ${words[(i * 13) % 18]}${i * 19} ${tag}end${i}`;
  const prose = (tag: string, n: number) => Array.from({ length: n }, (_, i) => `<p>${sentence(tag, i)}.</p>`).join('');
  const paidChapter = prose('paid', 40);
  const paidText = paidChapter.replace(/<[^>]+>/g, ' ');
  const book = (free: string, head = '') => `<html><head><title>T</title>${head}</head><body>
<section id="one"><h2>One</h2>${prose('free', 15)}${free}</section>
<section id="two"><h2>Two</h2>${paidChapter}</section></body></html>`;

  it('refuses a whole paid chapter hidden beside Copy and Theme buttons (not a quiz)', () => {
    const html = book(`<div class="tools"><button class="copy">Copy</button><button class="theme">Dark</button><div hidden>${paidChapter}</div></div>`);
    expect(flagged(() => cutHtmlSample(html, 'two'))).toBe(true);
  });

  it('refuses a script holding the paid chapter even beside fake quiz feedback with the same text', () => {
    const fake = `<div class="quiz"><button>A</button><button>B</button><p class="qe" hidden>${sentence('paid', 3)}. ${sentence('paid', 4)}.</p></div>`;
    const html = book(`${fake}<script>var book = ${JSON.stringify(paidText)};</script>`);
    expect(flagged(() => cutHtmlSample(html, 'two'))).toBe(true);
  });

  it('refuses a whole paid chapter hidden as the "explanation" of a real-looking quiz', () => {
    const html = book(`<div class="quiz"><button>A</button><button>B</button><p class="qe" hidden>${paidText}</p></div>`);
    expect(flagged(() => cutHtmlSample(html, 'two'))).toBe(true);
  });

  it('refuses a paid chapter spread over many quizzes once explanations outgrow a book\'s quizzes', () => {
    const quizzes = Array.from({ length: 40 }, (_, k) =>
      `<div class="quiz"><button>A</button><button>B</button><p class="qe" hidden>${sentence('paid', k)}. ${sentence('paid', (k + 1) % 40)}. ${sentence('paid', (k + 2) % 40)}.</p></div>`).join('');
    // 40 explanations of three paid sentences: far beyond a small share of a short free chapter.
    expect(flagged(() => cutHtmlSample(book(quizzes), 'two'))).toBe(true);
  });

  it('refuses a "quiz" whose only buttons are tools', () => {
    const html = book(`<div class="quiz"><button class="copy">Copy</button><button class="theme">Theme</button><p hidden>${sentence('paid', 5)}. ${sentence('paid', 6)}.</p></div>`);
    expect(flagged(() => cutHtmlSample(html, 'two'))).toBe(true);
  });

  it('refuses a data attribute or style copy of a quiz explanation that a paid chapter holds', () => {
    const exp = `${sentence('paid', 8)}. ${sentence('paid', 9)}.`;
    const quiz = `<div class="quiz"><button>A</button><button>B</button><p class="qe" hidden>${exp}</p></div>`;
    expect(flagged(() => cutHtmlSample(book(`${quiz}<div data-x="${exp}">x</div>`), 'two'))).toBe(true);
    expect(flagged(() => cutHtmlSample(book(quiz, `<style>.z::after{content:"${exp}"}</style>`), 'two'))).toBe(true);
  });
});

describe('second adversarial review: every reproduced bypass is refused', () => {
  const words = ['harbour', 'lantern', 'meadow', 'quarry', 'violet', 'walnut', 'zephyr', 'ledger', 'compass', 'orchard', 'pylon', 'saddle', 'tundra', 'amber', 'basalt', 'cedar', 'delta', 'ember'];
  const sentence = (tag: string, i: number) =>
    `${tag} ${words[i % 18]}${i} ${words[(i * 5) % 18]}${i * 3} ${words[(i * 7) % 18]}${i * 11} ${words[(i * 11) % 18]}${i * 17} ${words[(i * 13) % 18]}${i * 19} ${tag}end${i}`;
  const prose = (tag: string, n: number) => Array.from({ length: n }, (_, i) => `<p>${sentence(tag, i)}.</p>`).join('');
  const paidChapter = prose('paid', 40);
  const paidText = paidChapter.replace(/<[^>]+>/g, ' ');
  const book = (free: string, head = '', paid = paidChapter) => `<html><head><title>T</title>${head}</head><body>
<section id="one"><h2>One</h2>${prose('free', 15)}${free}</section>
<section id="two"><h2>Two</h2>${paid}</section></body></html>`;
  const quiz = (exp: string, a = 'A', b = 'B') => `<div class="quiz"><button>${a}</button><button>${b}</button><p class="qe" hidden>${exp}</p></div>`;

  it('refuses a paid chapter split into 35 short quiz explanations', () => {
    const quizzes = Array.from({ length: 35 }, (_, k) => quiz(`${sentence('paid', k)}.`)).join('');
    expect(flagged(() => cutHtmlSample(book(quizzes), 'two'))).toBe(true);
  });

  it('refuses explanations that repeat more than a page of a long book', () => {
    const quizzes = Array.from({ length: 35 }, (_, k) => quiz(`${sentence('paid', k)}. ${sentence('paid', k + 100)}.`)).join('');
    expect(flagged(() => cutHtmlSample(book(quizzes, '', prose('paid', 400)), 'two'))).toBe(true);
  });

  it('keeps the quiz exception for answers worded "Copy the report" and "Share the report"', () => {
    const exp = `${sentence('answer', 1)}.`;
    const answers = Array.from({ length: 6 }, () => `<p>${exp}</p>`).join('');
    const html = book(quiz(exp, 'Copy the report', 'Share the report'), '', prose('paid', 400) + answers);
    expect(clean(() => cutHtmlSample(html, 'two'))).toBe(true);
  });

  it.each([
    ['opacity 0', 'style="opacity:0;height:0;overflow:hidden"'],
    ['off screen', 'style="position:absolute;left:-99999px"'],
    ['zero font size', 'style="font-size:0"'],
    ['a commented display:none', 'style="display:/**/none"'],
    ['a class the page hides with an external stylesheet', 'class="sr-only"'],
  ])('refuses a whole paid chapter hidden by %s', (_label, attrs) => {
    expect(flagged(() => cutHtmlSample(book(`<div ${attrs}>${paidChapter}</div>`), 'two'))).toBe(true);
  });

  it('refuses a script copy written with soft hyphens or zero-width spaces', () => {
    const disguised = paidText.replace(/(\w{3})(\w)/g, '$1\u00ad$2').replace(/ end/g, '\u200b end');
    expect(flagged(() => cutHtmlSample(book(`<script>var t = ${JSON.stringify(disguised)};</script>`), 'two'))).toBe(true);
  });

  it('refuses paid text in the page title or an SVG description', () => {
    const two = `${sentence('paid', 12)}. ${sentence('paid', 13)}.`;
    expect(flagged(() => cutHtmlSample(book('', `<title>${two}</title>`), 'two'))).toBe(true);
    expect(flagged(() => cutHtmlSample(book(`<svg><desc>${two}</desc><rect width="1" height="1"/></svg>`), 'two'))).toBe(true);
  });

  it('does not exempt lower headings of paid chapters as if they were chapter titles', () => {
    const h4s = Array.from({ length: 3 }, (_, k) => `<h4>${sentence('paid', 60 + k)}</h4>`).join('');
    const script = `<script>var h = ${JSON.stringify(Array.from({ length: 3 }, (_, k) => sentence('paid', 60 + k)))};</script>`;
    expect(flagged(() => cutHtmlSample(book(script, '', paidChapter + h4s), 'two', { storeUrl: '', chapterTitles: ['One', 'Two'] }))).toBe(true);
  });

  describe('EPUB', () => {
    async function epub(opts: { manifest?: string; files?: Record<string, string>; c1?: string; ncx?: string }) {
      const zip = new JSZip();
      zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' });
      zip.file('META-INF/container.xml', '<?xml version="1.0"?><container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>');
      const x = (b: string) => `<?xml version="1.0" encoding="UTF-8"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>t</title></head><body>${b}</body></html>`;
      zip.file('OEBPS/c1.xhtml', x(`<h1>One</h1>${prose('free', 15)}${opts.c1 ?? ''}`));
      zip.file('OEBPS/c2.xhtml', x(`<h1>Two</h1>${paidChapter}`));
      for (const [name, body] of Object.entries(opts.files ?? {})) zip.file(name, body);
      zip.file('OEBPS/content.opf', `<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0"><metadata/><manifest>
<item id="c1" href="c1.xhtml" media-type="application/xhtml+xml"/><item id="c2" href="c2.xhtml" media-type="application/xhtml+xml"/>${opts.manifest ?? ''}
</manifest><spine><itemref idref="c1"/><itemref idref="c2"/></spine></package>`);
      return zip.generateAsync({ type: 'arraybuffer' });
    }
    const xhtml = (b: string) => `<?xml version="1.0" encoding="UTF-8"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>t</title></head><body>${b}</body></html>`;

    it('refuses a copy in a document outside the reading order', async () => {
      const data = await epub({ manifest: '<item id="all" href="all.xhtml" media-type="application/xhtml+xml"/>', files: { 'OEBPS/all.xhtml': xhtml(paidChapter) } });
      expect(await flaggedEpub(cutEpubSample(data, 'c2.xhtml'))).toBe(true);
    });

    it('refuses a copy inside the EPUB 2 table of contents', async () => {
      const ncx = `<?xml version="1.0"?><ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1"><docTitle><text>${paidText}</text></docTitle><navMap/></ncx>`;
      const data = await epub({ manifest: '<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>', files: { 'OEBPS/toc.ncx': ncx } });
      expect(await flaggedEpub(cutEpubSample(data, 'c2.xhtml'))).toBe(true);
    });

    it('drops unknown META-INF files and refuses text disguised as a font or an image', async () => {
      const plain = await JSZip.loadAsync(await (await cutEpubSample(await epub({ files: { 'META-INF/notes.txt': paidText } }), 'c2.xhtml')).blob.arrayBuffer());
      expect(Object.keys(plain.files)).not.toContain('META-INF/notes.txt');
      const font = await epub({ manifest: '<item id="f" href="f.woff" media-type="application/x-font-notes"/>', files: { 'OEBPS/f.woff': paidText } });
      expect(await flaggedEpub(cutEpubSample(font, 'c2.xhtml'))).toBe(true);
      const img = await epub({ c1: '<img src="p.png"/>', manifest: '<item id="p" href="p.png" media-type="image/png"/>', files: { 'OEBPS/p.png': paidText } });
      expect(await flaggedEpub(cutEpubSample(img, 'c2.xhtml'))).toBe(true);
    });

    it('refuses paid text in an SVG attribute such as aria-label', async () => {
      const two = `${sentence('paid', 22)}. ${sentence('paid', 23)}.`;
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" aria-label="${two}"><rect width="1" height="1"/></svg>`;
      const data = await epub({ c1: '<img src="a.svg"/>', manifest: '<item id="a" href="a.svg" media-type="image/svg+xml"/>', files: { 'OEBPS/a.svg': svg } });
      expect(await flaggedEpub(cutEpubSample(data, 'c2.xhtml'))).toBe(true);
    });

    it('refuses paid text in an SVG image the free chapter shows', async () => {
      const svg = `<svg xmlns="http://www.w3.org/2000/svg"><desc>${sentence('paid', 20)}. ${sentence('paid', 21)}.</desc></svg>`;
      const data = await epub({ c1: '<img src="f.svg"/>', manifest: '<item id="s" href="f.svg" media-type="image/svg+xml"/>', files: { 'OEBPS/f.svg': svg } });
      expect(await flaggedEpub(cutEpubSample(data, 'c2.xhtml'))).toBe(true);
    });
  });
});

describe('author review: refuse only substantial copies, report the rest', () => {
  const words = ['harbour', 'lantern', 'meadow', 'quarry', 'violet', 'walnut', 'zephyr', 'ledger', 'compass', 'orchard', 'pylon', 'saddle', 'tundra', 'amber', 'basalt', 'cedar', 'delta', 'ember'];
  const sentence = (tag: string, i: number) =>
    `${tag} ${words[i % 18]}${i} ${words[(i * 5) % 18]}${i * 3} ${words[(i * 7) % 18]}${i * 11} ${words[(i * 11) % 18]}${i * 17} ${words[(i * 13) % 18]}${i * 19} ${tag}end${i}`;
  const prose = (tag: string, n: number) => Array.from({ length: n }, (_, i) => `<p>${sentence(tag, i)}.</p>`).join('');
  const paidChapter = prose('paid', 40);
  const book = (free: string, head = '') => `<html><head><title>T</title>${head}</head><body>
<section id="one"><h2>One</h2>${prose('free', 15)}${free}</section>
<section id="two"><h2>Two</h2>${paidChapter}</section></body></html>`;

  it('refuses outright when much of the paid text is in the sample', () => {
    expect(() => cutHtmlSample(book(`<div hidden>${paidChapter}</div>`), 'two')).toThrow(SampleRefusedError);
  });

  it('reports a partial copy with where it is and the matching text, and still returns the sample', () => {
    const two = `${sentence('paid', 30)}. ${sentence('paid', 31)}.`;
    const result = cutHtmlSample(book(`<div class="note" hidden>${two}</div>`), 'two');
    expect(result.html).toContain('freeend');
    expect(result.findings[0].where).toBe('hidden content (div element .note)');
    expect(result.findings[0].excerpt).toContain('paidend30');
  });

  it('ignores a <style media="print"> sheet when deciding what is hidden', () => {
    const quoted = `${sentence('paid', 5)}. ${sentence('paid', 6)}.`;
    expect(clean(() => cutHtmlSample(book(`<div class="cover"><p>${quoted}</p></div><button data-code="${quoted}">Copy</button>`, '<style media="print">.cover { display: none }</style>'), 'two'))).toBe(true);
  });

  it('flags paid text encoded as octet-stream outside a font, in a script or an attribute', () => {
    const b = btoa(paidChapter.replace(/<[^>]+>/g, ' '));
    expect(flagged(() => cutHtmlSample(book(`<script>var idx = "data:application/octet-stream;base64,${b}";</script>`), 'two'))).toBe(true);
    expect(flagged(() => cutHtmlSample(book(`<div data-idx="data:application/octet-stream;base64,${b}">x</div>`), 'two'))).toBe(true);
  });

  it('decodes and flags a text data URL written inside a script', () => {
    const b = btoa(JSON.stringify({ text: paidChapter.replace(/<[^>]+>/g, ' ') }));
    expect(flagged(() => cutHtmlSample(book(`<script>var idx = "data:application/json;base64,${b}";</script>`), 'two'))).toBe(true);
  });

  it('exempts drawing attributes only on SVG elements', () => {
    const two = `${sentence('paid', 26)}. ${sentence('paid', 27)}.`;
    expect(flagged(() => cutHtmlSample(book(`<div values="${two}">x</div>`), 'two'))).toBe(true);
  });

  it('never names an element with angle brackets', () => {
    const two = `${sentence('paid', 28)}. ${sentence('paid', 29)}.`;
    const result = cutHtmlSample(book(`<span class="tip" hidden>${two}</span><abbr title="${two}">x</abbr>`), 'two');
    expect(result.findings.length).toBeGreaterThan(0);
    for (const f of result.findings) expect(f.where).not.toMatch(/[<>]/);
  });

  describe('EPUB', () => {
    const x = (b: string) => `<?xml version="1.0" encoding="UTF-8"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>t</title></head><body>${b}</body></html>`;
    async function epub(c1: string, manifest: string, files: Record<string, string | Uint8Array>) {
      const zip = new JSZip();
      zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' });
      zip.file('META-INF/container.xml', '<?xml version="1.0"?><container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>');
      zip.file('OEBPS/c1.xhtml', x(`<h1>One</h1>${prose('free', 15)}${c1}`));
      zip.file('OEBPS/c2.xhtml', x(`<h1>Two</h1>${paidChapter}`));
      for (const [name, body] of Object.entries(files)) zip.file(name, body);
      zip.file('OEBPS/content.opf', `<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0"><metadata/><manifest>
<item id="c1" href="c1.xhtml" media-type="application/xhtml+xml"/><item id="c2" href="c2.xhtml" media-type="application/xhtml+xml"/>${manifest}
</manifest><spine><itemref idref="c1"/><itemref idref="c2"/></spine></package>`);
      return zip.generateAsync({ type: 'arraybuffer' });
    }

    it('drops a bundled zip or PDF, whatever it is labelled', async () => {
      const inner = new JSZip();
      inner.file('fullbook.txt', paidChapter);
      const zipped = await inner.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
      const data = await epub('', '<item id="z" href="extras/book.zip" media-type="application/zip"/><item id="p" href="extras/book.pdf" media-type="application/octet-stream"/>',
        { 'OEBPS/extras/book.zip': zipped, 'OEBPS/extras/book.pdf': `%PDF-1.7 ${paidChapter}` });
      const z = await JSZip.loadAsync(await (await cutEpubSample(data, 'c2.xhtml')).blob.arrayBuffer());
      expect(Object.keys(z.files).filter(n => !z.files[n].dir && n.includes('extras/'))).toEqual([]);
      expect(await z.file('OEBPS/content.opf')!.async('string')).not.toContain('extras/');
    });

    it('reads a binary-looking data file and flags paid text stored after its header', async () => {
      const header = new Uint8Array(100).map((_, i) => (i * 37) % 256);
      const text = new TextEncoder().encode(paidChapter.replace(/<[^>]+>/g, ' '));
      const db = new Uint8Array(header.length + text.length);
      db.set(header);
      db.set(text, header.length);
      const data = await epub('', '<item id="s" href="search.db" media-type="application/octet-stream"/>', { 'OEBPS/search.db': db });
      expect(await flaggedEpub(cutEpubSample(data, 'c2.xhtml'))).toBe(true);
    });

    it('unlinks a dropped file from the reading order', async () => {
      const data = await epub('', '<item id="z" href="extras/book.zip" media-type="application/zip"/>', { 'OEBPS/extras/book.zip': 'PKdata' });
      const z = await JSZip.loadAsync(await (await cutEpubSample(data, 'c2.xhtml')).blob.arrayBuffer());
      const opf = await z.file('OEBPS/content.opf')!.async('string');
      expect(opf).not.toContain('idref="z"');
    });

    it('keeps an image a free chapter uses only through srcset', async () => {
      const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
      const data = await epub('<picture><source srcset="img/hero.webp 1x"/><img src="img/hero.png"/></picture>',
        '<item id="w" href="img/hero.webp" media-type="image/webp"/><item id="h" href="img/hero.png" media-type="image/png"/>',
        { 'OEBPS/img/hero.webp': png, 'OEBPS/img/hero.png': png });
      const z = await JSZip.loadAsync(await (await cutEpubSample(data, 'c2.xhtml')).blob.arrayBuffer());
      expect(Object.keys(z.files)).toContain('OEBPS/img/hero.webp');
    });
  });
});

