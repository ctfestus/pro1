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
  it('strips a JSON script holding the whole book, in head or before the cut', () => {
    const json = `<script type="application/json">${JSON.stringify(PAID_TEXT)}</script>`;
    const out = cutHtmlSample(book(json, json), 'two');
    expect(out).not.toContain('paidchapter');
    expect(out).toContain('freechapter');
  });
  it('strips templates, noscript, comments and handlers before the cut', () => {
    const out = cutHtmlSample(book(`<template>${PAID}</template>`, `<noscript>${PAID}</noscript><!-- ${PAID_TEXT} --><div onclick="x('${'paidchapter'}')">ok</div>`), 'two');
    expect(out).not.toContain('paidchapter');
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
