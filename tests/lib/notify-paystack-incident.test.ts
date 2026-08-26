import { beforeEach, describe, expect, it, vi } from 'vitest';

const { emailSend, getTenantSettings } = vi.hoisted(() => ({
  emailSend: vi.fn().mockResolvedValue({ data: null, error: null }),
  getTenantSettings: vi.fn().mockResolvedValue({
    appName: 'App', appUrl: 'https://app.test', senderName: 'Team', supportEmail: 'team@app.test',
  }),
}));
vi.mock('resend', () => ({ Resend: class { emails = { send: emailSend }; } }));
vi.mock('@/lib/get-tenant-settings', () => ({ getTenantSettings }));

import { notifyPaystackIncident } from '@/lib/notify-paystack-incident';

const INCIDENT = {
  id: 'incident-1', reference: 'sub-ref', provider_transaction_id: 42,
  kind: 'lifecycle_event', reason: 'paystack:refund.processed', event_name: 'refund.processed',
  amount: 50, currency: 'GHS', student_id: 'student-1', plan_id: 'plan-1',
  status: 'open', notification_attempts: 0, notification_sent_at: null,
};

function stubDb(incident = INCIDENT) {
  const updates: any[] = [];
  const chain = (result: any): any => new Proxy(function () {}, {
    get(_target, prop) {
      if (prop === 'then' || prop === 'catch' || prop === 'finally') {
        const promise = Promise.resolve(result);
        return (promise as any)[prop].bind(promise);
      }
      if (prop === 'update') return (payload: any) => {
        updates.push(payload);
        return chain({ data: null, error: null });
      };
      return () => chain(result);
    },
    apply: () => chain(result),
  });
  return {
    updates,
    db: { from: () => chain({ data: incident, error: null }) } as any,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.RESEND_API_KEY = 'test-key';
  getTenantSettings.mockResolvedValue({
    appName: 'App', appUrl: 'https://app.test', senderName: 'Team', supportEmail: 'team@app.test',
  });
});

describe('Paystack incident notification', () => {
  it('sends and stamps one open incident', async () => {
    const { db, updates } = stubDb();
    await expect(notifyPaystackIncident(db, 'incident-1')).resolves.toEqual({ sent: true });
    expect(emailSend).toHaveBeenCalledOnce();
    expect(updates).toEqual(expect.arrayContaining([
      expect.objectContaining({ notification_attempts: 1 }),
      expect.objectContaining({ notification_sent_at: expect.any(String), notification_error: null }),
    ]));
  });

  it('records missing mail configuration as a bounded attempt', async () => {
    delete process.env.RESEND_API_KEY;
    const { db, updates } = stubDb();
    await expect(notifyPaystackIncident(db, 'incident-1')).resolves.toEqual({ sent: false });
    expect(emailSend).not.toHaveBeenCalled();
    expect(updates).toContainEqual(expect.objectContaining({
      notification_attempts: 1,
      notification_error: 'RESEND_API_KEY is not configured',
    }));
  });

  it('does nothing for a resolved incident', async () => {
    const { db } = stubDb({ ...INCIDENT, status: 'resolved' });
    await expect(notifyPaystackIncident(db, 'incident-1')).resolves.toEqual({ sent: false });
    expect(emailSend).not.toHaveBeenCalled();
  });
});
