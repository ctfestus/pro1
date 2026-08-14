import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextResponse } from 'next/server';

// The hole this file guards: the endpoint took the recipient address straight from the request body
// and checked only that the caller owned the content. Any authenticated instructor could therefore
// have branded platform email delivered to an arbitrary address. Owning the content is now
// necessary but not sufficient -- the address has to belong to a student the content reaches, and
// the name and address that go on the email come from that record rather than from the body.

// vi.hoisted, because the route builds its Resend client at module load -- earlier than a plain
// const in this file would be initialised.
const { sendSpy } = vi.hoisted(() => ({ sendSpy: vi.fn((_payload: any) => Promise.resolve({ error: null })) }));
vi.mock('resend', () => ({ Resend: class { emails = { send: sendSpy }; batch = { send: vi.fn() }; } }));
vi.mock('@/lib/get-tenant-settings', () => ({
  getTenantSettings: vi.fn().mockResolvedValue({
    appName: 'App', appUrl: 'https://app.test', senderName: 'Team', supportEmail: 'team@app.test',
    logoUrl: '', emailBannerUrl: '', teamName: 'Team',
  }),
}));
vi.mock('@/lib/api-auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api-auth')>()),
  requireUser: vi.fn(),
}));

import { requireUser } from '@/lib/api-auth';
import { POST } from '@/app/api/nudge-student/route';

const mockRequireUser = vi.mocked(requireUser);

const COURSE = { user_id: 'owner1', title: 'SQL Basics', slug: 'sql-basics', cover_image: null, cohort_ids: ['co1'], available_to_everyone: false, status: 'published' };
const ENROLLED = { id: 's1', email: 'ama@example.com', full_name: 'Ama Mensah', cohort_id: 'co1', role: 'student' };
const OUTSIDER = { id: 's9', email: 'outsider@example.com', full_name: 'Someone Else', cohort_id: 'co9', role: 'student' };

/**
 * Hand-rolled rather than using makeSupabaseStub: this route queries `students` three times with
 * different filters (the caller's role, then the recipient by email) and the assertions turn on
 * which row each lookup returns.
 */
function db(opts: { recipient?: any; path?: any; course?: any; courseAttempts?: any[] } = {}) {
  const inserted: any[] = [];
  // Awaiting a chain (rather than calling .single()/.maybeSingle()) is how the status classifier
  // reads its list queries, so the chain is thenable too.
  const listRows = (table: string) => table === 'course_attempts' ? (opts.courseAttempts ?? []) : [];
  return {
    inserted,
    from(table: string) {
      const chain: any = {
        _byEmail: false,
        select() { return chain; },
        eq(col: string) { if (col === 'email') chain._byEmail = true; return chain; },
        in() { return chain; },
        order() { return chain; },
        range() { return chain; },
        contains() { return chain; },
        limit() { return chain; },
        insert(row: any) { inserted.push({ table, row }); return Promise.resolve({ error: null }); },
        maybeSingle() {
          if (table === 'courses')             return Promise.resolve({ data: opts.course ?? COURSE });
          if (table === 'learning_paths')      return Promise.resolve({ data: opts.path ?? null });
          if (table === 'students')            return Promise.resolve({ data: chain._byEmail ? (opts.recipient ?? null) : { role: 'instructor' } });
          return Promise.resolve({ data: null });
        },
        single() { return Promise.resolve({ data: { role: 'instructor' } }); },
        then(onFulfilled: any, onRejected: any) {
          const rows = listRows(table);
          return Promise.resolve({ data: rows, count: rows.length, error: null }).then(onFulfilled, onRejected);
        },
      };
      return chain;
    },
  };
}

function post(body: any) {
  return POST(new Request('http://localhost/api/nudge-student', { method: 'POST', body: JSON.stringify(body) }) as any);
}

const NUDGE = { studentEmail: 'ama@example.com', formId: 'c1', status: 'stalled' };

beforeEach(() => {
  mockRequireUser.mockReset();
  sendSpy.mockClear();
  process.env.RESEND_API_KEY = 'test-key';
});

function authedAs(client: any, userId = 'owner1') {
  mockRequireUser.mockResolvedValue({ user: { id: userId }, actor: { id: userId }, isStudentMode: false, supabase: client, token: 't' } as any);
}

describe('POST /api/nudge-student recipient authorization', () => {
  it('401 for an anonymous caller', async () => {
    mockRequireUser.mockResolvedValue({ error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) } as any);
    expect((await post(NUDGE)).status).toBe(401);
  });

  it('nudges a student the content reaches', async () => {
    authedAs(db({ recipient: ENROLLED }));
    expect((await post(NUDGE)).status).toBe(200);
    expect(sendSpy).toHaveBeenCalledTimes(1);
    expect(sendSpy.mock.calls[0][0].to).toBe('ama@example.com');
  });

  it('refuses an address that belongs to no student', async () => {
    authedAs(db({ recipient: null }));
    const res = await post({ ...NUDGE, studentEmail: 'attacker@elsewhere.com' });
    expect(res.status).toBe(403);
    expect(sendSpy).not.toHaveBeenCalled();
  });

  it('refuses a student in a cohort the content is not assigned to', async () => {
    authedAs(db({ recipient: OUTSIDER }));
    const res = await post({ ...NUDGE, studentEmail: OUTSIDER.email });
    expect(res.status).toBe(403);
    expect(sendSpy).not.toHaveBeenCalled();
  });

  it('gives the same refusal either way, so the response cannot be used to probe for students', async () => {
    authedAs(db({ recipient: null }));
    const unknown = await (await post({ ...NUDGE, studentEmail: 'attacker@elsewhere.com' })).json();
    authedAs(db({ recipient: OUTSIDER }));
    const unassigned = await (await post({ ...NUDGE, studentEmail: OUTSIDER.email })).json();
    expect(unknown.error).toBe(unassigned.error);
  });

  it('refuses a non-student account even when the address exists', async () => {
    authedAs(db({ recipient: { ...ENROLLED, role: 'instructor' } }));
    expect((await post(NUDGE)).status).toBe(403);
    expect(sendSpy).not.toHaveBeenCalled();
  });

  it('allows a cohort reached only through a published learning path', async () => {
    authedAs(db({ recipient: OUTSIDER, path: { id: 'lp1' } }));
    expect((await post({ ...NUDGE, studentEmail: OUTSIDER.email })).status).toBe(200);
    expect(sendSpy).toHaveBeenCalledTimes(1);
  });

  it('refuses a draft item sitting inside a published learning path', async () => {
    // The path being published is not enough: students cannot open a draft by any route, so the
    // nudge would mail a link that refuses them. Tracking already declines to extend the grant to
    // drafts, and this now matches it.
    authedAs(db({ recipient: OUTSIDER, path: { id: 'lp1' }, course: { ...COURSE, status: 'draft' } }));
    expect((await post({ ...NUDGE, studentEmail: OUTSIDER.email })).status).toBe(409);
    expect(sendSpy).not.toHaveBeenCalled();
  });

  it('refuses a draft item even when directly assigned to the cohort', async () => {
    authedAs(db({ recipient: ENROLLED, course: { ...COURSE, status: 'draft' } }));
    expect((await post(NUDGE)).status).toBe(409);
    expect(sendSpy).not.toHaveBeenCalled();
  });

  it('refuses a student who merely could enrol on an open course', async () => {
    // Open to enrol is not enrolled, and a nudge only ever comes from a tracking row -- which
    // exists solely for cohort-assigned or path-granted students.
    authedAs(db({ recipient: OUTSIDER, course: { ...COURSE, cohort_ids: [], available_to_everyone: true } }));
    expect((await post({ ...NUDGE, studentEmail: OUTSIDER.email })).status).toBe(403);
    expect(sendSpy).not.toHaveBeenCalled();
  });

  it('takes the recipient name from the record, not the request body', async () => {
    authedAs(db({ recipient: ENROLLED }));
    await post({ ...NUDGE, studentName: 'Injected Name' });
    const sent = sendSpy.mock.calls[0][0];
    expect(sent.subject).toContain('Ama Mensah');
    expect(sent.subject).not.toContain('Injected Name');
  });
});

describe('POST /api/nudge-student derived status', () => {
  it('uses the status it computes, not the one the browser sent', async () => {
    // No attempt exists, so this student has not started -- whatever a stale table claimed.
    authedAs(db({ recipient: ENROLLED }));
    await post({ ...NUDGE, status: 'stalled' });
    expect(sendSpy.mock.calls[0][0].subject).toContain('waiting');
  });

  it('refuses to nudge someone who has already finished', async () => {
    authedAs(db({
      recipient: ENROLLED,
      courseAttempts: [{ student_id: 's1', course_id: 'c1', completed_at: '2026-08-01T00:00:00Z', updated_at: '2026-08-01T00:00:00Z', passed: true, score: 90 }],
    }));
    expect((await post(NUDGE)).status).toBe(409);
    expect(sendSpy).not.toHaveBeenCalled();
  });
});
