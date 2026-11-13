// The "after registration" setting on the public event page (/events/[slug]).
import { describe, expect, it } from 'vitest';
import { afterRegistrationOf, suggestedIds, webUrl, type AfterRegistrationItem } from '@/lib/events/public-event';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const item = (id: string, kind: 'event' | 'course' = 'event'): AfterRegistrationItem =>
  ({ id, title: id, href: `/${id}`, coverImage: null, date: null, kind });

describe('webUrl', () => {
  it('keeps http and https links only', () => {
    expect(webUrl('https://example.com/x')).toBe('https://example.com/x');
    expect(webUrl('http://example.com')).toBe('http://example.com/');
    expect(webUrl('javascript:alert(1)')).toBeNull();
    expect(webUrl('data:text/html,hi')).toBeNull();
    expect(webUrl('not a url')).toBeNull();
    expect(webUrl(undefined)).toBeNull();
  });
});

describe('afterRegistrationOf', () => {
  it('falls back to the plain card when unset or unknown', () => {
    expect(afterRegistrationOf(null)).toEqual({ type: 'default' });
    expect(afterRegistrationOf({ type: 'default' })).toEqual({ type: 'default' });
    expect(afterRegistrationOf({ type: 'other' })).toEqual({ type: 'default' });
  });

  it('redirects only to a web link', () => {
    expect(afterRegistrationOf({ type: 'redirect', redirectUrl: 'https://example.com' }))
      .toEqual({ type: 'redirect', url: 'https://example.com/' });
    expect(afterRegistrationOf({ type: 'redirect', redirectUrl: 'javascript:alert(1)' })).toEqual({ type: 'default' });
  });

  it('shows a button with a default label', () => {
    expect(afterRegistrationOf({ type: 'button', buttonUrl: 'https://x.com' }))
      .toEqual({ type: 'button', label: 'Continue', url: 'https://x.com/' });
    expect(afterRegistrationOf({ type: 'button', buttonLabel: 'Join the group', buttonUrl: 'https://x.com' }))
      .toMatchObject({ label: 'Join the group' });
    expect(afterRegistrationOf({ type: 'button', buttonLabel: 'Go' })).toEqual({ type: 'default' });
  });

  it('shows a notice that has a title or body', () => {
    expect(afterRegistrationOf({ type: 'notice', noticeTitle: ' Next steps ', noticeBody: '' }))
      .toEqual({ type: 'notice', title: 'Next steps', body: null });
    expect(afterRegistrationOf({ type: 'notice', noticeTitle: ' ', noticeBody: '' })).toEqual({ type: 'default' });
  });

  it('lists only the suggestions loaded, in the order picked', () => {
    const ps = { type: 'events', relatedEventIds: [B, A, 'not-a-uuid'] };
    expect(suggestedIds(ps)).toEqual([B, A]);
    expect(afterRegistrationOf(ps, [item(A), item(B, 'course')]))
      .toEqual({ type: 'events', items: [item(B, 'course'), item(A)] });
    expect(afterRegistrationOf(ps, [])).toEqual({ type: 'default' });
  });
});
