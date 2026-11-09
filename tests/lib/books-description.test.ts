import { describe, expect, it } from 'vitest';
import { descriptionForSave, descriptionHtml, descriptionText } from '@/lib/books/description';
import { bookColumnsFromInput } from '@/lib/books/admin';

describe('product descriptions', () => {
  it('keeps the editor formatting: bold, italics, lists, headings, links', () => {
    const html = '<h2>What you get</h2><p><b>Bold</b> and <i>italic</i></p><ul><li>One</li><li>Two</li></ul><p><a href="https://example.test">Link</a></p>';
    const out = descriptionHtml(html);
    for (const tag of ['<h2>', '<b>', '<i>', '<ul>', '<li>', 'href="https://example.test"']) expect(out).toContain(tag);
  });

  it.each([
    ['a script', '<p>Hi</p><script>alert(1)</script>'],
    ['an event handler', '<p onclick="alert(1)">Hi</p><img src=x onerror="alert(1)">'],
    ['a javascript link', '<p><a href="javascript:alert(1)">Hi</a></p>'],
    ['an iframe', '<p>Hi</p><iframe src="https://evil.test"></iframe>'],
    ['inline styles', '<p style="position:fixed;inset:0">Hi</p>'],
  ])('strips %s, on save and on render', (_label, html) => {
    for (const out of [descriptionHtml(html), descriptionForSave(html)!]) {
      expect(out).toContain('Hi');
      expect(out).not.toMatch(/<script|onclick|onerror|javascript:|<iframe|style=|<img/i);
    }
  });

  it('escapes older plain-text descriptions and keeps their line breaks', () => {
    expect(descriptionHtml('Line one\nLine two\n\n1 < 2 & more')).toBe('<p>Line one<br/>Line two</p><p>1 &lt; 2 &amp; more</p>');
  });

  it('treats an empty editor as no description', () => {
    expect(descriptionForSave('<p><br></p>')).toBeNull();
    expect(descriptionHtml('<p>&nbsp;</p>')).toBe('');
    expect(bookColumnsFromInput({ description: '<p></p>' }).description).toBeNull();
  });

  it('gives plain text for previews and social cards', () => {
    expect(descriptionText('<p>Learn <b>SQL</b> &amp; Excel</p><ul><li>Joins</li><li>Pivots</li></ul>')).toBe('Learn SQL & Excel Joins Pivots');
  });

  it('sanitizes what is saved', () => {
    expect(bookColumnsFromInput({ description: '<p>Hi<script>x</script></p>' }).description).toBe('<p>Hi</p>');
  });
});
