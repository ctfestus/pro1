import { describe, it, expect, vi, beforeEach } from 'vitest';

// What these guard: event_registrations rows are written once, when an event is assigned to a
// cohort, and are never removed. Reading them raw meant a student moved onto a subscription months
// ago still got the old cohort's session reminders, and still sat on the attendance roster as a
// permanent no-show. These are route-level on purpose -- the rule itself is unit-tested in
// tests/lib/cohort-roster.test.ts, and it was the wiring that shipped broken.

const { batchSend, emailSend } = vi.hoisted(() => ({
  batchSend: vi.fn((_payloads: any[]) => Promise.resolve({ data: null, error: null })),
  emailSend: vi.fn((_payload: any) => Promise.resolve({ data: { id: 'e1' }, error: null })),
}));
vi.mock('resend', () => ({ Resend: class { emails = { send: emailSend }; batch = { send: batchSend }; } }));
vi.mock('@/lib/qstash', () => ({ verifyQStashRequest: vi.fn().mockResolvedValue({ valid: true }) }));
vi.mock('@/lib/get-tenant-settings', () => ({
  getTenantSettings: vi.fn().mockResolvedValue({
    appName: 'App', appUrl: 'https://app.test', senderName: 'Team', supportEmail: 'team@app.test',
    logoUrl: '', emailBannerUrl: '', teamName: 'Team',
  }),
}));

const { adminClientMock } = vi.hoisted(() => ({ adminClientMock: vi.fn() }));
vi.mock('@/lib/admin-client', () => ({ adminClient: adminClientMock }));

const authState = vi.hoisted(() => ({ requireUser: vi.fn() }));
vi.mock('@/lib/api-auth', () => ({ requireUser: authState.requireUser, isAuthError: (v: any) => !!v?.error }));

import { POST as eventReminders } from '@/app/api/cron/event-reminders/route';
import { POST as nudgeAbsent } from '@/app/api/events/nudge-absent/route';

const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);

// s1 is still in the event's cohort. s2 was moved onto a subscription plan cohort and keeps a
// registration row for the old cohort's event.
const STUDENTS = [
  { id: 's1', role: 'student', cohort_id: 'co1', full_name: 'Ama', email: 'ama@example.test' },
  { id: 's2', role: 'student', cohort_id: 'plan1', full_name: 'Kofi', email: 'kofi@example.test' },
];
const COHORTS = [
  { id: 'co1', cohort_kind: 'bootcamp' },
  { id: 'plan1', cohort_kind: 'subscription_plan' },
];

/**
 * Hand-rolled: these routes read `students` both as a roster lookup (filtered by id) and as the
 * cohort fallback (filtered by cohort_id), and the assertions turn on that difference.
 */
function db(opts: { event?: any; registrations?: any[]; attendance?: any[]; registrationsError?: string } = {}) {
  const event = opts.event ?? {
    id: 'ev1', title: 'Live Session', slug: 'live-session', user_id: 'owner1',
    event_date: tomorrow, event_time: '10:00', timezone: 'UTC', location: '', meeting_link: 'https://meet.test',
    event_type: 'virtual', recurrence: 'once', recurrence_end_date: null, recurrence_days: null,
    cohort_ids: ['co1'],
  };
  const registrations = opts.registrations ?? [
    { student_id: 's1', join_token: 't1', student: { full_name: 'Ama', email: 'ama@example.test' } },
    { student_id: 's2', join_token: 't2', student: { full_name: 'Kofi', email: 'kofi@example.test' } },
  ];

  return {
    from(table: string) {
      const chain: any = {
        _byCohort: false,
        select() { return chain; },
        eq(col: string) { if (col === 'cohort_id') chain._byCohort = true; return chain; },
        in(col: string) { if (col === 'cohort_id') chain._byCohort = true; return chain; },
        not() { return chain; },
        order() { return chain; },
        range() { return chain; },
        gte() { return chain; },
        insert() { return Promise.resolve({ error: null }); },
        maybeSingle() { return Promise.resolve({ data: table === 'events' ? event : null, error: null }); },
        then(onFulfilled: any, onRejected: any) {
          if (table === 'event_registrations' && opts.registrationsError) {
            return Promise.resolve({ data: null, error: { message: opts.registrationsError } })
              .then(onFulfilled, onRejected);
          }
          const rows =
            table === 'cohort_assignments'    ? [{ content_id: 'ev1', cohort_id: 'co1', content_type: 'event' }]
            : table === 'events'              ? [event]
            : table === 'event_registrations' ? registrations
            : table === 'live_attendance'     ? (opts.attendance ?? [])
            : table === 'sent_nudges'         ? []
            // The cohort fallback asks by cohort_id; the roster lookup asks by student id.
            : table === 'students'            ? (chain._byCohort ? STUDENTS.filter(s => s.cohort_id === 'co1') : STUDENTS)
            : table === 'cohorts'             ? COHORTS
            : [];
          return Promise.resolve({ data: rows, count: rows.length, error: null }).then(onFulfilled, onRejected);
        },
      };
      return chain;
    },
  };
}

// Reminders go out as Resend batches; absence nudges go one at a time.
function recipients() {
  return [
    ...batchSend.mock.calls.flatMap(([payloads]: any[]) => (payloads ?? []).map((p: any) => p.to)),
    ...emailSend.mock.calls.map(([payload]: any[]) => (payload as any).to),
  ];
}

beforeEach(() => {
  batchSend.mockClear();
  emailSend.mockClear();
  authState.requireUser.mockReset();
});

describe('event reminders', () => {
  it('reminds a current cohort member and not one who moved onto a subscription', async () => {
    adminClientMock.mockReturnValue(db());
    const res = await eventReminders(
      new Request('http://localhost/api/cron/event-reminders', { method: 'POST', body: '{}' }) as any,
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, movedOut: 1 });
    expect(recipients()).toEqual(['ama@example.test']);
  });

  it('sends nothing when every registrant has moved on, rather than mailing the cohort', async () => {
    // There is a fallback for an event whose attendees were never auto-registered. It must not be
    // reachable by the filter emptying the list, or the fix would just divert the send to current
    // members who were never registered and would get no tracked join link.
    adminClientMock.mockReturnValue(db({
      registrations: [{ student_id: 's2', join_token: 't2', student: { full_name: 'Kofi', email: 'kofi@example.test' } }],
    }));
    const res = await eventReminders(
      new Request('http://localhost/api/cron/event-reminders', { method: 'POST', body: '{}' }) as any,
    );
    expect(res.status).toBe(200);
    expect(recipients()).toEqual([]);
  });

  it('does not open the whole-cohort fallback when the registration read fails', async () => {
    // A failed query returns no rows, which is indistinguishable from "nobody was ever
    // registered" -- and that is the one condition the fallback fires on.
    adminClientMock.mockReturnValue(db({ registrationsError: 'connection reset' }));
    const res = await eventReminders(
      new Request('http://localhost/api/cron/event-reminders', { method: 'POST', body: '{}' }) as any,
    );
    expect(res.status).toBe(200);
    expect(recipients()).toEqual([]);
  });

  it('skips an event the source of truth says is assigned to nobody', async () => {
    // cohort_assignments can lag behind a re-assignment, so it decides which events to look at and
    // never who hears about them. An event with an empty events.cohort_ids is assigned to nobody.
    adminClientMock.mockReturnValue(db({ event: {
      id: 'ev1', title: 'Live Session', slug: 'live-session', user_id: 'owner1',
      event_date: tomorrow, event_time: '10:00', timezone: 'UTC', location: '', meeting_link: '',
      event_type: 'virtual', recurrence: 'once', recurrence_end_date: null, recurrence_days: null,
      cohort_ids: [],
    } }));
    const res = await eventReminders(
      new Request('http://localhost/api/cron/event-reminders', { method: 'POST', body: '{}' }) as any,
    );
    expect(res.status).toBe(200);
    expect(recipients()).toEqual([]);
  });
});

describe('absence nudges', () => {
  it('does not chase a student who left the cohort about a session they no longer have', async () => {
    const stub = db({ event: {
      id: 'ev1', title: 'Live Session', slug: 'live-session', meeting_link: 'https://meet.test',
      user_id: 'owner1', event_date: tomorrow, cohort_ids: ['co1'],
    } });
    authState.requireUser.mockResolvedValue({ user: { id: 'owner1' }, serviceDb: stub });

    const res = await nudgeAbsent(new Request('http://localhost/api/events/nudge-absent', {
      method: 'POST',
      body: JSON.stringify({ eventId: 'ev1' }),
    }) as any);

    expect(res.status).toBe(200);
    // Nobody attended, so both registrants are absent -- but only the current member is nudged.
    expect(recipients()).toEqual(['ama@example.test']);
  });
});
