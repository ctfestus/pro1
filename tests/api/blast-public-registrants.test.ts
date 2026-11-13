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
      const filters: [string, any][] = [];
      const rows = () => (state.tables[table] ?? []).filter(r => filters.every(([k, v]) => !(k in r) || r[k] === v));
      const chain: any = {
        select: () => chain, eq: (k: string, v: any) => { filters.push([k, v]); return chain; }, order: () => chain, in: () => chain, range: () => chain, upsert: () => chain,
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
    events: [{ id: 'ev1', user_id: 'owner', cohort_ids: ['c1'], meeting_link: 'https://zoom.test/secret', status: 'published', public_registration: true }],
    event_registrations: [{ event_id: 'ev1', student_id: 's1', responses: {}, student: { full_name: 'Kofi Cohort', email: 'kofi@example.test' } }],
    event_public_registrations: [
      { id: 'r1', event_id: 'ev1', name: 'Ama Public', email: 'ama@example.test', join_token: 'tok1', responses: {} },
      { id: 'r2', event_id: 'ev1', name: 'Kofi Again', email: 'KOFI@example.test', join_token: 'tok2', responses: {} },
      { id: 'r3', event_id: 'other', name: 'Other Event', email: 'other@example.test', join_token: 'tok3', responses: {} },
    ],
    blast_quotas: [],
  };
});

describe('event blast recipients', () => {
  it('sends to cohort members and public registrants, once per address', async () => {
    expect(await (await blast()).json()).toMatchObject({ success: true, count: 2 });
    const payloads = batchSend.mock.calls.flatMap(c => c[0]);
    expect(payloads.map(p => p.to).sort()).toEqual(['ama@example.test', 'kofi@example.test']);
    // The address registered both ways is written to as the cohort member.
    expect(payloads.find(p => p.to === 'kofi@example.test').html).toContain('Hi Kofi Cohort');
  });

  it("gives a public registrant their tracked join link, never the meeting link", async () => {
    await blast();
    const ama = batchSend.mock.calls.flatMap(c => c[0]).find(p => p.to === 'ama@example.test');
    expect(ama.html).toContain('Hi Ama Public');
    expect(ama.html).toContain('https://app.test/api/join?token=tok1');
    expect(ama.html).not.toContain('zoom.test/secret');
  });

  it('reaches public registrants of an event with no cohort', async () => {
    state.tables.events = [{ id: 'ev1', user_id: 'owner', cohort_ids: [], meeting_link: null, status: 'published', public_registration: true }];
    expect(await (await blast()).json()).toMatchObject({ success: true, count: 2 });
    const ama = batchSend.mock.calls.flatMap(c => c[0]).find(p => p.to === 'ama@example.test');
    expect(ama.html).not.toContain('/api/join');
    // The request names a meeting link, but the event stores none: it is not used.
    expect(ama.html).not.toContain('zoom.test/secret');
  });

  it('still writes to registrants of a closed event, without a join link that would be refused', async () => {
    state.tables.events = [{ ...state.tables.events[0], public_registration: false }];
    await blast('<p>Hi {{name}}</p><p><a class="email-button" href="{{meeting_link}}">Join the session</a></p>');
    const ama = batchSend.mock.calls.flatMap(c => c[0]).find(p => p.to === 'ama@example.test');
    expect(ama.html).toContain('Hi Ama Public');
    expect(ama.html).not.toContain('/api/join');
    expect(ama.html).not.toContain('zoom.test/secret');
    expect(ama.html).toContain('Join the session');
    expect(ama.html).not.toMatch(/<a [^>]*>Join the session/);
  });

  it('sends an editor body as email HTML, with a join button per registrant', async () => {
    await blast('<p>Hi {{name}}</p><p><a class="email-button" href="{{meeting_link}}">Join the session</a></p>');
    const ama = batchSend.mock.calls.flatMap(c => c[0]).find(p => p.to === 'ama@example.test');
    expect(ama.html).toContain('<p>Hi Ama Public</p>');
    expect(ama.html).toMatch(/<td style="border-radius:8px;background-color:#[0-9a-f]{6};"><a href="https:\/\/app\.test\/api\/join\?token=tok1"/);
    expect(ama.html).not.toContain('zoom.test/secret');
  });

  it('escapes the title and drops a link that is not a web link', async () => {
    const res = await POST(new NextRequest('http://localhost/api/email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer t' },
      body: JSON.stringify({ type: 'blast', data: { formId: 'ev1', subject: 'S', body: '<image src="https://tracker.test/p.gif"><p>Hi</p>', formTitle: 'Data & AI <Bootcamp>', formUrl: 'https://x.test/"><b>x', bannerUrl: 'javascript:1' } }),
    }));
    expect(await res.json()).toMatchObject({ success: true });
    const html = batchSend.mock.calls.flatMap(c => c[0])[0].html;
    expect(html).toContain('Data &amp; AI &lt;Bootcamp&gt;');
    expect(html).not.toContain('tracker.test');
    expect(html).not.toContain('<b>x');
    expect(html).not.toContain('javascript:');
  });
});
