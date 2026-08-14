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

import { learnerNeedsSetup, sendIndividualLearnerWelcome } from '@/lib/notify-individual-learner-welcome';

// Tracks which tables were updated, because the whole point is that one email stamps every
// record it covers. Missing a stamp means the hourly sweep later sends a second, redundant
// message about something the learner has already been told.
function makeDb(rows: Record<string, any>, claimGranted = true) {
  const updates: Array<{ table: string; patch: any }> = [];
  const rpcCalls: Array<{ fn: string; args: any }> = [];
  let table = '';
  let patch: any = null;
  let id = '';
  const builder: any = {
    select() { return builder; },
    eq(_c: string, value: string) { id = value; return builder; },
    is() { return builder; },
    update(next: any) { patch = next; return builder; },
    async maybeSingle() { return { data: rows[id] ?? null, error: null }; },
    then(resolve: any) {
      if (patch) { updates.push({ table, patch }); patch = null; }
      return Promise.resolve({ error: null }).then(resolve);
    },
  };
  return {
    db: {
      from(name: string) { table = name; return builder; },
      rpc: async (fn: string, args: any) => {
        rpcCalls.push({ fn, args });
        // claim_learner_welcome_email returns whether this worker won the right to send.
        if (fn === 'claim_learner_welcome_email') return { data: claimGranted, error: null };
        return { error: null };
      },
      auth: { admin: { generateLink } },
    },
    updates,
    rpcCalls,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.RESEND_API_KEY = 'test-key';
  send.mockResolvedValue({ error: null });
  generateLink.mockResolvedValue({ data: { properties: { hashed_token: 'tok' } }, error: null });
});

const stampCalls = (rpcCalls: Array<{ fn: string; args: any }>) =>
  rpcCalls.filter(c => c.fn === 'mark_subscription_email_delivered');

describe('new individual learner welcome email', () => {
  // The admin route and the hourly sweep can run at the same instant. Both would read
  // setup_email_sent_at IS NULL and both would send; stamping atomically afterwards cannot
  // undo two emails, so the claim has to settle it before the send.
  it('stands down when another worker already holds the claim', async () => {
    const { db } = makeDb({
      'pay-1': {
        plan_name: 'Pro', duration_months: 3, period_start: '2026-01-01T00:00:00Z',
        period_end: '2026-04-01T00:00:00Z', is_activating: true, activation_email_sent_at: null,
      },
    }, false);

    const result = await sendIndividualLearnerWelcome(db as any, {
      studentId: 'student-1', email: 'ada@example.com', fullName: 'Ada', paymentId: 'pay-1',
    });

    expect(result).toEqual({ sent: false });
    expect(send).not.toHaveBeenCalled();
  });

  it('only offers setup to a staff-created learner who has neither a password nor an earlier welcome', () => {
    expect(learnerNeedsSetup({
      account_origin: 'admissions', password_set_at: null, setup_email_sent_at: null,
    })).toBe(true);

    // The trap this rule exists for: password_set_at is null for every account predating
    // that column, so on its own it would mail a password reset to the entire existing
    // learner base instead of their subscription notice.
    expect(learnerNeedsSetup({
      account_origin: 'self_signup', password_set_at: null, setup_email_sent_at: null,
    })).toBe(false);

    // Already welcomed once: later payments take the ordinary activation email.
    expect(learnerNeedsSetup({
      account_origin: 'admissions', password_set_at: null, setup_email_sent_at: '2026-01-01T00:00:00Z',
    })).toBe(false);

    expect(learnerNeedsSetup({
      account_origin: 'admissions', password_set_at: '2026-01-02T00:00:00Z', setup_email_sent_at: null,
    })).toBe(false);
  });

  it('sends one email and stamps both the account and the payment', async () => {
    const { db, rpcCalls } = makeDb({
      'pay-1': {
        plan_name: 'Pro', duration_months: 3, period_start: '2026-01-01T00:00:00Z',
        period_end: '2026-04-01T00:00:00Z', activation_email_sent_at: null,
      },
    });

    const result = await sendIndividualLearnerWelcome(db as any, {
      studentId: 'student-1', email: 'ada@example.com', fullName: 'Ada', paymentId: 'pay-1',
    });

    expect(result).toEqual({ sent: true });
    expect(send).toHaveBeenCalledTimes(1);
    // One transaction covering both records, so a failure between them cannot leave the
    // learner stamped but the payment unstamped (or the reverse).
    expect(stampCalls(rpcCalls)).toEqual([{
      fn: 'mark_subscription_email_delivered',
      args: { p_student_id: 'student-1', p_payment_id: 'pay-1', p_request_id: null, p_mark_setup: true },
    }]);
  });

  it('sends one email and stamps both the account and the request', async () => {
    const { db, rpcCalls } = makeDb({
      'req-1': {
        plan_name: 'Pro', duration_months: 3, amount: 300, currency: 'GHS',
        due_date: '2026-09-01', kind: 'purchase', request_email_sent_at: null,
      },
    });

    const result = await sendIndividualLearnerWelcome(db as any, {
      studentId: 'student-1', email: 'ada@example.com', fullName: 'Ada', requestId: 'req-1',
    });

    expect(result).toEqual({ sent: true });
    expect(send).toHaveBeenCalledTimes(1);
    expect(stampCalls(rpcCalls)).toEqual([{
      fn: 'mark_subscription_email_delivered',
      args: { p_student_id: 'student-1', p_payment_id: null, p_request_id: 'req-1', p_mark_setup: true },
    }]);
  });

  it('does not resend once the plan record is already stamped', async () => {
    const { db } = makeDb({
      'pay-1': {
        plan_name: 'Pro', duration_months: 3, period_start: '2026-01-01T00:00:00Z',
        period_end: '2026-04-01T00:00:00Z', activation_email_sent_at: '2026-01-01T00:00:00Z',
      },
    });

    const result = await sendIndividualLearnerWelcome(db as any, {
      studentId: 'student-1', email: 'ada@example.com', paymentId: 'pay-1',
    });

    expect(result).toEqual({ sent: false });
    expect(send).not.toHaveBeenCalled();
  });

  it('leaves the record unstamped when delivery fails, so the sweep retries it', async () => {
    const { db, rpcCalls } = makeDb({
      'req-1': {
        plan_name: 'Pro', duration_months: 3, amount: 300, currency: 'GHS',
        due_date: '2026-09-01', kind: 'purchase', request_email_sent_at: null,
      },
    });
    send.mockResolvedValue({ error: { message: 'Resend is down' } });

    await expect(sendIndividualLearnerWelcome(db as any, {
      studentId: 'student-1', email: 'ada@example.com', requestId: 'req-1',
    })).rejects.toThrow('Resend is down');

    // Nothing stamped, so the sweep retries it rather than treating it as delivered, and
    // the claim is handed back so the retry does not wait out the TTL.
    expect(stampCalls(rpcCalls)).toEqual([]);
    expect(rpcCalls.some(c => c.fn === 'release_learner_welcome_claim')).toBe(true);
  });
});
