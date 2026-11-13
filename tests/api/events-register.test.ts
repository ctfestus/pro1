// Public event registration (migration 244): anyone may register; the join link is only emailed.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('server-only', () => ({}));
const state = vi.hoisted(() => ({ tables: {} as Record<string, any>, after: [] as (() => unknown)[], rpc: [] as { fn: string; args: any }[], result: { status: 'registered', id: 'r1', join_token: 'tok' } as any }));
const mail = vi.hoisted(() => ({ send: vi.fn() }));

vi.mock('@/lib/admin-client', async () => {
  const { makeSupabaseStub } = await import('../helpers/supabaseStub');
  return { adminClient: () => makeSupabaseStub(state.tables, (fn, args) => { state.rpc.push({ fn, args }); return { data: state.result, error: null }; }) };
});
vi.mock('@/lib/books/guest-purchase', () => ({ emailHash: () => 'h', guestRateLimited: async () => false }));
vi.mock('@/lib/events/confirmation-email', () => ({ sendPublicRegistrationEmail: mail.send }));
const auth = vi.hoisted(() => ({ user: null as null | { id: string; email: string } }));
vi.mock('@/lib/api-auth', async () => {
  const { NextResponse } = await import('next/server');
  const { makeSupabaseStub } = await import('../helpers/supabaseStub');
  return {
    isAuthError: (r: any) => r?.error instanceof NextResponse,
    requireUser: async () => auth.user
      ? { actor: auth.user, user: auth.user, serviceDb: makeSupabaseStub({ students: { data: { id: auth.user.id } } }) }
      : { error: NextResponse.json({}, { status: 401 }) },
  };
});
vi.mock('next/server', async (orig) => ({ ...(await orig<typeof import('next/server')>()), after: (fn: () => unknown) => { state.after.push(fn); } }));

import { POST } from '@/app/api/events/register/route';

const EVENT_ID = '11111111-1111-4111-8111-111111111111';
const EVENT = {
  id: EVENT_ID, title: 'Data Meetup', slug: 'data-meetup', status: 'published', public_registration: true,
  event_date: '2999-01-01', event_time: '18:00', timezone: 'UTC', location: null, event_type: 'virtual',
  meeting_link: 'https://zoom.test/secret', recurrence: 'once', recurrence_end_date: null, recurrence_days: null,
  fields: [{ name: 'phone', label: 'Phone', type: 'phone', required: true }],
};
const register = (body: Record<string, unknown> = {}, headers: Record<string, string> = {}) =>
  POST(new NextRequest('http://localhost/api/events/register', { method: 'POST', headers, body: JSON.stringify({ eventId: EVENT_ID, name: ' Ama  Mensah ', email: 'Ama@Example.test', responses: { phone: '0200000000' }, ...body }) }));
const calls = () => state.rpc.filter(r => r.fn === 'register_event_publicly').map(r => r.args);

beforeEach(() => { auth.user = null; state.after = []; state.rpc = []; state.result = { status: 'registered', id: 'r1', join_token: 'tok' }; vi.clearAllMocks(); });

describe('POST /api/events/register', () => {
  it('registers through the locked database function and emails the join link, never returning it', async () => {
    state.tables = { events: { data: EVENT } };
    const res = await register();
    expect(res.status).toBe(200);
    expect(JSON.stringify(await res.json())).not.toMatch(/tok|zoom|join/i);
    expect(calls()).toEqual([{ p_event_id: EVENT_ID, p_name: 'Ama Mensah', p_email: 'ama@example.test', p_responses: { phone: '0200000000' }, p_student_id: null }]);
    for (const fn of state.after) await fn();
    expect(mail.send).toHaveBeenCalledWith(expect.objectContaining({ to: 'ama@example.test', joinToken: 'tok' }));
  });

  it('answers the same for an address already registered, and emails it again', async () => {
    state.tables = { events: { data: EVENT } };
    const first = await (await register()).json();
    state.result = { status: 'existing', id: 'r1', join_token: 'tok' };
    state.after = [];
    expect(await (await register()).json()).toEqual(first);
    for (const fn of state.after) await fn();
    expect(mail.send).toHaveBeenCalledTimes(1);
  });

  it('resends under the name first registered, not the one just typed', async () => {
    state.tables = { events: { data: EVENT } };
    state.result = { status: 'existing', id: 'r1', join_token: 'tok', name: 'Ama Mensah' };
    await register({ name: 'Someone Else' });
    for (const fn of state.after) await fn();
    expect(mail.send).toHaveBeenCalledWith(expect.objectContaining({ name: 'Ama Mensah', to: 'ama@example.test' }));
  });

  it('registers a signed-in visitor under their sign-in address and links the account', async () => {
    state.tables = { events: { data: EVENT } };
    auth.user = { id: 'stu1', email: 'Real@Account.test' };
    expect((await register({ email: 'typed@other.test' }, { Authorization: 'Bearer t' })).status).toBe(200);
    expect(calls()[0]).toMatchObject({ p_email: 'real@account.test', p_student_id: 'stu1' });
  });

  it('reports a full event and sends nothing', async () => {
    state.tables = { events: { data: EVENT } };
    state.result = { status: 'full' };
    expect((await register()).status).toBe(409);
    expect(state.after).toHaveLength(0);
  });

  it.each([
    ['a draft', { status: 'draft' }, 404],
    ['cohort only', { public_registration: false }, 404],
    ['over', { event_date: '2000-01-01' }, 409],
  ])('refuses an event that is %s, and registers nobody', async (_label, extra, code) => {
    state.tables = { events: { data: { ...EVENT, ...extra } } };
    expect((await register()).status).toBe(code);
    expect(calls()).toHaveLength(0);
  });

  it('needs a name, a valid email and the required answers', async () => {
    state.tables = { events: { data: EVENT } };
    expect((await register({ name: '  ' })).status).toBe(400);
    expect((await register({ email: 'nope' })).status).toBe(400);
    expect((await register({ responses: {} })).status).toBe(400);
    expect(calls()).toHaveLength(0);
  });
});
