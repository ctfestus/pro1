import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { upcomingEventItems, eventDateParts, parseViewerDate } from '@/lib/promotions';

describe('upcomingEventItems', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 10, 12, 0, 0)); // 10 Oct 2026, local time
  });
  afterEach(() => vi.useRealTimers());

  it('keeps today and later, soonest first, and drops past or malformed rows', () => {
    const items = upcomingEventItems([
      { date: '2026-10-20', format: 'in_person', title: 'Later', note: 'Register by Oct 19', url: '/a' },
      { date: '2026-10-09', format: 'virtual', title: 'Yesterday' },
      { date: '2026-10-10', format: 'unknown', title: '  Today  ' },
      { date: '10/12/2026', title: 'Bad date' },
      { date: '2026-10-15', title: '   ' },
      { date: '2026-10-16', title: 42 },
      [{ date: '2026-10-17', title: 'Nested' }],
      null,
      'not an object',
    ]);
    expect(items).toEqual([
      { date: '2026-10-10', format: 'virtual', title: 'Today', note: '', url: '' },
      { date: '2026-10-20', format: 'in_person', title: 'Later', note: 'Register by Oct 19', url: '/a' },
    ]);
  });

  it('caps the rows and tolerates a non-array', () => {
    const many = Array.from({ length: 7 }, (_, i) => ({ date: `2026-11-0${i + 1}`, title: `E${i}` }));
    expect(upcomingEventItems(many)).toHaveLength(6);
    expect(upcomingEventItems(many, 2)).toHaveLength(2);
    expect(upcomingEventItems({ date: '2026-11-01' })).toEqual([]);
  });
});

it('judges past rows against the date it is given', () => {
  const rows = [{ date: '2026-10-10', title: 'Today there' }];
  expect(upcomingEventItems(rows, 6, '2026-10-11')).toEqual([]);
  expect(upcomingEventItems(rows, 6, '2026-10-10')).toHaveLength(1);
});

describe('parseViewerDate', () => {
  const now = new Date('2026-10-10T23:30:00Z');
  it('accepts a real date within two days of the server', () => {
    expect(parseViewerDate('2026-10-11', now)).toBe('2026-10-11');
    expect(parseViewerDate('2026-10-09', now)).toBe('2026-10-09');
  });
  it.each(['2026-10-01', '2026-02-30', '10/10/2026', '', null])('ignores %j', (raw) => {
    expect(parseViewerDate(raw as string | null, now)).toBeNull();
  });
});

describe('eventDateParts', () => {
  it('reads the month and day from the text, not a Date', () => {
    expect(eventDateParts('2026-10-06')).toEqual({ month: 'OCT', day: '06' });
    expect(eventDateParts('2026-01-31')).toEqual({ month: 'JAN', day: '31' });
  });
});
