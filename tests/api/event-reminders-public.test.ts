// Reminders for public registrants (migration 244): an event with no cohort still reminds the
// people who registered on its public page, with their own tracked join link, once each.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const { batchSend } = vi.hoisted(() => ({ batchSend: vi.fn((_p: any[]) => Promise.resolve({ data: null, error: null })) }));
vi.mock('resend', () => ({ Resend: class { batch = { send: batchSend }; } }));
vi.mock('@/lib/qstash', () => ({ verifyQStashRequest: vi.fn().mockResolvedValue({ valid: true }) }));
vi.mock('@/lib/email-template-service', () => ({ applyEmailTemplate: async (o: any) => ({ subject: o.fallbackSubject, html: o.fallbackHtml }) }));
vi.mock('@/lib/get-tenant-settings', () => ({
  getTenantSettings: vi.fn().mockResolvedValue({ appName: 'App', appUrl: 'https://app.test', senderName: 'Team', supportEmail: 'team@app.test', logoUrl: '', emailBannerUrl: '', teamName: 'Team' }),
}));

const state = vi.hoisted(() => ({ events: [] as any[], regs: [] as any[], claimed: new Set<string>() }));
vi.mock('@/lib/admin-client', () => ({
  adminClient: () => ({
    from(table: string) {
      let rows: any[] | null = null;
      const chain: any = {
        select: () => chain, eq: () => chain, order: () => chain, in: () => chain, range: () => chain,
        // email_dedup claim: only keys not claimed before come back.
        upsert: (claims: any[]) => {
          rows = claims.filter(c => !state.claimed.has(c.dedupe_key));
          rows.forEach(c => state.claimed.add(c.dedupe_key));
          return chain;
        },
        update: () => chain, delete: () => chain,
        then: (ok: any, bad: any) => {
          const data = rows ?? (table === 'events' ? state.events : table === 'event_public_registrations' ? state.regs : []);
          return Promise.resolve({ data, count: data.length, error: null }).then(ok, bad);
        },
      };
      return chain;
    },
  }),
}));

import { POST } from '@/app/api/cron/event-reminders/route';

const NOW = new Date('2026-06-01T12:00:00Z');
const EVENT = {
  id: 'ev1', title: 'Open Night', slug: 'open-night', event_date: '2026-06-02', event_time: '10:00', timezone: 'UTC',
  location: null, meeting_link: 'https://zoom.test/secret', event_type: 'virtual', recurrence: 'once',
  recurrence_end_date: null, recurrence_days: null, cohort_ids: [], public_registration: true,
};
const run = () => POST(new NextRequest('http://localhost/api/cron/event-reminders', { method: 'POST' }));

beforeEach(() => {
  vi.useFakeTimers({ now: NOW, toFake: ['Date'] });
  vi.stubEnv('RESEND_API_KEY', 'k');
  state.events = [EVENT];
  state.regs = [{ id: 'r1', name: 'Ama Mensah', email: 'ama@example.test', join_token: 'tok1' }];
  state.claimed = new Set();
  batchSend.mockClear();
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

describe('event reminders for public registrants', () => {
  it('reminds a registrant of a cohortless public event with their tracked link, never the meeting link', async () => {
    expect(await (await run()).json()).toMatchObject({ sent: 1 });
    const [payloads] = batchSend.mock.calls[0];
    expect(payloads).toHaveLength(1);
    expect(payloads[0].to).toBe('ama@example.test');
    expect(payloads[0].html).toContain('https://app.test/api/join?token=tok1');
    expect(payloads[0].html).not.toContain('zoom.test/secret');
    expect([...state.claimed]).toEqual(['ev1:2026-06-02:public:r1']);
  });

  it('sends each reminder once across runs', async () => {
    await run();
    expect(await (await run()).json()).toMatchObject({ sent: 0 });
    expect(batchSend).toHaveBeenCalledTimes(1);
  });

  it('sends nothing once public registration is turned off', async () => {
    state.events = [{ ...EVENT, public_registration: false }];
    expect(await (await run()).json()).toMatchObject({ sent: 0, sessions: 0 });
    expect(batchSend).not.toHaveBeenCalled();
  });
});
