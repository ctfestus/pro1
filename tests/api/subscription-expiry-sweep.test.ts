import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const verifyQStashRequest = vi.hoisted(() => vi.fn());
const expireSubscription = vi.hoisted(() => vi.fn());
const adminClient = vi.hoisted(() => vi.fn());

vi.mock('@/lib/qstash', () => ({ verifyQStashRequest }));
vi.mock('@/lib/db-subscriptions', () => ({ expireSubscription }));
vi.mock('@/lib/admin-client', () => ({ adminClient }));

import { POST } from '@/app/api/cron/subscription-expiry-sweep/route';

function request() {
  return new NextRequest('http://localhost/api/cron/subscription-expiry-sweep', { method: 'POST' });
}

beforeEach(() => {
  vi.clearAllMocks();
  verifyQStashRequest.mockResolvedValue({ valid: true, body: '' });
});

describe('subscription expiry sweep', () => {
  it('rejects an invalid QStash request', async () => {
    verifyQStashRequest.mockResolvedValue({ valid: false, body: '' });
    const response = await POST(request());
    expect(response.status).toBe(401);
    expect(adminClient).not.toHaveBeenCalled();
  });

  it('continues after one subscription fails and reports all counts', async () => {
    const builder: any = {
      select: vi.fn(() => builder),
      eq: vi.fn(() => builder),
      lt: vi.fn().mockResolvedValue({ data: [{ id: 'sub-1' }, { id: 'sub-2' }, { id: 'sub-3' }], error: null }),
    };
    adminClient.mockReturnValue({ from: vi.fn(() => builder) });
    expireSubscription
      .mockResolvedValueOnce({ ok: true, skipped: false })
      .mockResolvedValueOnce({ ok: true, skipped: true })
      .mockRejectedValueOnce(new Error('temporary failure'));

    const response = await POST(request());
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ processed: 3, expired: 1, skipped: 1, failed: 1 });
    expect(expireSubscription).toHaveBeenCalledTimes(3);
  });
});
