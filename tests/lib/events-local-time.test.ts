// The visitor's own time on the public event page (lib/events/local-time.ts).
import { describe, expect, it } from 'vitest';
import { gmtLabel, viewerLocalTime } from '@/lib/events/local-time';
import { sessionStartInstant } from '@/lib/event-sessions';

const at = (minutes: number) => () => minutes;

describe('viewerLocalTime', () => {
  it('converts a Lagos evening for a Nairobi visitor', () => {
    expect(viewerLocalTime('2026-11-20', '18:00', 'GMT+1 (Lagos)', at(180)))
      .toEqual({ time: '8:00 PM', date: null, zone: 'GMT+3' });
  });

  it('shows the date when it differs for the visitor', () => {
    expect(viewerLocalTime('2026-11-20', '23:00', 'GMT+1 (Lagos)', at(180)))
      .toEqual({ time: '1:00 AM', date: 'Sat, Nov 21', zone: 'GMT+3' });
    expect(viewerLocalTime('2026-11-20', '01:00', 'GMT+1 (Lagos)', at(-300)))
      .toEqual({ time: '7:00 PM', date: 'Thu, Nov 19', zone: 'GMT-5' });
  });

  it('handles half-hour offsets and noon/midnight', () => {
    expect(viewerLocalTime('2026-11-20', '06:30', 'GMT+0 (Accra)', at(330)))
      .toEqual({ time: '12:00 PM', date: null, zone: 'GMT+5:30' });
    expect(viewerLocalTime('2026-11-20', '23:00', 'GMT+0 (Accra)', at(60)))
      .toEqual({ time: '12:00 AM', date: 'Sat, Nov 21', zone: 'GMT+1' });
  });

  it('adds nothing for a visitor already on the event offset', () => {
    expect(viewerLocalTime('2026-11-20', '18:00', 'GMT+1 (Lagos)', at(60))).toBeNull();
  });

  it('never guesses: an unreadable timezone, or no date or time, gives nothing', () => {
    expect(viewerLocalTime('2026-11-20', '18:00', 'WAT', at(180))).toBeNull();
    expect(viewerLocalTime('2026-11-20', '18:00', null, at(180))).toBeNull();
    expect(viewerLocalTime(null, '18:00', 'GMT+1', at(180))).toBeNull();
    expect(viewerLocalTime('2026-11-20', null, 'GMT+1', at(180))).toBeNull();
  });

  it('asks for the visitor offset at the session start, the same instant the countdown uses', () => {
    let asked: Date | null = null;
    viewerLocalTime('2026-11-20', '18:00', 'GMT+1 (Lagos)', d => { asked = d; return 0; });
    expect(asked).toEqual(sessionStartInstant('2026-11-20', '18:00', 'GMT+1 (Lagos)'));
  });
});

describe('gmtLabel', () => {
  it('formats offsets', () => {
    expect([gmtLabel(0), gmtLabel(180), gmtLabel(-240), gmtLabel(330), gmtLabel(-570)])
      .toEqual(['GMT+0', 'GMT+3', 'GMT-4', 'GMT+5:30', 'GMT-9:30']);
  });
});
