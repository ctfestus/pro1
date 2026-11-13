// An event open to public registration has one page, /events/<slug>; every other event keeps /<slug>.
import { describe, expect, it } from 'vitest';
import { contentPath } from '@/lib/content-link';

describe('contentPath for events', () => {
  it('sends a public event to /events/<slug>, from a row or from an editor config', () => {
    expect(contentPath({ slug: '93mbi', content_type: 'event', public_registration: true })).toBe('/events/93mbi');
    expect(contentPath({ slug: '93mbi', config: { eventDetails: { isEvent: true, publicRegistration: true } } })).toBe('/events/93mbi');
  });

  it('keeps a cohort-only event, and a course, on the shared route', () => {
    expect(contentPath({ slug: 'cohort-call', content_type: 'event', public_registration: false })).toBe('/cohort-call');
    expect(contentPath({ slug: 'sql', content_type: 'course', public_registration: true })).toBe('/sql?catalogueType=course');
  });
});
