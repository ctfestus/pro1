import { beforeEach, describe, expect, it, vi } from 'vitest';

const send = vi.hoisted(() => vi.fn());
const batchSend = vi.hoisted(() => vi.fn());

vi.mock('resend', () => ({
  Resend: class { emails = { send }; batch = { send: batchSend }; },
}));
vi.mock('@/lib/get-tenant-settings', () => ({
  getTenantSettings: async () => ({
    appName: 'Test', appUrl: 'https://test.example', senderName: 'Test',
    supportEmail: 'support@test.example', logoUrl: null, emailBannerUrl: null, teamName: 'Test',
  }),
}));

import { notifySubscriptionActivated, notifySubscriptionActivatedBatch } from '@/lib/notify-subscription-activated';

// A payment row plus the delivery stamp, behaving like the database: stamping only takes
// effect on rows that are still unstamped, exactly as the .is('activation_email_sent_at',
// null) guard does.
function makeDb(rows: Record<string, any>) {
  const stamped: string[] = [];
  const rpcCalls: Array<{ fn: string; args: any }> = [];
  const db: any = {
    from() { return builder; },
    // The combined welcome email generates a fresh setup link on every attempt.
    auth: { admin: { generateLink: async () => ({ data: { properties: { hashed_token: 'tok' } }, error: null }) } },
    async rpc(fn: string, args: any) {
      rpcCalls.push({ fn, args });
      if (fn === 'claim_learner_welcome_email') return { data: true, error: null };
      if (fn === 'mark_subscription_email_delivered') {
        if (args.p_payment_id) rows[args.p_payment_id].activation_email_sent_at = new Date().toISOString();
        // The learner is stamped too, which is what stops a second welcome for their other
        // unstamped payments.
        if (args.p_mark_setup) {
          for (const row of Object.values(rows) as any[]) {
            if (row.students) row.students.setup_email_sent_at = new Date().toISOString();
          }
        }
      }
      return { error: null };
    },
  };
  let filterIds: string[] | null = null;
  let singleId: string | null = null;
  let onlyUnsent = false;
  let pendingUpdate: any = null;

  const builder: any = {
    select() { return builder; },
    eq(_col: string, value: string) { singleId = value; return builder; },
    in(_col: string, values: string[]) { filterIds = values; return builder; },
    is() { onlyUnsent = true; return builder; },
    update(patch: any) { pendingUpdate = patch; return builder; },
    async maybeSingle() {
      const row = singleId ? rows[singleId] : null;
      singleId = null;
      return { data: row ?? null, error: null };
    },
    then(resolve: any) {
      if (pendingUpdate) {
        for (const id of filterIds ?? []) {
          if (!rows[id].activation_email_sent_at) {
            rows[id].activation_email_sent_at = pendingUpdate.activation_email_sent_at;
            stamped.push(id);
          }
        }
        pendingUpdate = null; filterIds = null; onlyUnsent = false;
        return Promise.resolve({ error: null }).then(resolve);
      }
      const ids = filterIds ?? [];
      const data = ids.map(id => rows[id]).filter(r => (onlyUnsent ? !r.activation_email_sent_at : true));
      filterIds = null; onlyUnsent = false;
      return Promise.resolve({ data, error: null }).then(resolve);
    },
  };
  return { db, rows, stamped, rpcCalls };
}

function payment(id: string, overrides: Record<string, any> = {}): Record<string, any> {
  return {
    id, student_id: `student-${id}`, plan_name: 'Pro', duration_months: 3,
    period_start: '2026-01-01T00:00:00Z', period_end: '2026-04-01T00:00:00Z',
    is_activating: true, activation_email_sent_at: null,
    // Already set up, so these exercise the plan-only path. A learner who cannot sign
    // in yet is routed to the combined welcome email instead.
    students: {
      email: `${id}@example.com`, full_name: 'Ada', account_origin: 'admissions',
      password_set_at: '2026-01-01T00:00:00Z', setup_email_sent_at: '2026-01-01T00:00:00Z',
    },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.RESEND_API_KEY = 'test-key';
  send.mockResolvedValue({ error: null });
  batchSend.mockResolvedValue({ error: null });
});

// The payment is committed before the email is attempted, so a delivery failure used to
// be permanent: the retry reported "already processed" and skipped the email forever. The
// learner had access and was never told. These pin that a failure stays retryable and a
// success is never repeated.
describe('activation email delivery is durable', () => {
  it('retries a failed email on the next attempt, then stops', async () => {
    const { db, rows } = makeDb({ 'pay-1': payment('pay-1') });
    send.mockRejectedValueOnce(new Error('Resend is down'));

    await expect(notifySubscriptionActivated(db, { paymentId: 'pay-1' })).rejects.toThrow('Resend is down');
    expect(rows['pay-1'].activation_email_sent_at).toBeNull();

    await expect(notifySubscriptionActivated(db, { paymentId: 'pay-1' })).resolves.toEqual({ sent: true });
    expect(rows['pay-1'].activation_email_sent_at).not.toBeNull();

    // A third attempt must not send another copy.
    await expect(notifySubscriptionActivated(db, { paymentId: 'pay-1' })).resolves.toEqual({ sent: false });
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('keys each send to its payment so a crash before stamping cannot duplicate', async () => {
    const { db } = makeDb({ 'pay-1': payment('pay-1') });
    await notifySubscriptionActivated(db, { paymentId: 'pay-1' });
    expect(send).toHaveBeenCalledWith(expect.anything(), { idempotencyKey: 'subscription-activated/pay-1' });
  });

  it('stops retrying a deleted learner instead of failing forever', async () => {
    const { db, rows } = makeDb({ 'pay-1': payment('pay-1', { student_id: null, students: null }) });

    await expect(notifySubscriptionActivated(db, { paymentId: 'pay-1' })).resolves.toEqual({ sent: false });
    expect(send).not.toHaveBeenCalled();
    expect(rows['pay-1'].activation_email_sent_at).not.toBeNull();
  });

  it('resends only the learners a partly failed bulk run missed', async () => {
    const rows = { 'pay-1': payment('pay-1'), 'pay-2': payment('pay-2'), 'pay-3': payment('pay-3') };
    const { db } = makeDb(rows);
    // First run: the batch fails. It no longer throws -- throwing abandoned every later
    // chunk and left these rows at attempt zero, so the same failing slice reoccupied the
    // head of the queue forever. The failure is counted and the rows stay unstamped.
    batchSend.mockRejectedValueOnce(new Error('Resend is down'));
    const first = await notifySubscriptionActivatedBatch(db, { paymentIds: ['pay-1', 'pay-2', 'pay-3'] });
    expect(first.failed).toBe(3);
    expect(Object.values(rows).every(r => r.activation_email_sent_at === null)).toBe(true);

    // Simulate one of them having been delivered and stamped by an earlier chunk.
    rows['pay-2'].activation_email_sent_at = '2026-01-01T00:00:00Z';

    const result = await notifySubscriptionActivatedBatch(db, { paymentIds: ['pay-1', 'pay-2', 'pay-3'] });
    expect(result.sent).toBe(2);
    const recipients = batchSend.mock.calls.at(-1)?.[0].map((m: any) => m.to);
    expect(recipients).toEqual(['pay-1@example.com', 'pay-3@example.com']);
  });

  it('sends nothing when a fully delivered import is re-run', async () => {
    const rows = {
      'pay-1': payment('pay-1', { activation_email_sent_at: '2026-01-01T00:00:00Z' }),
      'pay-2': payment('pay-2', { activation_email_sent_at: '2026-01-01T00:00:00Z' }),
    };
    const { db } = makeDb(rows);

    const result = await notifySubscriptionActivatedBatch(db, { paymentIds: ['pay-1', 'pay-2'] });

    expect(result).toEqual({ sent: 0, skipped: 0, failed: 0 });
    expect(batchSend).not.toHaveBeenCalled();
  });

  it('derives the batch key from the payments in the chunk, not the import', async () => {
    const { db } = makeDb({ 'pay-1': payment('pay-1'), 'pay-2': payment('pay-2') });
    await notifySubscriptionActivatedBatch(db, { paymentIds: ['pay-1', 'pay-2'] });
    const firstKey = batchSend.mock.calls[0][1].idempotencyKey;

    const second = makeDb({ 'pay-3': payment('pay-3') });
    await notifySubscriptionActivatedBatch(second.db, { paymentIds: ['pay-3'] });
    const secondKey = batchSend.mock.calls[1][1].idempotencyKey;

    // A different set of recipients must not reuse a key, or Resend would discard the
    // second send as a duplicate of the first.
    expect(secondKey).not.toBe(firstKey);
  });

  // The retry case that made this necessary: isNewAccount is true only while the account is
  // being created, so a welcome email that failed used to be retried as a plan-only notice.
  // The learner was told their subscription was active while still having no way to sign in.
  it('retries a failed welcome as a welcome, not a plan-only email', async () => {
    const { db } = makeDb({
      'pay-1': payment('pay-1', {
        students: { email: 'ada@example.com', full_name: 'Ada', account_origin: 'admissions', password_set_at: null, setup_email_sent_at: null },
      }),
    });

    await notifySubscriptionActivated(db, { paymentId: 'pay-1' });

    // The plan-only sender must not have been used for someone who cannot sign in.
    expect(send).not.toHaveBeenCalledWith(
      expect.objectContaining({ subject: expect.stringContaining('subscription is active') }),
      expect.anything(),
    );
  });

  it('routes a learner who cannot sign in to the welcome email in bulk too', async () => {
    const { db } = makeDb({
      'pay-1': payment('pay-1', {
        students: { email: 'ada@example.com', full_name: 'Ada', account_origin: 'admissions', password_set_at: null, setup_email_sent_at: null },
      }),
      'pay-2': payment('pay-2'),
    });

    await notifySubscriptionActivatedBatch(db, { paymentIds: ['pay-1', 'pay-2'] });

    // Only the already-set-up learner is batched; the other needs a fresh setup link, which
    // cannot share a batch payload.
    const recipients = batchSend.mock.calls.at(-1)?.[0].map((m: any) => m.to);
    expect(recipients).toEqual(['pay-2@example.com']);
  });

  it('does not send a second welcome once one has already gone out', async () => {
    const { db } = makeDb({
      'pay-1': payment('pay-1', {
        students: {
          email: 'ada@example.com', full_name: 'Ada', account_origin: 'admissions',
          password_set_at: null, setup_email_sent_at: '2026-01-01T00:00:00Z',
        },
      }),
    });

    await notifySubscriptionActivated(db, { paymentId: 'pay-1' });

    // setup_email_sent_at is what makes the welcome a once-per-learner decision. A later
    // payment for the same learner takes the ordinary activation email instead of a second
    // "your account is ready".
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({ subject: expect.stringContaining('subscription is active') }),
      expect.anything(),
    );
    expect(send).not.toHaveBeenCalledWith(
      expect.objectContaining({ subject: 'Your Test account is ready' }),
    );
  });

  it('continues after one combined welcome fails in a bulk run', async () => {
    const setupState = { account_origin: 'admissions', password_set_at: null, setup_email_sent_at: null };
    const { db } = makeDb({
      'pay-1': payment('pay-1', { students: { email: 'first@example.com', full_name: 'First', ...setupState } }),
      'pay-2': payment('pay-2', { students: { email: 'second@example.com', full_name: 'Second', ...setupState } }),
    });
    send.mockResolvedValueOnce({ error: { message: 'Invalid recipient' } });

    const result = await notifySubscriptionActivatedBatch(db, { paymentIds: ['pay-1', 'pay-2'] });

    expect(result).toEqual({ sent: 1, skipped: 0, failed: 1 });
    expect(send).toHaveBeenCalledTimes(2);
  });
  // The invariant is per LEARNER, not per payment. Two unstamped payments for one student
  // are read from the same snapshot, so both look eligible; without grouping the learner
  // gets two "your account is ready" emails with contradictory expiry dates.
  it('sends one welcome and one ordinary notice for two payments of the same learner', async () => {
    const setupState = { account_origin: 'admissions', password_set_at: null, setup_email_sent_at: null };
    const shared = { email: 'ada@example.com', full_name: 'Ada', ...setupState };
    const { db } = makeDb({
      'pay-1': payment('pay-1', { student_id: 'student-1', students: { ...shared } }),
      'pay-2': payment('pay-2', { student_id: 'student-1', students: { ...shared }, is_activating: false }),
    });

    const result = await notifySubscriptionActivatedBatch(db, { paymentIds: ['pay-1', 'pay-2'] });

    // Exactly one welcome...
    const welcomes = send.mock.calls.filter(c => c[0].subject === 'Your Test account is ready');
    expect(welcomes).toHaveLength(1);
    // ...and the other payment is not dropped, it takes the ordinary notice.
    const batched = batchSend.mock.calls.at(-1)?.[0] ?? [];
    expect(batched).toHaveLength(1);
    expect(batched[0].subject).toContain('has been extended');
    expect(result.sent).toBe(2);
  });

  it('still delivers the second notice when the welcome fails', async () => {
    const setupState = { account_origin: 'admissions', password_set_at: null, setup_email_sent_at: null };
    const shared = { email: 'ada@example.com', full_name: 'Ada', ...setupState };
    const { db } = makeDb({
      'pay-1': payment('pay-1', { student_id: 'student-1', students: { ...shared } }),
      'pay-2': payment('pay-2', { student_id: 'student-1', students: { ...shared } }),
    });
    send.mockResolvedValueOnce({ error: { message: 'Invalid recipient' } });

    const result = await notifySubscriptionActivatedBatch(db, { paymentIds: ['pay-1', 'pay-2'] });

    // The welcome failed and stays unstamped for the sweep, but the learner's other payment
    // is still announced rather than being held hostage by it.
    expect(result.failed).toBe(1);
    expect(batchSend).toHaveBeenCalledTimes(1);
  });
});
