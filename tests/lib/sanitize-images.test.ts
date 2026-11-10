import { describe, expect, it } from 'vitest';
import { isAllowedRichTextImage, renderAnnouncementContent, sanitizeAnnouncementContent, sanitizeRichText } from '@/lib/sanitize';

// The platform's own account (CLOUDINARY_CLOUD_NAME is 'test-cloud' in the test environment).
const CLD = 'https://res.cloudinary.com/test-cloud/image/upload/f_auto,q_auto/v1/users/u/rich-text/a.jpg';

describe('images in rich text', () => {
  it('keeps images from the platform image hosting and Pexels, with the width from the resize handle', () => {
    const out = sanitizeRichText(`<p>Hi</p><img src="${CLD}" alt="Chart" style="width:55%;max-width:100%;height:auto;border:5px solid red">`);
    expect(out).toContain(`src="${CLD}"`);
    expect(out).toContain('alt="Chart"');
    expect(out).toContain('width="55%"');
    expect(out).not.toContain('style=');
    expect(sanitizeRichText('<img src="https://images.pexels.com/photos/1/x.jpeg?w=940">')).toContain('images.pexels.com');
  });

  it('a later resize replaces the saved width', () => {
    expect(sanitizeRichText(`<img src="${CLD}" width="55%" style="width:30%">`)).toContain('width="30%"');
    expect(sanitizeRichText(`<img src="${CLD}" width="55%">`)).toContain('width="55%"');
  });

  it('drops images from anywhere else, and unsafe sources', () => {
    for (const src of ['https://evil.test/pixel.gif', 'http://res.cloudinary.com/x.jpg', 'data:image/png;base64,AAAA', 'javascript:alert(1)', '/relative.png', 'https://res.cloudinary.com.evil.test/a.jpg']) {
      expect(sanitizeRichText(`<p>x</p><img src="${src}">`)).toBe('<p>x</p>');
    }
    expect(isAllowedRichTextImage(CLD)).toBe(true);
    expect(isAllowedRichTextImage('https://cloudinary.com.evil.test/a')).toBe(false);
  });

  it("accepts only the platform's own Cloudinary uploads: not another account, not 'fetch any URL'", () => {
    for (const src of [
      'https://res.cloudinary.com/attacker/image/upload/v1/a.jpg',
      'https://res.cloudinary.com/test-cloud/image/fetch/https://evil.test/p.gif',
      'https://res.cloudinary.com/test-cloud-x/image/upload/a.jpg',
      'https://user@res.cloudinary.com/test-cloud/image/upload/a.jpg',
      'https://res.cloudinary.com:8443/test-cloud/image/upload/a.jpg',
    ]) {
      expect(isAllowedRichTextImage(src)).toBe(false);
      expect(sanitizeRichText(`<p>x</p><img src="${src}">`)).toBe('<p>x</p>');
    }
  });

  it('leaves no stray text when an attribute holds ">"', () => {
    expect(sanitizeRichText('<p>x</p><img alt="a>b" src="https://evil.test/x.gif">')).toBe('<p>x</p>');
    expect(sanitizeRichText(`<p>x</p><img alt="a>b" src="${CLD}">`)).toContain(CLD);
  });

  it('still strips scripts and event handlers around images', () => {
    const out = sanitizeRichText(`<img src="${CLD}" onerror="alert(1)" onload="x()"><script>alert(1)</script>`);
    expect(out).not.toMatch(/onerror|onload|<script/i);
    expect(out).toContain(CLD);
  });

  it('never lets a style load something from elsewhere', () => {
    const out = sanitizeAnnouncementContent('<div style="background:url(https://evil.test/p)">a</div><p style="color:red">b</p>');
    expect(out).not.toContain('evil.test');
    expect(out).toContain('color:red');
  });

  it('keeps images, and only allowed ones, in announcements', () => {
    const html = sanitizeAnnouncementContent(`<p>x</p><img src="${CLD}" style="width:40%"><img src="https://evil.test/t.gif">`);
    expect(html).toContain(CLD);
    expect(html).toContain('width="40%"');
    expect(html).not.toContain('evil.test');
    expect(renderAnnouncementContent(html)).toContain(CLD);
  });
});

describe('image-only content counts as content', () => {
  it('is kept by the checks that used to look for words only', async () => {
    const { hasRichContent } = await import('@/lib/plain-text');
    const { descriptionHtml, descriptionForSave } = await import('@/lib/books/description');
    const { hasVisibleEmailMessage } = await import('@/lib/email-template-service');
    const onlyImage = `<p><img src="${CLD}"></p>`;
    expect(hasRichContent(onlyImage)).toBe(true);
    expect(hasRichContent('<p><br></p>')).toBe(false);
    expect(descriptionHtml(onlyImage)).toContain(CLD);
    expect(descriptionForSave(onlyImage)).toContain(CLD);
    expect(hasVisibleEmailMessage(onlyImage)).toBe(true);
  });
});

describe('learning-path descriptions are cleaned before they are stored or emailed', () => {
  it('on save, and at both emails that carry them', async () => {
    const { readFileSync } = await import('fs');
    const read = (f: string) => readFileSync(`${process.cwd()}/${f}`, 'utf8');
    const route = read('app/api/learning-paths/route.ts');
    expect(route).toContain('description: cleanAuthored(description),');
    expect(route).toContain('updateData.description     = cleanAuthored(description);');
    expect(route).toContain('updateData.overview        = cleanAuthored(overview);');
    expect(read('lib/send-path-notification.ts')).toContain('pathDescription: lp.description ? sanitizeRichText(lp.description) : undefined');
    expect(read('lib/learning-path-progress.ts')).toContain('pathDescription: nextPath.description ? sanitizeRichText(nextPath.description) : undefined');
  });
});

describe('learning-path text as stored', () => {
  it('keeps older plain text exactly, and cleans rich text', async () => {
    const { readFileSync } = await import('fs');
    const route = readFileSync(`${process.cwd()}/app/api/learning-paths/route.ts`, 'utf8');
    expect(route).toContain('return looksLikeHtml(value) ? sanitizeRichText(value) : value;');
  });
});

describe('styles cannot load an image in disguise', () => {
  it('drops CSS-escaped and comment-split url() and other image functions', () => {
    for (const style of [
      'background-image:u\\72l(https://tracker.example/p.gif)',
      'background-image:\\75rl(https://tracker.example/p.gif)',
      'background:url/**/(https://tracker.example/p.gif)',
      'background-image:image(https://tracker.example/p.gif)',
      'background-image:-webkit-image-set(&quot;https://tracker.example/p.gif&quot; 1x)',
      'background-image:u&#92;72l(https://tracker.example/p.gif)',
    ]) {
      const out = sanitizeAnnouncementContent(`<p style="${style}">Hi</p>`);
      expect(out).not.toContain('tracker.example');
      expect(out).toContain('Hi');
    }
    expect(sanitizeAnnouncementContent('<p style="color:red">Hi</p>')).toContain('style="color:red"');
  });
});

describe('older announcements with a raw YouTube iframe', () => {
  it('still show the video after the content is cleaned', () => {
    const legacy = '<p>Watch</p><iframe src="https://www.youtube.com/embed/dQw4w9WgXcQ?rel=0" width="560"></iframe>';
    const out = renderAnnouncementContent(sanitizeAnnouncementContent(legacy));
    expect(out).toContain('<p>Watch</p>');
    expect(out).toContain('https://www.youtube.com/embed/dQw4w9WgXcQ');
  });
  it('drops any other iframe', () => {
    for (const src of ['https://evil.example/embed/dQw4w9WgXcQ', 'https://www.youtube.com.evil.example/embed/dQw4w9WgXcQ']) {
      const out = renderAnnouncementContent(sanitizeAnnouncementContent(`<p>x</p><iframe src="${src}"></iframe>`));
      expect(out).not.toContain('iframe');
      expect(out).not.toContain('evil');
    }
  });
});

describe('assignment instructions that are only an image', () => {
  it('are shown, not hidden as empty', async () => {
    const { readFileSync } = await import('fs');
    const src = readFileSync(`${process.cwd()}/components/StandardAssignmentPlayer.tsx`, 'utf8');
    expect(src).toContain('if (html && hasRichContent(html)) {');
    expect(src).not.toMatch(/html\.replace\(\/<\[\^>\]\*>\/g, ''\)\.trim\(\)/);
  });
});

describe('student answers that are only an image', () => {
  it('count as answered and are shown to the grader', async () => {
    const { readFileSync } = await import('fs');
    const read = (f: string) => readFileSync(`${process.cwd()}/${f}`, 'utf8');
    expect(read('components/StandardAssignmentPlayer.tsx')).toContain("if (task.type === 'text') return hasRichContent(a.text);");
    expect(read('components/dashboard/ScenarioGradingPanel.tsx')).toContain('return a.text && hasRichContent(a.text)');
  });
});
