import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/api-auth', () => ({ requireUser: vi.fn(), isAuthError: (v: any) => !!v?.error }));
vi.mock('@supabase/supabase-js', () => ({ createClient: vi.fn() }));
import { requireUser } from '@/lib/api-auth';
import { createClient } from '@supabase/supabase-js';
import { makeSupabaseStub } from '../helpers/supabaseStub';
import { POST } from '@/app/api/student-payments/route';

const ENROLLMENT = { id: 'enr-1', cohort_id: 'c1' };
const inserts: any[] = [];

/** `waiting` is what the repeat check finds: a confirmation still pending review, or none. */
function db(waiting: unknown) {
  const base = makeSupabaseStub({
    bootcamp_enrollments: { data: ENROLLMENT },
    student_payment_confirmations: [{ data: waiting }, { data: null }],
  });
  vi.mocked(createClient).mockReturnValue({
    ...base,
    from: (t: string) => {
      const b: any = base.from(t);
      return new Proxy(b, { get: (o: any, p) => (p === 'insert' ? (row: any) => { inserts.push(row); return o.insert(row); } : o[p]) });
    },
  } as any);
}

const send = (body: Record<string, unknown>) => POST(new NextRequest('http://localhost/api/student-payments', {
  method: 'POST',
  body: JSON.stringify({ enrollmentId: 'enr-1', amount: 500, paidAt: '2026-11-20', ...body }),
}));

beforeEach(() => {
  vi.clearAllMocks();
  inserts.length = 0;
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://db';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'key';
  delete process.env.RESEND_API_KEY;
  vi.mocked(requireUser).mockResolvedValue({ user: { id: 'stu-1', email: 'ama@example.com' } } as any);
});

describe('POST /api/student-payments: the same payment sent twice', () => {
  it('saves a payment the first time', async () => {
    db(null);
    const res = await send({ reference: ' TX-1 ' });
    expect(await res.json()).toEqual({ ok: true });
    expect(inserts).toHaveLength(1);
    expect(inserts[0]).toMatchObject({ amount: 500, paid_at: '2026-11-20', reference: 'TX-1', status: 'pending' });
  });

  it('does not save an exact repeat of one still waiting for review, and says it was already sent', async () => {
    db({ id: 'conf-1' });
    const res = await send({ reference: 'TX-1' });
    expect(await res.json()).toEqual({ ok: true, alreadySent: true });
    expect(inserts).toHaveLength(0);
  });
});
