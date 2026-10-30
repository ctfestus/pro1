import { describe, expect, it } from 'vitest';
import {
  getLastScheduledSessionDate,
  getNextScheduledSessionDate,
  isScheduledSessionDate,
  sessionStartInstant,
  getNextSessionStart,
} from '@/lib/event-sessions';

describe('event session recurrence helpers', () => {
  it('returns the next weekly session instead of the historical start date', () => {
    const event = {
      event_date: '2026-01-03',
      recurrence: 'weekly',
      recurrence_days: [6],
    };

    expect(getNextScheduledSessionDate(event, '2026-06-20')).toBe('2026-06-20');
    expect(getNextScheduledSessionDate(event, '2026-06-21')).toBe('2026-06-27');
  });

  it('returns the most recent real occurrence for an ended recurring series', () => {
    const event = {
      event_date: '2026-01-03',
      recurrence: 'weekly',
      recurrence_days: [6],
      recurrence_end_date: '2026-06-13',
    };

    expect(getNextScheduledSessionDate(event, '2026-06-20')).toBeNull();
    expect(getLastScheduledSessionDate(event, '2026-06-20')).toBe('2026-06-13');
  });

  it('falls back to the start weekday when weekly days are empty', () => {
    const event = {
      event_date: '2026-01-07',
      recurrence: 'weekly',
      recurrence_days: [],
    };

    expect(isScheduledSessionDate(event, '2026-01-14')).toBe(true);
    expect(isScheduledSessionDate(event, '2026-01-15')).toBe(false);
    expect(getNextScheduledSessionDate(event, '2026-01-08')).toBe('2026-01-14');
  });

  it('separates future and past one-time events', () => {
    const event = {
      event_date: '2026-06-22',
      recurrence: 'once',
    };

    expect(getNextScheduledSessionDate(event, '2026-06-20')).toBe('2026-06-22');
    expect(getNextScheduledSessionDate(event, '2026-06-23')).toBeNull();
    expect(getLastScheduledSessionDate(event, '2026-06-23')).toBe('2026-06-22');
  });
});

describe('session start instants', () => {
  it('reads the session time in the event offset', () => {
    expect(sessionStartInstant('2026-06-02', '10:00:00', 'GMT+1 (Lagos)')?.toISOString()).toBe('2026-06-02T09:00:00.000Z');
    expect(sessionStartInstant('2026-06-02', '10:00', 'GMT+5:30 (IST)')?.toISOString()).toBe('2026-06-02T04:30:00.000Z');
    expect(sessionStartInstant('2026-06-02', '10:00', null)?.toISOString()).toBe('2026-06-02T10:00:00.000Z');
  });

  it('moves past a session that has already started today', () => {
    const event = { event_date: '2026-06-01', event_time: '10:00', timezone: 'GMT+0', recurrence: 'daily' };
    const next = getNextSessionStart(event, new Date('2026-06-01T10:30:00Z'));
    expect(next?.date).toBe('2026-06-02');
    expect(next?.start.toISOString()).toBe('2026-06-02T10:00:00.000Z');
  });

  it('keeps a weekly event with no days picked on its start weekday', () => {
    // 2026-06-01 is a Monday. With no recurrence_days the series runs on Mondays only.
    const event = { event_date: '2026-06-01', event_time: '10:00', timezone: 'GMT+0', recurrence: 'weekly', recurrence_days: [] };
    expect(getNextSessionStart(event, new Date('2026-06-02T09:00:00Z'))?.date).toBe('2026-06-08');
  });

  it('finds tomorrow morning for a session east of UTC late in the UTC evening', () => {
    // 23:30 UTC on the 1st is already the 2nd in GMT+3; a 08:00 session there is on the 2nd.
    const event = { event_date: '2026-06-02', event_time: '08:00', timezone: 'GMT+3 (Nairobi)', recurrence: 'once' };
    const next = getNextSessionStart(event, new Date('2026-06-01T23:30:00Z'));
    expect(next?.start.toISOString()).toBe('2026-06-02T05:00:00.000Z');
  });

  it('marks an untimed event so the hour-before reminder can skip it', () => {
    const event = { event_date: '2026-06-02', event_time: null, timezone: 'GMT+0', recurrence: 'once' };
    expect(getNextSessionStart(event, new Date('2026-06-01T12:00:00Z'))?.timed).toBe(false);
  });
});

describe('timezone offsets', () => {
  it('reads UTC-prefixed offsets the same as GMT ones', () => {
    expect(sessionStartInstant('2026-06-02', '10:00', 'UTC+1')?.toISOString()).toBe('2026-06-02T09:00:00.000Z');
  });
});
