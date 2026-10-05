// Share links must say which kind of content a slug means, or an experience sharing a slug with
// a course opens (and previews) as the course.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { contentPath } from '@/lib/content-link';
import { PUBLIC_CATALOGUE_TABLE } from '@/lib/public-catalogue-item';

describe('contentPath', () => {
  it('types dashboard rows by content_type', () => {
    expect(contentPath({ slug: 'shared', content_type: 'course' })).toBe('/shared?catalogueType=course');
    expect(contentPath({ slug: 'shared', content_type: 'virtual_experience' })).toBe('/shared?catalogueType=virtual_experience');
    expect(contentPath({ slug: 'shared', content_type: 'guided_project' })).toBe('/shared?catalogueType=virtual_experience');
    expect(contentPath({ slug: 'cert', content_type: 'certification' })).toBe('/cert?catalogueType=certification');
  });

  it('types the create editor config by its flags', () => {
    expect(contentPath({ slug: 's', config: { isCourse: true } })).toBe('/s?catalogueType=course');
    expect(contentPath({ slug: 's', config: { isVirtualExperience: true } })).toBe('/s?catalogueType=virtual_experience');
  });

  it('leaves events and plain forms untyped, which is the only way app/[id] opens an event', () => {
    expect(contentPath({ slug: 'meetup', content_type: 'event' })).toBe('/meetup');
    expect(contentPath({ slug: 'survey' })).toBe('/survey');
  });

  it('falls back to the id when there is no slug', () => {
    expect(contentPath({ id: 'abc', content_type: 'learning_path' })).toBe('/abc?catalogueType=learning_path');
  });

  it('only emits types the detail page and preview accept', () => {
    const page = readFileSync(join(process.cwd(), 'app/[id]/PublicFormPage.tsx'), 'utf8');
    for (const type of ['course', 'virtual_experience', 'certification']) {
      expect(page).toContain(`requestedType === '${type}'`);
    }
    for (const type of ['course', 'virtual_experience', 'certification', 'learning_path']) {
      expect(Object.keys(PUBLIC_CATALOGUE_TABLE)).toContain(type);
    }
  });
});
