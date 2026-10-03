import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { upcomingEventItems, eventDateParts } from '@/lib/promotions';

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
      null,
      'not an object',
    ]);
    expect(items).toEqual([
      { date: '2026-10-10', format: 'virtual', title: 'Today', note: '', url: '' },
      { date: '2026-10-20', format: 'in_person', title: 'Later', note: 'Register by Oct 19', url: '/a' },
    ]);
  });

  it('caps the rows and tolerates a non-array', () => {
    const many = Array.from({ length: 6 }, (_, i) => ({ date: `2026-11-0${i + 1}`, title: `E${i}` }));
    expect(upcomingEventItems(many)).toHaveLength(4);
    expect(upcomingEventItems(many, 6)).toHaveLength(6);
    expect(upcomingEventItems({ date: '2026-11-01' })).toEqual([]);
  });
});

describe('eventDateParts', () => {
  it('reads the month and day from the text, not a Date', () => {
    expect(eventDateParts('2026-10-06')).toEqual({ month: 'OCT', day: '06' });
    expect(eventDateParts('2026-01-31')).toEqual({ month: 'JAN', day: '31' });
  });
});
