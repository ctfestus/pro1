import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { makeSupabaseStub } from '../helpers/supabaseStub';

const requireStudentUser = vi.hoisted(() => vi.fn());
const adminClient = vi.hoisted(() => vi.fn());

vi.mock('@/lib/api-auth', () => ({
  requireStudentUser,
  isAuthError: (value: any) => Boolean(value?.error),
}));
vi.mock('@/lib/admin-client', () => ({ adminClient }));

import { GET } from '@/app/api/promotions/route';
import { safePromoUrl, parseClosedPromos } from '@/lib/promotions';

const PROMO = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', title: 'Bootcamp', body: null, image_url: null, cta_label: null, cta_url: null, updated_at: '2026-10-01T00:00:00Z' };
const ID_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

function request(query: string, bearer = false) {
  return new NextRequest(`http://localhost/api/promotions?${query}`, {
    headers: bearer ? { authorization: 'Bearer token' } : undefined,
  });
}

function dbWith(cohortId: string | null) {
  const calls: Record<string, any>[] = [];
  const db = makeSupabaseStub(
    { students: { data: cohortId ? { cohort_id: cohortId } : null, error: null } },
    (fn, args) => {
      expect(fn).toBe('get_active_promotion');
      calls.push(args);
      return { data: [PROMO], error: null };
    },
  );
  return { db, calls };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GET /api/promotions', () => {
  it('rejects an unknown placement', async () => {
    const res = await GET(request('placement=sidebar'));
    expect(res.status).toBe(400);
  });

  it('serves a signed-out visitor the everyone audience, passing closed promos with their times', async () => {
    const { db, calls } = dbWith(null);
    adminClient.mockReturnValue(db);

    const res = await GET(request(`placement=landing&closed=${ID_B}:1790000000,not-a-uuid:5`));

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ promotion: PROMO });
    expect(requireStudentUser).not.toHaveBeenCalled();
    expect(calls).toEqual([{
      p_placement: 'landing', p_cohort_id: null,
      p_closed_ids: [ID_B], p_closed_at: [new Date(1790000000 * 1000).toISOString()],
    }]);
  });

  it('targets the resolved user, which is the Student Mode student when one is active', async () => {
    const { db, calls } = dbWith('cohort-of-student');
    adminClient.mockReturnValue(makeSupabaseStub({}));
    requireStudentUser.mockResolvedValue({ user: { id: 'student-1' }, serviceDb: db, isStudentMode: true });

    const res = await GET(request('placement=student', true));

    expect(res.status).toBe(200);
    expect(calls[0]).toMatchObject({ p_placement: 'student', p_cohort_id: 'cohort-of-student' });
  });

  it('falls back to the signed-out audience when the token is rejected', async () => {
    const { db, calls } = dbWith(null);
    adminClient.mockReturnValue(db);
    requireStudentUser.mockResolvedValue({ error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) });

    const res = await GET(request('placement=course', true));

    expect(res.status).toBe(200);
    expect(calls[0]).toMatchObject({ p_cohort_id: null });
  });

  it('returns no promotion, not an error, when the lookup fails', async () => {
    adminClient.mockReturnValue(makeSupabaseStub({}, () => ({ data: null, error: { message: 'function does not exist' } })));
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const res = await GET(request('placement=landing'));

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ promotion: null });
    spy.mockRestore();
  });
});

describe('safePromoUrl', () => {
  it.each([
    ['/pricing', '/pricing'],
    ['/courses?x=1#top', '/courses?x=1#top'],
    ['https://example.com/a', 'https://example.com/a'],
  ])('keeps %s', (input, expected) => {
    expect(safePromoUrl(input)).toBe(expected);
  });

  it.each([
    'http://example.com/a.png',
    '//evil.example',
    '/\\evil.example',
    '/\t/evil.example',
    'javascript:alert(1)',
    'data:image/png;base64,AAAA',
    'pricing',
    '',
  ])('rejects %j', (input) => {
    expect(safePromoUrl(input)).toBeNull();
  });
});

describe('parseClosedPromos', () => {
  it('keeps unique well-formed ids and caps the list', () => {
    const many = Array.from({ length: 60 }, (_, i) => `aaaaaaaa-aaaa-4aaa-8aaa-${String(i).padStart(12, '0')}:100`);
    expect(parseClosedPromos([...many, many[0], 'x'].join(',')).ids).toHaveLength(50);
    expect(parseClosedPromos(null)).toEqual({ ids: [], closedAt: [] });
  });

  it('keeps an id whose time is missing or unusable, with no time', () => {
    const huge = '9'.repeat(15);
    expect(parseClosedPromos(`${ID_B},${PROMO.id}:${huge}`)).toEqual({
      ids: [ID_B, PROMO.id],
      closedAt: [null, null],
    });
  });
});
