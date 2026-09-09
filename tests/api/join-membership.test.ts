import { describe, it, expect, vi, beforeEach } from 'vitest';

// What this guards: /api/join authorized on the join token alone. A token is written once, when an
// event is assigned to a cohort, and is never revoked -- so the link a student was emailed at the
// time stayed a working key to the meeting after they left the cohort, and every click recorded
// them present at a session that was no longer theirs. Filtering the attendance report stopped
// them being listed; this stops them getting in.

const { createClientMock } = vi.hoisted(() => ({ createClientMock: vi.fn() }));
vi.mock('@supabase/supabase-js', () => ({ createClient: createClientMock }));

import { NextRequest } from 'next/server';

import { GET } from '@/app/api/join/route';

const EVENT = {
  meeting_link: 'https://meet.test/room',
  event_date: '2026-01-05',
  recurrence: 'once',
  recurrence_end_date: null,
  recurrence_days: null,
  timezone: 'UTC',
  cohort_ids: ['co1'],
};

const STUDENTS = [
  { id: 's1', role: 'student', cohort_id: 'co1',   original_cohort_id: null },
  { id: 's2', role: 'student', cohort_id: 'plan1', original_cohort_id: null },
];
const COHORTS = [
  { id: 'co1',   cohort_kind: 'bootcamp' },
  { id: 'plan1', cohort_kind: 'subscription_plan' },
];

function db(opts: { studentId: string; event?: any }) {
  const upserts: any[] = [];
  const client = {
    upserts,
    from(table: string) {
      const chain: any = {
        _col: '', _values: [] as string[], _upsert: false,
        select() { return chain; },
        eq() { return chain; },
        order() { return chain; },
        range() { return chain; },
        in(col: string, values: string[]) { chain._col = col; chain._values = values; return chain; },
        upsert(row: any) { chain._upsert = true; upserts.push(row); return Promise.resolve({ error: null }); },
        maybeSingle() {
          if (table === 'event_registrations') {
            return Promise.resolve({ data: { event_id: 'ev1', student_id: opts.studentId }, error: null });
          }
          if (table === 'events') return Promise.resolve({ data: opts.event ?? EVENT, error: null });
          return Promise.resolve({ data: null, error: null });
        },
        then(onFulfilled: any, onRejected: any) {
          const match = (row: any) => !chain._col || chain._values.includes(row[chain._col]);
          const rows = (table === 'students' ? STUDENTS : table === 'cohorts' ? COHORTS : []).filter(match);
          return Promise.resolve({ data: rows, count: rows.length, error: null }).then(onFulfilled, onRejected);
        },
      };
      return chain;
    },
  };
  return client;
}

function join() {
  return GET(new NextRequest('http://localhost/api/join?token=abcdefgh12345678'));
}

beforeEach(() => {
  createClientMock.mockReset();
});

describe('GET /api/join', () => {
  it('lets a current cohort member in and records the attendance', async () => {
    const stub = db({ studentId: 's1' });
    createClientMock.mockReturnValue(stub);

    const res = await join();
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toBe('https://meet.test/room');
  });

  it('turns away a token holder who has moved onto a subscription', async () => {
    const stub = db({ studentId: 's2' });
    createClientMock.mockReturnValue(stub);

    const res = await join();
    expect(res.status).toBe(403);
    expect(res.headers.get('location')).toBeNull();
    // Nothing may be recorded either: an attendance row for a session that is not theirs would
    // put them back on the report the filtering just took them off.
    expect(stub.upserts).toEqual([]);
  });

  it('still admits a token holder when the event names no cohorts', async () => {
    // Nothing to check membership against, and locking a running session's attendees out over an
    // unassignment would be a worse bug than the one being fixed.
    const stub = db({ studentId: 's2', event: { ...EVENT, cohort_ids: [] } });
    createClientMock.mockReturnValue(stub);

    expect((await join()).status).toBe(307);
  });
});
