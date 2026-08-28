// Where a landing card sends a visitor. Every card layout on the page reads this, so a mistake
// here is a mistake on the whole homepage at once.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { landingHref } from '@/lib/landing-href';

describe('landingHref', () => {
  it('carries the content type, because slugs are not unique across tables', () => {
    // Slugs are unique within a table, not across them, and the detail page tries tables in
    // order. Without the type a course and an experience sharing a slug resolve to whichever is
    // looked up first, and the visitor lands on the wrong content.
    expect(landingHref({ type: 'course', slug: 'data-basics' }, null))
      .toBe('/data-basics?catalogueType=course');
    expect(landingHref({ type: 've', slug: 'data-basics' }, null))
      .toBe('/data-basics?catalogueType=virtual_experience');
  });

  it('sends a signed-out visitor to the content, not to the login form', () => {
    expect(landingHref({ type: 'course', slug: 'x' }, null).startsWith('/x')).toBe(true);
  });

  it('routes learning paths to sign-in, because they have no page yet', () => {
    // No slug and no route exists for a path. Linking somewhere would only produce a dead end.
    expect(landingHref({ type: 'path', slug: '' }, null)).toBe('/auth');
    expect(landingHref({ type: 'path', slug: '' }, { id: 'u1' })).toBe('/student');
  });

  it('falls back rather than building a broken link when a slug is missing', () => {
    expect(landingHref({ type: 'course', slug: '' }, null)).toBe('/auth');
    expect(landingHref({ type: 'course', slug: null }, { id: 'u1' })).toBe('/student');
    expect(landingHref({ type: 'course' }, null)).toBe('/auth');
    expect(landingHref({}, null)).toBe('/auth');
  });

  it('is the only source of card destinations on the landing page', () => {
    // Card layouts disagreeing with each other is what left the mobile and slider cards behind
    // when only the hover popup was updated.
    const page = readFileSync(join(process.cwd(), 'components/LandingPageClient.tsx'), 'utf8');
    expect(page).toContain("import { landingHref } from '@/lib/landing-href'");
    expect(page).not.toContain('function landingHref');
  });

  it('keeps the type value the detail page actually accepts', () => {
    // app/[id] reads catalogueType and forwards it as the preview lookup's type.
    const detail = readFileSync(join(process.cwd(), 'app/[id]/page.tsx'), 'utf8');
    expect(detail).toContain("get('catalogueType')");
    for (const value of ['course', 'virtual_experience']) {
      expect(landingHref({ type: value === 'course' ? 'course' : 've', slug: 's' }, null))
        .toContain(`catalogueType=${value}`);
    }
  });
});
