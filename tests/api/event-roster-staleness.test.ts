import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

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

// Reminder tests run on a pinned clock: the job sends by how far away a session is.
const NOW = new Date('2026-06-01T12:00:00Z');

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

// 22 hours after NOW: inside the day-before window.
const EVENT = {
  id: 'ev1', title: 'Live Session', slug: 'live-session', user_id: 'owner1', status: 'published',
  event_date: '2026-06-02', event_time: '10:00', timezone: 'GMT+0 (Accra)', location: '', meeting_link: 'https://meet.test',
  event_type: 'virtual', recurrence: 'once', recurrence_end_date: null, recurrence_days: null,
  cohort_ids: ['co1'],
};

/**
 * Hand-rolled: these routes read `students` both as a roster lookup (filtered by id) and as the
 * cohort list (filtered by cohort_id), and the assertions turn on that difference.
 */
function db(opts: {
  event?: any; registrations?: any[]; attendance?: any[]; registrationsError?: string;
  dedupe?: any[]; rpcError?: string;
} = {}) {
  const event = opts.event ?? EVENT;
  const registrations = [...(opts.registrations ?? [
    { student_id: 's1', join_token: 't1', student: { full_name: 'Ama', email: 'ama@example.test' } },
    { student_id: 's2', join_token: 't2', student: { full_name: 'Kofi', email: 'kofi@example.test' } },
  ])];
  const rpcCalls: any[] = [];

  return {
    rpcCalls,
    rpc(name: string, args: any) {
      rpcCalls.push({ name, args });
      if (opts.rpcError) return Promise.resolve({ data: null, error: { message: opts.rpcError } });
      registrations.push({ student_id: args.p_student_id, join_token: `new-${args.p_student_id}` });
      return Promise.resolve({ data: { ok: true }, error: null });
    },
    from(table: string) {
      const chain: any = {
        _byCohort: false,
        _status: null as string | null,
        select() { return chain; },
        eq(col: string, val: any) {
          if (col === 'cohort_id') chain._byCohort = true;
          if (col === 'status') chain._status = val;
          return chain;
        },
        in(col: string) { if (col === 'cohort_id') chain._byCohort = true; return chain; },
        not() { return chain; },
        order() { return chain; },
        range() { return chain; },
        gte() { return chain; },
        update() { return chain; },
        insert() { return Promise.resolve({ error: null }); },
        upsert() { return Promise.resolve({ error: null }); },
        maybeSingle() { return Promise.resolve({ data: table === 'events' ? event : null, error: null }); },
        then(onFulfilled: any, onRejected: any) {
          if (table === 'event_registrations' && opts.registrationsError) {
            return Promise.resolve({ data: null, error: { message: opts.registrationsError } })
              .then(onFulfilled, onRejected);
          }
          const rows =
            table === 'events'                ? [event].filter(e => !chain._status || e.status === chain._status)
            : table === 'event_registrations' ? registrations
            : table === 'live_attendance'     ? (opts.attendance ?? [])
            : table === 'email_dedup'         ? (opts.dedupe ?? [])
            // The cohort list asks by cohort_id; the roster lookup asks by student id.
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
function sentEmails(): any[] {
  return batchSend.mock.calls.flatMap(([payloads]: any[]) => payloads ?? []);
}

beforeEach(() => {
  batchSend.mockClear();
  emailSend.mockClear();
  authState.requireUser.mockReset();
});

const runReminders = () => eventReminders(
  new Request('http://localhost/api/cron/event-reminders', { method: 'POST', body: '{}' }) as any,
);

describe('event reminders', () => {
  beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(NOW); });
  afterEach(() => { vi.useRealTimers(); });

  it('reminds a current cohort member and not one who moved onto a subscription', async () => {
    adminClientMock.mockReturnValue(db());
    const res = await runReminders();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, sent: 1 });
    expect(recipients()).toEqual(['ama@example.test']);
  });

  it('sends the day-before reminder with the tracked join link, never the raw meeting link', async () => {
    adminClientMock.mockReturnValue(db());
    await runReminders();
    const [email] = sentEmails();
    expect(email.subject).toBe('Reminder: "Live Session" is tomorrow');
    expect(email.html).toContain('https://app.test/api/join?token=t1');
    expect(email.html).not.toContain('href="https://meet.test"');
  });

  it('registers a current member who was never registered and sends their tracked link', async () => {
    const stub = db({ registrations: [] });
    adminClientMock.mockReturnValue(stub);
    await runReminders();
    expect(stub.rpcCalls).toEqual([{ name: 'register_event_attendee', args: { p_event_id: 'ev1', p_student_id: 's1' } }]);
    expect(recipients()).toEqual(['ama@example.test']);
    expect(sentEmails()[0].html).toContain('https://app.test/api/join?token=new-s1');
  });

  it('skips a student it cannot give a join token rather than sending an untracked link', async () => {
    adminClientMock.mockReturnValue(db({ registrations: [], rpcError: 'boom' }));
    await runReminders();
    expect(recipients()).toEqual([]);
  });

  it('sends nothing for the event when the registration read fails', async () => {
    // A failed query returns no rows, which is indistinguishable from "nobody was ever
    // registered" -- registering and mailing everyone on that basis would be guessing.
    adminClientMock.mockReturnValue(db({ registrationsError: 'connection reset' }));
    const res = await runReminders();
    expect(res.status).toBe(200);
    expect(recipients()).toEqual([]);
  });

  it('skips an event the source of truth says is assigned to nobody', async () => {
    adminClientMock.mockReturnValue(db({ event: { ...EVENT, cohort_ids: [] } }));
    await runReminders();
    expect(recipients()).toEqual([]);
  });

  it('does not remind about a draft event', async () => {
    adminClientMock.mockReturnValue(db({ event: { ...EVENT, status: 'draft' } }));
    await runReminders();
    expect(recipients()).toEqual([]);
  });

  it('waits until a session is inside the 24 hour window', async () => {
    adminClientMock.mockReturnValue(db({ event: { ...EVENT, event_time: '14:00' } }));
    await runReminders();
    expect(recipients()).toEqual([]);
  });

  it('sends the one-hour reminder in the last hour, and says today for a same-day session', async () => {
    adminClientMock.mockReturnValue(db({ event: { ...EVENT, event_date: '2026-06-01', event_time: '12:40' } }));
    await runReminders();
    expect(sentEmails()[0].subject).toBe('Starting in 1 hour: Live Session');

    batchSend.mockClear();
    adminClientMock.mockReturnValue(db({ event: { ...EVENT, event_date: '2026-06-01', event_time: '18:00' } }));
    await runReminders();
    expect(sentEmails()[0].subject).toBe('Reminder: "Live Session" is today');
  });

  it('does not send the same reminder twice', async () => {
    adminClientMock.mockReturnValue(db({
      dedupe: [{ dedupe_key: 'ev1:2026-06-02:s1', status: 'sent', sent_at: '2026-06-01T11:45:00Z' }],
    }));
    const res = await runReminders();
    expect(await res.json()).toMatchObject({ sent: 0, skipped: 1 });
    expect(recipients()).toEqual([]);
  });

  it('does not count a batch Resend rejected as sent', async () => {
    adminClientMock.mockReturnValue(db());
    batchSend.mockResolvedValueOnce({ data: null, error: { message: 'rate limited' } } as any);
    const res = await runReminders();
    expect(await res.json()).toMatchObject({ sent: 0 });
  });

  it('retries a reminder whose earlier send died before it was marked sent', async () => {
    adminClientMock.mockReturnValue(db({
      dedupe: [{ dedupe_key: 'ev1:2026-06-02:s1', status: 'pending', sent_at: '2026-06-01T11:00:00Z' }],
    }));
    await runReminders();
    expect(recipients()).toEqual(['ama@example.test']);
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
