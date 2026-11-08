// @vitest-environment happy-dom
//
// The sample cutters (lib/books/sample.ts) run in the browser on DOMParser; happy-dom provides it.
// What matters most here: a free sample never carries text from the chapters left out of it.
import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { chaptersFromEpub, chaptersFromHtml, epubOutline } from '@/lib/books/chapters';
import { cutHtmlSample, cutEpubSample } from '@/lib/books/sample';

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
    const z = await JSZip.loadAsync(await sample.arrayBuffer());
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
    const z = await JSZip.loadAsync(await (await cutEpubSample(await makeEpub(), 'c2.xhtml#two')).arrayBuffer());
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
    expect(() => cutHtmlSample(book(json, ''), 'two')).toThrow('stored elsewhere');
    expect(() => cutHtmlSample(book('', json), 'two')).toThrow('stored elsewhere');
    expect(() => cutHtmlSample(book('', `<template>${PAID}</template>`), 'two')).toThrow('stored elsewhere');
    expect(() => cutHtmlSample(book('', `<div onclick="show('${PAID_TEXT.replace(/'/g, '')}')">x</div>`), 'two')).toThrow('stored elsewhere');
  });
  it('strips noscript fallbacks and comments, which carry content but no behaviour', () => {
    const out = cutHtmlSample(book('', `<noscript>${PAID}</noscript><!-- ${PAID_TEXT} -->`), 'two');
    expect(out).not.toContain('paidchapter');
    expect(out).toContain('freechapter');
  });
  it('refuses a hidden copy of later chapters before the cut', () => {
    expect(() => cutHtmlSample(book('', `<div hidden>${PAID}</div>`), 'two')).toThrow('stored elsewhere');
  });
  it('refuses later text in an attribute or CSS', () => {
    expect(() => cutHtmlSample(book('', `<div data-x="${PAID_TEXT}">x</div>`), 'two')).toThrow();
    expect(() => cutHtmlSample(book(`<style>.a::after{content:"${PAID_TEXT}"}</style>`, ''), 'two')).toThrow('stored elsewhere');
  });
  it('refuses encoded payloads but allows embedded images and fonts', () => {
    expect(() => cutHtmlSample(book('', `<div data-book="${b64(2000)}">x</div>`), 'two')).toThrow();
    expect(() => cutHtmlSample(book(`<style>:root{--book:"${b64(2000)}"}</style>`, ''), 'two')).toThrow('encoded data');
    const ok = cutHtmlSample(book(`<style>@font-face{src:url(data:font/woff2;base64,${b64(3000)})}</style>`, `<img src="data:image/png;base64,${b64(3000)}"><div style="background:url(data:image/png;base64,${b64(3000)})">x</div>`), 'two');
    expect(ok).toContain('freechapter');
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
    const z = await JSZip.loadAsync(await (await cutEpubSample(data, 'c2.xhtml')).arrayBuffer());
    expect(Object.keys(z.files)).not.toContain('OEBPS/app.js');
    expect(Object.keys(z.files)).not.toContain('OEBPS/secret.txt');
    const opf = await z.file('OEBPS/content.opf')!.async('string');
    expect(opf).not.toContain('scripted');
    expect(opf).not.toContain('app.js');
  });
  it('refuses a hidden copy in a kept document', async () => {
    const data = await epub(() => {}, '<h1>One</h1>' + FREE + '<div hidden="hidden">' + PAID + '</div>');
    await expect(cutEpubSample(data, 'c2.xhtml')).rejects.toThrow('stored elsewhere');
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
    const out = cutHtmlSample(page, 'two', { storeUrl: STORE, nextChapterTitle: 'Two' });
    expect(out).toContain('window.HEAD = 1');
    expect(out).toContain("document.querySelectorAll('.quiz')");
    expect(out).toContain('onclick="toggle()"');
    expect(out).toContain('data-ok="1"');
    // A script inside a removed chapter goes with it.
    expect(out).not.toContain('paidOnlyScript');
    expect(out).not.toContain('closingpaid');
  });

  it('points links into left-out chapters at the store, labelled, and leaves the rest alone', () => {
    const doc = new DOMParser().parseFromString(cutHtmlSample(page, 'two', { storeUrl: STORE, nextChapterTitle: 'Two' }), 'text/html');
    const [one, two, elsewhere] = Array.from(doc.querySelectorAll('#toc a'));
    expect(one.getAttribute('href')).toBe('#one');
    expect(two.getAttribute('href')).toBe(STORE);
    expect(two.getAttribute('target')).toBe('_blank');
    expect(two.textContent).toContain('(in the full book)');
    expect(elsewhere.getAttribute('href')).toBe('https://elsewhere.example');
  });

  it('ends with a note naming the next chapter, before the kept page script', () => {
    const doc = new DOMParser().parseFromString(cutHtmlSample(page, 'two', { storeUrl: STORE, nextChapterTitle: 'Two <b>x</b>' }), 'text/html');
    const note = doc.querySelector('[data-sample-end]')!;
    expect(note.textContent).toContain('This is the end of the free sample.');
    expect(note.textContent).toContain('The full book continues with Two <b>x</b>.');
    expect(note.querySelector('b')).toBeNull(); // a title is text, never markup
    expect(note.querySelector('a')!.getAttribute('href')).toBe(STORE);
    expect(note.parentElement!.localName).toBe('main');
  });

  it('writes no link for a store URL that is not http(s)', () => {
    const out = cutHtmlSample(page, 'two', { storeUrl: 'javascript:alert(1)' });
    expect(out).not.toContain('javascript:alert');
    expect(out).not.toContain('data-sample-end');
  });
});

describe('EPUB samples link to the full book', () => {
  it('relabels links to removed documents and ends the last document with the note', async () => {
    const STORE = 'https://academy.example/books/field-guide';
    const z = await JSZip.loadAsync(await (await cutEpubSample(await makeEpub(), 'c2.xhtml#three', { storeUrl: STORE, nextChapterTitle: 'Three' })).arrayBuffer());
    const nav = await z.file('OEBPS/nav.xhtml')!.async('string');
    const navDoc = new DOMParser().parseFromString(nav, 'application/xhtml+xml');
    const hrefs = Array.from(navDoc.getElementsByTagName('a')).map(a => a.getAttribute('href'));
    expect(hrefs).toEqual(['c1.xhtml', 'c2.xhtml#two', STORE, STORE]);
    expect(nav).toContain('(in the full book)');
    const last = await z.file('OEBPS/c2.xhtml')!.async('string');
    expect(last).toContain('This is the end of the free sample.');
    expect(last).toContain('The full book continues with Three.');
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
    expect(() => cutHtmlSample(page('', `<script>var extra = ${JSON.stringify(partial)};</script>`), 'two')).toThrow('stored elsewhere');
    expect(() => cutHtmlSample(page(`<script type="application/json">${JSON.stringify({ q: partial })}</script>`, ''), 'two')).toThrow('stored elsewhere');
  });

  it('refuses two sentences of a paid chapter (14 words) in a data attribute, a style or a template', () => {
    const one = paidParagraphs(33, 35);
    expect(() => cutHtmlSample(page('', `<div data-explain="${one}">x</div>`), 'two')).toThrow('stored elsewhere');
    expect(() => cutHtmlSample(page(`<style>.x::after{content:"${one}"}</style>`, ''), 'two')).toThrow('stored elsewhere');
    expect(() => cutHtmlSample(page('', `<template><p>${one}</p></template>`), 'two')).toThrow('stored elsewhere');
  });

  it('allows what the reader can already see, such as a paid chapter title listed in the contents', () => {
    const out = cutHtmlSample(page('', `<script>var titles = ["The second chapter has a long title of many words"];</script><button data-label="free ${words[1]}1 ${words[5]}3 ${words[7]}11 ${words[11]}17 ${words[13]}19 freeend1">x</button>`), 'two');
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
    expect(() => cutHtmlSample(html, 'two')).not.toThrow();
  });

  it('does not let a hidden copy vouch for a script copy (hidden text is not visible text)', () => {
    const partial = paidParagraphs(20, 28);
    const script = `<script>var extra = ${JSON.stringify(partial)};</script>`;
    expect(() => cutHtmlSample(page('', `<div hidden>${partial}</div>${script}`), 'two')).toThrow('stored elsewhere');
  });

  it('refuses a partial copy hidden by attribute, inline style or the book stylesheet', () => {
    const partial = paidParagraphs(44, 46);
    expect(() => cutHtmlSample(page('', `<div hidden><p>${partial}</p></div>`), 'two')).toThrow('stored elsewhere');
    expect(() => cutHtmlSample(page('', `<div style="display: none">${partial}</div>`), 'two')).toThrow('stored elsewhere');
    expect(() => cutHtmlSample(page('<style>.later { display:none }</style>', `<div class="later">${partial}</div>`), 'two')).toThrow('stored elsewhere');
  });

  it('allows a contents menu hidden on every screen when it only lists paid chapter titles', () => {
    const html = page('<style>.toc { display: none }</style>',
      '<nav class="toc"><a href="#two">The second chapter has a long title of many words</a></nav><p class="qe" hidden>Correct, well done.</p>');
    expect(() => cutHtmlSample(html, 'two')).not.toThrow();
  });

  it('ignores print-only rules, which hide nothing on screen', () => {
    // A free cover the print stylesheet hides, quoting text a paid chapter repeats.
    const quoted = paidParagraphs(50, 52);
    const html = page('<style>@media print { .cover { display: none } } @media only print and (orientation: portrait) { .cover { display: none } }</style>',
      `<div class="cover"><p>${quoted}</p></div><button data-code="${quoted}">Copy</button>`);
    expect(() => cutHtmlSample(html, 'two')).not.toThrow();
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
      expect(() => cutHtmlSample(page(`<style>${css}</style>`, `<div class="later">${partial}</div>${script}`), 'two'), css).toThrow('stored elsewhere');
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
    await expect(cutEpubSample(data, 'c2.xhtml')).rejects.toThrow('stored elsewhere');
  });
});
