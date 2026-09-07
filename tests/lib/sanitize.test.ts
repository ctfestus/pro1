import { describe, it, expect } from 'vitest';

import {
  sanitizePlainText,
  sanitizeRichText,
  sanitizeRichTextWithImages,
  sanitizeEmailContent,
  sanitizeAnnouncementContent,
  renderAnnouncementContent,
} from '@/lib/sanitize';

// Regression tests for the HTML sanitizers. These guard behavior across
// dompurify/jsdom upgrades (added when moving isomorphic-dompurify from the
// 2.26.0 pin back to ^3.18 for the Vercel ERR_REQUIRE_ESM issue): dangerous
// HTML stays out, allowed formatting survives, the link-hardening hook fires,
// images stay https-only, and the announcement YouTube placeholder round-trips
// through save-time sanitize + display-time render.

describe('sanitizePlainText', () => {
  it('strips tags and null bytes but does not trim spaces', () => {
    expect(sanitizePlainText('<b>Name</b>')).toBe('Name');
    expect(sanitizePlainText('a\0b')).toBe('ab');
    expect(sanitizePlainText('typing ')).toBe('typing ');
  });
});

describe('sanitizeRichText', () => {
  it('removes scripts and inline event handlers', () => {
    const out = sanitizeRichText('<p onclick="steal()">hi</p><script>alert(1)</script>');
    expect(out).toContain('hi');
    expect(out).not.toContain('onclick');
    expect(out).not.toContain('alert(1)');
    expect(out).not.toContain('<script');
  });

  it('neutralizes javascript: links and hardens every anchor', () => {
    const out = sanitizeRichText('<a href="javascript:alert(1)">x</a><a href="https://example.com">ok</a>');
    expect(out).not.toContain('javascript:');
    expect(out).toContain('href="https://example.com"');
    // afterSanitizeAttributes hook: all links open in a new tab without opener access
    expect(out).toContain('target="_blank"');
    expect(out).toContain('rel="noopener noreferrer"');
  });

  it('keeps tables with structural attributes', () => {
    const out = sanitizeRichText('<table><tbody><tr><td colspan="2">c</td></tr></tbody></table>');
    expect(out).toContain('colspan="2"');
    expect(out).toContain('<table>');
  });

  it('drops images and data attributes (not allowed in rich text)', () => {
    const out = sanitizeRichText('<p data-evil="1">a</p><img src="https://x.com/i.png">');
    expect(out).not.toContain('<img');
    expect(out).not.toContain('data-evil');
  });
});

describe('sanitizeEmailContent', () => {
  it('keeps https images', () => {
    const out = sanitizeEmailContent('<img src="https://res.cloudinary.com/demo/i.png" alt="a">');
    expect(out).toContain('src="https://res.cloudinary.com/demo/i.png"');
  });

  it('drops non-https image sources', () => {
    expect(sanitizeEmailContent('<img src="data:image/png;base64,AAAA">')).not.toContain('data:image');
    expect(sanitizeEmailContent('<img src="javascript:alert(1)">')).not.toContain('javascript:');
    expect(sanitizeEmailContent('<img src="http://evil.com/i.png">')).not.toContain('evil.com');
  });
});

describe('sanitizeRichTextWithImages', () => {
  it('preserves editor tables, code, and safe images together', () => {
    const out = sanitizeRichTextWithImages(
      '<table><tbody><tr><td>Revenue</td></tr></tbody></table><pre><code>SUM(A:A)</code></pre><img src="https://res.cloudinary.com/demo/chart.png" alt="Chart">',
    );
    expect(out).toContain('<table>');
    expect(out).toContain('<pre><code>SUM(A:A)</code></pre>');
    expect(out).toContain('https://res.cloudinary.com/demo/chart.png');
  });

  it('still removes unsafe image sources', () => {
    expect(sanitizeRichTextWithImages('<img src="javascript:alert(1)">')).not.toContain('<img');
  });

  it('removes arbitrary inline styles from rich deliverable content', () => {
    const out = sanitizeRichTextWithImages(
      '<p style="position:fixed;inset:0;z-index:999999;background-image:url(https://attacker.example/track)">Overlay</p><img src="https://res.cloudinary.com/demo/chart.png" style="position:fixed;width:100vw;height:100vh">',
    );
    expect(out).not.toContain('style=');
    expect(out).not.toContain('attacker.example');
    expect(out).toContain('https://res.cloudinary.com/demo/chart.png');
  });
});

describe('announcement YouTube placeholder', () => {
  const placeholder = '<div class="yt-embed" title="dQw4w9WgXcQ"><p>Video preview</p></div>';

  it('save-time sanitize keeps the placeholder but strips scripts', () => {
    const saved = sanitizeAnnouncementContent(placeholder + '<script>x()</script>');
    expect(saved).toContain('yt-embed');
    expect(saved).toContain('dQw4w9WgXcQ');
    expect(saved).not.toContain('<script');
  });

  it('render converts the placeholder to a YouTube iframe, consuming nested content', () => {
    const out = renderAnnouncementContent(
      '<div class="yt-embed" title="abcdefghijk"><div><p>inner</p></div></div><p>after</p>'
    );
    expect(out).toContain('youtube.com/embed/abcdefghijk');
    expect(out).toContain('after');
    expect(out).not.toContain('inner');
    expect(out).not.toContain('yt-embed');
  });

  it('survives the full save-then-render pipeline', () => {
    const rendered = renderAnnouncementContent(sanitizeAnnouncementContent(placeholder));
    expect(rendered).toContain('<iframe');
    expect(rendered).toContain('youtube.com/embed/dQw4w9WgXcQ');
  });

  it('converts legacy raw YouTube iframes and drops non-YouTube ones', () => {
    const legacy = renderAnnouncementContent(
      '<p>x</p><iframe src="https://www.youtube.com/embed/abcdefghijk?rel=0"></iframe>'
    );
    expect(legacy).toContain('youtube.com/embed/abcdefghijk');
    expect(legacy).toContain('<p>x</p>');

    const evil = renderAnnouncementContent('<iframe src="https://evil.com/embed/x"></iframe>');
    expect(evil).not.toContain('<iframe');
    expect(evil).not.toContain('evil.com');
  });
});
