import { beforeEach, describe, expect, it, vi } from 'vitest';

const send = vi.hoisted(() => vi.fn());
const generateLink = vi.hoisted(() => vi.fn());

vi.mock('resend', () => ({ Resend: class { emails = { send }; batch = { send: vi.fn() }; } }));
vi.mock('@/lib/get-tenant-settings', () => ({
  getTenantSettings: async () => ({
    appName: 'Test', appUrl: 'https://test.example', senderName: 'Test',
    supportEmail: 'support@test.example', logoUrl: null, emailBannerUrl: null, teamName: 'Test',
  }),
}));

import { notifySubscriptionPaymentRequest } from '@/lib/notify-subscription-payment-request';

// This sender had no direct tests, and the hourly sweep is designed around its settle
// behaviour: rows it declines to send must be stamped, or they keep the oldest slot in a
// 25-wide queue and starve every newer learner.
function makeDb(request: Record<string, any> | null) {
  const rpcCalls: Array<{ fn: string; args: any }> = [];
  const builder: any = {
    select: () => builder,
    eq: () => builder,
    async maybeSingle() { return { data: request, error: null }; },
  };
  return {
    db: {
      from: () => builder,
      rpc: async (fn: string, args: any) => {
        rpcCalls.push({ fn, args });
        if (fn === 'claim_learner_welcome_email') return { data: true, error: null };
        return { error: null };
      },
      auth: { admin: { generateLink } },
    } as any,
    rpcCalls,
  };
}

function openRequest(overrides: Record<string, any> = {}) {
  return {
    id: 'req-1', student_id: 'student-1', plan_name: 'Pro', amount: 300, currency: 'GHS',
    due_date: '2026-09-01', kind: 'purchase', status: 'pending', request_email_sent_at: null,
    students: {
      email: 'ada@example.com', full_name: 'Ada',
      account_origin: 'self_signup', password_set_at: '2026-01-01T00:00:00Z', setup_email_sent_at: null,
    },
    ...overrides,
  };
}

const stamped = (rpcCalls: Array<{ fn: string; args: any }>) =>
  rpcCalls.some(c => c.fn === 'mark_subscription_email_delivered' && c.args.p_request_id === 'req-1');

beforeEach(() => {
  vi.clearAllMocks();
  process.env.RESEND_API_KEY = 'test-key';
  send.mockResolvedValue({ error: null });
  generateLink.mockResolvedValue({ data: { properties: { hashed_token: 'tok' } }, error: null });
});

describe('payment request email', () => {
  it('sends the request-only email to a learner who can already sign in', async () => {
    const { db, rpcCalls } = makeDb(openRequest());

    await expect(notifySubscriptionPaymentRequest(db, { requestId: 'req-1' })).resolves.toEqual({ sent: true });

    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({ subject: 'Payment request for Pro' }),
      { idempotencyKey: 'subscription-request/req-1' },
    );
    expect(stamped(rpcCalls)).toBe(true);
  });

  it('sends the combined welcome to a staff-created learner who has no password yet', async () => {
    const { db } = makeDb(openRequest({
      students: {
        email: 'ada@example.com', full_name: 'Ada',
        account_origin: 'admissions', password_set_at: null, setup_email_sent_at: null,
      },
    }));

    await expect(notifySubscriptionPaymentRequest(db, { requestId: 'req-1' })).resolves.toEqual({ sent: true });

    // The welcome carries the setup link; the request-only email would point them at a
    // dashboard they cannot reach.
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({ subject: 'Your Test account is ready' }),
    );
  });

  it('does not send a second welcome once one has already gone out', async () => {
    const { db } = makeDb(openRequest({
      students: {
        email: 'ada@example.com', full_name: 'Ada',
        account_origin: 'admissions', password_set_at: null,
        setup_email_sent_at: '2026-01-01T00:00:00Z',
      },
    }));

    await notifySubscriptionPaymentRequest(db, { requestId: 'req-1' });

    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({ subject: 'Payment request for Pro' }),
      expect.anything(),
    );
  });

  it('leaves the request unstamped when delivery fails, so the sweep retries it', async () => {
    const { db, rpcCalls } = makeDb(openRequest());
    send.mockResolvedValue({ error: { message: 'Resend is down' } });

    await expect(notifySubscriptionPaymentRequest(db, { requestId: 'req-1' })).rejects.toThrow('Resend is down');

    expect(stamped(rpcCalls)).toBe(false);
  });

  it('never resends one that already went out', async () => {
    const { db } = makeDb(openRequest({ request_email_sent_at: '2026-01-01T00:00:00Z' }));

    await expect(notifySubscriptionPaymentRequest(db, { requestId: 'req-1' })).resolves.toEqual({ sent: false });
    expect(send).not.toHaveBeenCalled();
  });

  // Each of these would otherwise sit at the head of the queue forever, because the sweep
  // selects the oldest unstamped rows and these can never succeed.
  it.each([
    ['a deleted learner', { student_id: null, students: null }],
    ['a cancelled request', { status: 'cancelled' }],
    ['a request already paid', { status: 'paid' }],
  ])('settles %s instead of retrying it forever', async (_label, overrides) => {
    const { db, rpcCalls } = makeDb(openRequest(overrides));

    await expect(notifySubscriptionPaymentRequest(db, { requestId: 'req-1' })).resolves.toEqual({ sent: false });

    expect(send).not.toHaveBeenCalled();
    expect(stamped(rpcCalls)).toBe(true);
  });
});
