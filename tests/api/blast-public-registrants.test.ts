// Event blasts reach public registrants (migration 244) as well as cohort members: one email per
// address, and a public registrant's {{meeting_link}} is their own tracked join link.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const { batchSend } = vi.hoisted(() => ({ batchSend: vi.fn((_p: any[]) => Promise.resolve({ data: null, error: null })) }));
vi.mock('resend', () => ({ Resend: class { batch = { send: batchSend }; emails = { send: vi.fn() }; } }));
vi.mock('@/lib/vector', () => ({ getVectorIndex: vi.fn(), buildCourseEmbedText: vi.fn() }));
vi.mock('@/lib/email-template-service', () => ({ applyEmailTemplate: async (o: any) => ({ subject: o.fallbackSubject, html: o.fallbackHtml }) }));
vi.mock('@/lib/get-tenant-settings', () => ({
  getTenantSettings: vi.fn().mockResolvedValue({ appName: 'App', appUrl: 'https://app.test', senderName: 'Team', supportEmail: 'team@app.test', logoUrl: '', emailBannerUrl: '', teamName: 'Team' }),
}));
vi.mock('@/lib/api-auth', () => ({
  requireUser: vi.fn().mockResolvedValue({ user: { id: 'owner' } }),
  requireRole: vi.fn().mockResolvedValue({ user: { id: 'owner' } }),
  isAuthError: (a: any) => !!a?.error,
}));
vi.mock('@/lib/cohort-roster', () => ({
  studentsStillInCohorts: vi.fn(async (_db: any, ids: string[]) => new Set(ids)),
}));

const state = vi.hoisted(() => ({ tables: {} as Record<string, any[]> }));
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from(table: string) {
      const rows = () => state.tables[table] ?? [];
      const chain: any = {
        select: () => chain, eq: () => chain, order: () => chain, in: () => chain, range: () => chain, upsert: () => chain,
        maybeSingle: () => Promise.resolve({ data: rows()[0] ?? null, error: null }),
        then: (ok: any, bad: any) => Promise.resolve({ data: rows(), count: rows().length, error: null }).then(ok, bad),
      };
      return chain;
    },
  }),
}));

import { POST } from '@/app/api/email/route';

const blast = (body = 'Hi {{name}}, join here: {{meeting_link}}') => POST(new NextRequest('http://localhost/api/email', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: 'Bearer t' },
  body: JSON.stringify({ type: 'blast', data: { formId: 'ev1', subject: 'Update', body, formTitle: 'Open Night', formUrl: 'https://app.test/events/open-night', meetingLink: 'https://zoom.test/secret' } }),
}));

beforeEach(() => {
  vi.stubEnv('RESEND_API_KEY', 'k');
  batchSend.mockClear();
  state.tables = {
    events: [{ id: 'ev1', cohort_ids: ['c1'], meeting_link: 'https://zoom.test/secret' }],
    event_registrations: [{ student_id: 's1', responses: {}, student: { full_name: 'Kofi Cohort', email: 'kofi@example.test' } }],
    event_public_registrations: [
      { id: 'r1', name: 'Ama Public', email: 'ama@example.test', join_token: 'tok1', responses: {} },
      { id: 'r2', name: 'Kofi Again', email: 'KOFI@example.test', join_token: 'tok2', responses: {} },
    ],
    blast_quotas: [],
  };
});

describe('event blast recipients', () => {
  it('sends to cohort members and public registrants, once per address', async () => {
    expect(await (await blast()).json()).toMatchObject({ success: true, count: 2 });
    const payloads = batchSend.mock.calls.flatMap(c => c[0]);
    expect(payloads.map(p => p.to).sort()).toEqual(['ama@example.test', 'kofi@example.test']);
  });

  it("gives a public registrant their tracked join link, never the meeting link", async () => {
    await blast();
    const ama = batchSend.mock.calls.flatMap(c => c[0]).find(p => p.to === 'ama@example.test');
    expect(ama.html).toContain('Hi Ama Public');
    expect(ama.html).toContain('https://app.test/api/join?token=tok1');
    expect(ama.html).not.toContain('zoom.test/secret');
  });

  it('reaches public registrants of an event with no cohort', async () => {
    state.tables.events = [{ id: 'ev1', cohort_ids: [], meeting_link: null }];
    expect(await (await blast()).json()).toMatchObject({ success: true, count: 2 });
    const ama = batchSend.mock.calls.flatMap(c => c[0]).find(p => p.to === 'ama@example.test');
    expect(ama.html).not.toContain('/api/join');
  });
});
