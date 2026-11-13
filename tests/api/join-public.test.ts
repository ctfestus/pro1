// A public registrant's join link (migration 244): admitted while the event is published and open
// to the public, with no cohort check, and closed the moment either stops being true.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const state = vi.hoisted(() => ({ event: null as any, updates: [] as any[] }));
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from(table: string) {
      const chain: any = {
        select: () => chain, eq: () => chain,
        update: (row: any) => { state.updates.push({ table, row }); return { eq: () => Promise.resolve({ error: null }) }; },
        maybeSingle: () => {
          if (table === 'event_registrations') return Promise.resolve({ data: null, error: null });
          if (table === 'event_public_registrations') return Promise.resolve({ data: { id: 'r1', event_id: 'ev1', first_joined_at: null }, error: null });
          if (table === 'events') return Promise.resolve({ data: state.event, error: null });
          return Promise.resolve({ data: null, error: null });
        },
      };
      return chain;
    },
  }),
}));

import { GET } from '@/app/api/join/route';

const today = new Date().toISOString().slice(0, 10);
const EVENT = { meeting_link: 'zoom.test/room', status: 'published', public_registration: true, event_date: today, recurrence: 'once', recurrence_end_date: null, recurrence_days: null, timezone: 'UTC' };
const join = () => GET(new NextRequest('http://localhost/api/join?token=publictoken123'));

beforeEach(() => { state.updates = []; });

describe('GET /api/join with a public registration token', () => {
  it('redirects to the meeting and stamps the first join on a session day', async () => {
    state.event = EVENT;
    const res = await join();
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toBe('https://zoom.test/room');
    expect(state.updates).toEqual([{ table: 'event_public_registrations', row: expect.objectContaining({ first_joined_at: expect.any(String), last_joined_at: expect.any(String) }) }]);
  });

  it.each([
    ['public registration turned off', { public_registration: false }],
    ['unpublished', { status: 'draft' }],
  ])('refuses once the event is %s', async (_label, extra) => {
    state.event = { ...EVENT, ...extra };
    const res = await join();
    expect(res.status).toBe(403);
    expect(state.updates).toHaveLength(0);
  });
});
