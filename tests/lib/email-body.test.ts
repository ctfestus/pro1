// The broadcast email body: editor HTML to email HTML (lib/email-body.ts).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderEmailBody } from '@/lib/email-body';

const values = { name: 'Ama <b>Mensah</b>', meeting_link: 'https://app.test/api/join?token=t1&x=1' };

beforeEach(() => { vi.stubEnv('CLOUDINARY_CLOUD_NAME', 'demo'); });
afterEach(() => { vi.unstubAllEnvs(); });

describe('renderEmailBody', () => {
  it('escapes a plain-text body and splits its paragraphs', () => {
    expect(renderEmailBody('Hello {{name}}\n\nSee you\nsoon', values, '#00bf63'))
      .toBe('<p>Hello Ama &lt;b&gt;Mensah&lt;/b&gt;</p><p>See you<br>soon</p>');
  });

  it('sanitizes any body with a tag in it, whatever the tag', () => {
    const html = renderEmailBody('<image src="https://tracker.test/p.gif"><form action="https://x.test">Hi</form>', values, '#00bf63');
    expect(html).not.toMatch(/tracker\.test|<form/);
  });

  it('treats an inherited property name as an unknown tag', () => {
    expect(renderEmailBody('<p>a{{constructor}}b{{__proto__}}c</p>', values, '#00bf63')).toBe('<p>abc</p>');
  });

  it('leaves no dead or unsafe link when a merge-tag link fills to nothing or to script', () => {
    const body = '<p><a class="email-button" href="{{meeting_link}}">Join</a></p><p><a href="{{meeting_link}}">or here</a></p>';
    for (const meeting_link of ['', 'javascript:alert(1)']) {
      const html = renderEmailBody(body, { ...values, meeting_link }, '#00bf63');
      expect(html).not.toMatch(/<table|href=|javascript/);
      expect(html).toContain('Join');
      expect(html).toContain('or here');
    }
  });

  it('fills merge tags escaped, so a name cannot add markup', () => {
    const html = renderEmailBody('<p>Hi {{name}}</p>', values, '#00bf63');
    expect(html).toContain('Hi Ama &lt;b&gt;Mensah&lt;/b&gt;');
  });

  it('turns an editor button into a table button in the given colour', () => {
    const html = renderEmailBody('<p>Text</p><p><a class="email-button" href="https://x.test/rec">Watch the recording</a></p>', values, '#00bf63');
    expect(html).toContain('background-color:#00bf63');
    expect(html).toMatch(/<table role="presentation"[^>]*>[\s\S]*href="https:\/\/x\.test\/rec"[\s\S]*Watch the recording/);
    expect(html).not.toContain('<p><table');
  });

  it('lets a button point at a merge tag, filled per recipient', () => {
    const html = renderEmailBody('<p><a class="email-button" href="{{meeting_link}}">Join</a></p>', values, '#00bf63');
    expect(html).toContain('href="https://app.test/api/join?token=t1&amp;x=1"');
  });

  it('drops a button with an unsafe link but keeps its text', () => {
    const html = renderEmailBody('<p><a class="email-button" href="javascript:alert(1)">Click</a></p>', values, '#00bf63');
    expect(html).not.toContain('javascript');
    expect(html).not.toContain('<table');
    expect(html).toContain('Click');
  });

  it('turns a YouTube embed into a linked thumbnail', () => {
    const html = renderEmailBody('<div class="yt-embed" title="dQw4w9WgXcQ"><img src="https://img.youtube.com/vi/dQw4w9WgXcQ/hqdefault.jpg"></div>', values, '#00bf63');
    expect(html).toContain('href="https://www.youtube.com/watch?v=dQw4w9WgXcQ"');
    expect(html).toContain('src="https://img.youtube.com/vi/dQw4w9WgXcQ/hqdefault.jpg"');
    expect(html).toContain('Watch the video on YouTube');
  });

  it('keeps hosted images, sized for phones, and drops outside ones', () => {
    const html = renderEmailBody('<p>A</p><img src="https://res.cloudinary.com/demo/image/upload/a.jpg" style="width:55%"><img src="https://tracker.test/p.gif">', values, '#00bf63');
    expect(html).toContain('res.cloudinary.com/demo/image/upload/a.jpg');
    expect(html).toContain('width="55%"');
    expect(html).toContain('max-width:100%');
    expect(html).not.toContain('tracker.test');
  });

  it('strips scripts and event handlers', () => {
    const html = renderEmailBody('<p onclick="x()">Hi</p><script>alert(1)</script>', values, '#00bf63');
    expect(html).not.toMatch(/script|onclick/);
  });
});
