import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const send = vi.hoisted(() => vi.fn());

vi.mock('resend', () => ({ Resend: class { emails = { send }; batch = { send: vi.fn() }; } }));
vi.mock('@/lib/get-tenant-settings', () => ({
  getTenantSettings: async () => ({
    appName: 'Test', appUrl: 'https://test.example', senderName: 'Test',
    supportEmail: 'support@test.example', logoUrl: null, emailBannerUrl: null, teamName: 'Test',
  }),
}));

import { notifySubscriptionExpiring } from '@/lib/notify-subscription-expiring';

const PERIOD = '2026-11-10T00:00:00Z';

function makeDb(subscription: Record<string, any> | null) {
  const rpcCalls: Array<{ fn: string; args: any }> = [];
  const builder: any = {
    select: () => builder,
    eq: () => builder,
    async maybeSingle() { return { data: subscription, error: null }; },
  };
  return {
    db: {
      from: () => builder,
      rpc: async (fn: string, args: any) => { rpcCalls.push({ fn, args }); return { error: null }; },
    } as any,
    rpcCalls,
  };
}

function activeSubscription(overrides: Record<string, any> = {}) {
  return {
    id: 'sub-1', student_id: 'student-1', status: 'active',
    current_period_end: PERIOD, expiry_warning_for_period_end: null,
    subscription_plans: { name: 'Pro' },
    students: { email: 'ada@example.com', full_name: 'Ada' },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.RESEND_API_KEY = 'test-key';
  send.mockResolvedValue({ error: null });
});

describe('pre-expiry warning', () => {
  it('warns a learner whose access ends soon', async () => {
    const { db, rpcCalls } = makeDb(activeSubscription());

    await expect(notifySubscriptionExpiring(db, { subscriptionId: 'sub-1', periodEnd: PERIOD }))
      .resolves.toEqual({ sent: true });

    expect(send).toHaveBeenCalled();
    expect(rpcCalls.some(c => c.fn === 'mark_subscription_expiry_warned')).toBe(true);
  });

  it('does not warn twice for the same period', async () => {
    const { db } = makeDb(activeSubscription({ expiry_warning_for_period_end: PERIOD }));

    await expect(notifySubscriptionExpiring(db, { subscriptionId: 'sub-1', periodEnd: PERIOD }))
      .resolves.toEqual({ sent: false });
    expect(send).not.toHaveBeenCalled();
  });

  // The queue hands over the period it selected on. If the subscription renews in between,
  // warning now would announce an end date that may be months away.
  it('stands down when the subscription renewed after it was selected', async () => {
    const { db } = makeDb(activeSubscription({ current_period_end: '2027-02-10T00:00:00Z' }));

    await expect(notifySubscriptionExpiring(db, { subscriptionId: 'sub-1', periodEnd: PERIOD }))
      .resolves.toEqual({ sent: false });
    expect(send).not.toHaveBeenCalled();
  });

  it('settles a cancelled subscription rather than retrying it forever', async () => {
    const { db, rpcCalls } = makeDb(activeSubscription({ status: 'cancelled' }));

    await expect(notifySubscriptionExpiring(db, { subscriptionId: 'sub-1', periodEnd: PERIOD }))
      .resolves.toEqual({ sent: false });

    expect(send).not.toHaveBeenCalled();
    expect(rpcCalls.some(c => c.fn === 'mark_subscription_expiry_warned')).toBe(true);
  });
});

// The retry allowance is the part that went wrong once already: a lifetime counter barred a
// learner from every future warning after five failures, even once the address was fixed
// and the subscription renewed. These pin the period-scoped rules in the migration itself,
// since the behaviour lives in SQL rather than TypeScript.
describe('expiry warning retry allowance', () => {
  const migration = readFileSync(
    join(process.cwd(), 'migrations/180_expiry_warning_queue_and_welcome_claim.sql'),
    'utf8',
  );

  it('only lets attempts bar the period they were spent on', () => {
    expect(migration).toMatch(
      /s\.expiry_warning_attempted_for_period_end IS DISTINCT FROM s\.current_period_end\s*\n\s*OR s\.expiry_warning_attempts < p_max_attempts/,
    );
  });

  it('restarts the allowance when the failure is for a different period', () => {
    expect(migration).toMatch(
      /WHEN expiry_warning_attempted_for_period_end IS DISTINCT FROM p_period_end THEN 1\s*\n\s*ELSE expiry_warning_attempts \+ 1/,
    );
  });

  it('clears the failure state once a warning is delivered', () => {
    const warned = migration.slice(migration.indexOf('FUNCTION public.mark_subscription_expiry_warned'));
    expect(warned).toContain('expiry_warning_attempts = 0');
    expect(warned).toContain('expiry_warning_attempted_for_period_end = NULL');
    expect(warned).toContain('expiry_warning_last_error = NULL');
  });

  it('drops the old signatures before redefining them', () => {
    // The queue function gains a return column, which CREATE OR REPLACE cannot do, and the
    // failure recorder must not be left callable without a period.
    expect(migration.indexOf('DROP FUNCTION IF EXISTS public.list_subscriptions_needing_expiry_warning'))
      .toBeLessThan(migration.indexOf('CREATE FUNCTION public.list_subscriptions_needing_expiry_warning'));
    expect(migration.indexOf('DROP FUNCTION IF EXISTS public.record_expiry_warning_failure(uuid, text)'))
      .toBeLessThan(migration.indexOf('CREATE OR REPLACE FUNCTION public.record_expiry_warning_failure'));
  });

  it('is mirrored in the fresh schema', () => {
    const schema = readFileSync(join(process.cwd(), 'festman-fresh-schema.sql'), 'utf8');
    expect(schema).toContain('expiry_warning_attempted_for_period_end');
    expect(schema).toContain('RETURNS TABLE (id uuid, current_period_end timestamptz)');
  });
});
