import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeSupabaseStub } from '../helpers/supabaseStub';

const requireUser = vi.hoisted(() => vi.fn());
const createClient = vi.hoisted(() => vi.fn());
const rpc = vi.hoisted(() => vi.fn());

vi.mock('@/lib/api-auth', () => ({ requireUser, isAuthError: (value: any) => Boolean(value?.error) }));
vi.mock('@supabase/supabase-js', () => ({ createClient }));
vi.mock('resend', () => ({ Resend: class { batch = { send: vi.fn() }; } }));

import { POST } from '@/app/api/student-subscriptions/route';

function request(body: Record<string, unknown>) {
  return new NextRequest('http://localhost/api/student-subscriptions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer token' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.RESEND_API_KEY;
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://supabase.test';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key';
  requireUser.mockResolvedValue({
    user: { id: 'student-1', email: 'student@example.com' },
    getActorDb: () => makeSupabaseStub({ students: { data: { role: 'student' }, error: null } }),
    serviceDb: makeSupabaseStub({}),
  });
  rpc.mockResolvedValue({ data: { ok: true, confirmationId: 'conf-1' }, error: null });
  createClient.mockReturnValue({ rpc });
});

describe('student subscription payment confirmation', () => {
  it('does not select internal administrator notes for the student response', () => {
    const source = readFileSync(join(process.cwd(), 'app/api/student-subscriptions/route.ts'), 'utf8');
    expect(source).not.toMatch(/subscription_payment_confirmations\([^)]*admin_notes/);
    expect(source).not.toMatch(/subscription_payments[^;]*\bnotes\b/);
  });

  it('derives student identity from the authenticated session', async () => {
    const response = await POST(request({
      action: 'submit-confirmation', requestId: 'request-1', studentId: 'someone-else',
      amount: 250, paidAt: '2026-08-11', method: 'Mobile Money', reference: 'TX-1',
    }));
    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith('submit_subscription_payment_confirmation', expect.objectContaining({
      p_request_id: 'request-1', p_student_id: 'student-1', p_amount: 250,
      p_paid_at: '2026-08-11', p_reference: 'TX-1',
    }));
  });

  it('rejects unsafe receipt URLs before calling the database', async () => {
    const response = await POST(request({
      action: 'submit-confirmation', requestId: 'request-1', amount: 250,
      paidAt: '2026-08-11', receiptUrl: 'javascript:alert(1)',
    }));
    expect(response.status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });
});
