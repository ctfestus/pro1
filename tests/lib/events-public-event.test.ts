// What the public events pages may show (migration 244), and how registrant answers are checked.
import { describe, expect, it } from 'vitest';
import { dateParts, displayTime, eventIsOpenForRegistration, publicEventFields, joinVenue, recurrenceLabel, splitVenue, toPublicEvent } from '@/lib/events/public-event';
import { validateRegistrationResponses } from '@/lib/events/registration';

const NOW = new Date('2026-11-13T12:00:00Z');
const ROW = {
  id: 'ev1', slug: 'data-meetup', title: 'Data Meetup', status: 'published', public_registration: true, is_private: false,
  description: '<p>Hands-on <b>SQL</b> night.</p>', cover_image: 'https://img.test/c.png',
  event_date: '2026-11-20', event_time: '18:30:00', timezone: 'GMT+0 (Accra)', event_type: 'virtual',
  location: '12 Secret St', meeting_link: 'https://zoom.test/secret', cohort_ids: ['co1'], user_id: 'u1',
  capacity: 50, recurrence: 'once', recurrence_end_date: null, recurrence_days: null,
  speakers: [{ name: 'Ama', title: 'Analyst', avatar_url: 'javascript:alert(1)', linkedin_url: 'https://linkedin.com/in/ama' }],
  fields: [
    { name: 'first_name', label: 'First Name', type: 'text' },
    { name: 'email', label: 'Email', type: 'email' },
    { name: 'phone', label: 'Phone', type: 'phone', required: true },
    { name: 'role', label: 'Role', type: 'select', options: ['Student', 'Analyst'], required: false },
    { name: 'links', label: 'Socials', type: 'social' },
  ],
};

describe('toPublicEvent', () => {
  it('never carries the meeting link, cohorts or owner, and hides an online event address', () => {
    const ev = toPublicEvent(ROW, 12, NOW)!;
    const json = JSON.stringify(ev);
    expect(json).not.toContain('zoom.test');
    expect(json).not.toContain('co1');
    expect(json).not.toContain('u1');
    expect(ev.location).toBeNull();
    expect(ev).toMatchObject({ nextDate: '2026-11-20', isPast: false, spotsLeft: 38, time: '18:30', summary: 'Hands-on SQL night.' });
    expect(ev.speakers[0]).toMatchObject({ avatar: null, linkedin: 'https://linkedin.com/in/ama' });
  });

  it.each([
    ['a draft', { status: 'draft' }],
    ['not open to the public', { public_registration: false }],
  ])('is null for %s', (_label, extra) => {
    expect(toPublicEvent({ ...ROW, ...extra }, 0, NOW)).toBeNull();
  });

  it('marks a finished event past and an unlisted one unlisted', () => {
    const ev = toPublicEvent({ ...ROW, event_date: '2026-10-01', is_private: true }, 0, NOW)!;
    expect(ev).toMatchObject({ isPast: true, nextDate: null, lastDate: '2026-10-01', listed: false });
    expect(eventIsOpenForRegistration({ ...ROW, event_date: '2026-10-01' }, NOW)).toBe(false);
    expect(eventIsOpenForRegistration({ ...ROW, event_date: null }, NOW)).toBe(true);
  });

  it('keeps a weekly series open until its end date', () => {
    const row = { ...ROW, event_date: '2026-09-01', recurrence: 'weekly', recurrence_days: [2], recurrence_end_date: '2026-12-31' };
    const ev = toPublicEvent(row, 0, NOW)!;
    expect(ev.isPast).toBe(false);
    expect(ev.nextDate! >= '2026-11-13').toBe(true);
    expect(recurrenceLabel(ev)).toBe('Weekly on Tue until Dec 31');
  });
});

describe('publicEventFields', () => {
  it('drops the built-in name and email questions and unsupported types', () => {
    expect(publicEventFields(ROW.fields).map(f => f.name)).toEqual(['phone', 'role']);
  });
});

describe('validateRegistrationResponses', () => {
  const fields = publicEventFields(ROW.fields);
  it('keeps only known answers, trimmed', () => {
    expect(validateRegistrationResponses(fields, { phone: ' +233 20 000 0000 ', role: 'Analyst', extra: 'x' }))
      .toEqual({ ok: true, responses: { phone: '+233 20 000 0000', role: 'Analyst' } });
  });
  it('requires required answers and real options', () => {
    expect(validateRegistrationResponses(fields, {}).ok).toBe(false);
    expect(validateRegistrationResponses(fields, { phone: '0200000000', role: 'Hacker' }).ok).toBe(false);
  });
});

describe('formatting', () => {
  it('reads dates without shifting the day and times in 12-hour form', () => {
    expect(dateParts('2026-11-20')).toEqual({ month: 'NOV', day: '20', long: 'Fri, Nov 20, 2026' });
    expect(displayTime('18:30:00')).toBe('6:30 PM');
    expect(displayTime('00:05')).toBe('12:05 AM');
  });
});

describe('splitVenue', () => {
  it('takes the venue name before the first comma and the address after it', () => {
    expect(splitVenue('Accra Digital Centre, Ring Road, Accra')).toEqual({ name: 'Accra Digital Centre', address: 'Ring Road, Accra' });
    expect(splitVenue('Impact Hub')).toEqual({ name: 'Impact Hub', address: null });
    expect(splitVenue(', Osu, Accra')).toEqual({ name: 'Osu, Accra', address: null });
    expect(splitVenue(null)).toBeNull();
  });
  it('gives an in-person event a venue and an online one none', () => {
    expect(toPublicEvent({ ...ROW, event_type: 'in-person', location: 'Impact Hub, Osu' }, 0, NOW)!.venue).toEqual({ name: 'Impact Hub', address: 'Osu' });
    expect(toPublicEvent(ROW, 0, NOW)!.venue).toBeNull();
  });
});

describe('joinVenue', () => {
  it('stores the venue name and subtitle as one location that splits back the same', () => {
    expect(joinVenue('Accra Digital Centre', 'Ring Road, Osu')).toBe('Accra Digital Centre, Ring Road, Osu');
    expect(splitVenue(joinVenue('Accra Digital Centre', 'Ring Road, Osu'))).toEqual({ name: 'Accra Digital Centre', address: 'Ring Road, Osu' });
    expect(joinVenue('Impact Hub', '  ')).toBe('Impact Hub');
    expect(joinVenue('Hall, A', 'Osu')).toBe('Hall A, Osu');
  });
});
