import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { makeSupabaseStub } from '../helpers/supabaseStub';

const requireStudentUser = vi.hoisted(() => vi.fn());
const rpc = vi.hoisted(() => vi.fn());

vi.mock('@/lib/api-auth', () => ({
  requireStudentUser,
  isAuthError: (value: any) => Boolean(value?.error),
}));
vi.mock('resend', () => ({
  Resend: vi.fn(function () {
    return { emails: { send: vi.fn() } };
  }),
}));

import { POST } from '@/app/api/event-register/route';

function request() {
  return new NextRequest('http://localhost/api/event-register', {
    method: 'POST',
    headers: { authorization: 'Bearer token', 'content-type': 'application/json' },
    body: JSON.stringify({ formId: 'event-1' }),
  });
}

function authedWith(cohortKind: string | null) {
  const supabase: any = makeSupabaseStub({
    students: [
      { data: { id: 'student-1', email: 'one@example.com', full_name: 'One', cohort_id: 'cohort-1' }, error: null },
      { data: { role: 'student', cohort_id: 'cohort-1', email: 'one@example.com' }, error: null },
    ],
    events: {
      data: {
        id: 'event-1',
        title: 'Live session',
        slug: 'live-session',
        event_date: '2026-09-01',
        event_time: '10:00',
        timezone: 'UTC',
        location: null,
        meeting_link: null,
        status: 'published',
        cohort_ids: ['cohort-1'],
      },
      error: null,
    },
    cohorts: { data: cohortKind ? { cohort_kind: cohortKind } : null, error: null },
  });
  supabase.rpc = rpc;
  requireStudentUser.mockResolvedValue({
    user: { id: 'student-1', email: 'one@example.com' },
    supabase,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.RESEND_API_KEY;
  rpc.mockResolvedValue({ data: { ok: true }, error: null });
});

describe('POST /api/event-register bootcamp access', () => {
  it.each(['subscription_plan', 'legacy_individual'])(
    'refuses registration for a %s cohort',
    async cohortKind => {
      authedWith(cohortKind);

      const response = await POST(request());

      expect(response.status).toBe(403);
      await expect(response.json()).resolves.toEqual({ error: 'Bootcamp cohort access required.' });
      expect(rpc).not.toHaveBeenCalled();
    },
  );

  it('fails closed when the cohort row is missing', async () => {
    authedWith(null);

    const response = await POST(request());

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: 'Bootcamp cohort access required.' });
    expect(rpc).not.toHaveBeenCalled();
  });
});
