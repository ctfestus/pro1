// The cohort "classes end" date (migration 223) separates teaching from the grace period. It must
// sit inside the cohort's dates, checked against the dates the cohort will have after the edit --
// including when only the end date moves.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { makeSupabaseStub } from '../helpers/supabaseStub';
import { classesEndDateError } from '@/lib/cohort-dates';

const requireRole = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api-auth', () => ({ requireRole, isAuthError: (v: any) => !!v?.error }));

import { PATCH } from '@/app/api/cohorts/[id]/route';

const EXISTING = { id: 'co1', created_by: 'admin1', start_date: '2026-09-01', end_date: '2026-12-23', classes_end_date: '2026-11-23' };

function patch(body: Record<string, unknown>) {
  requireRole.mockResolvedValue({
    user: { id: 'admin1' }, role: 'admin',
    serviceDb: makeSupabaseStub({ cohorts: [{ data: EXISTING, error: null }, { data: { ...EXISTING, ...body }, error: null }] }),
  });
  return PATCH(
    new NextRequest('http://localhost/api/cohorts/co1', { method: 'PATCH', body: JSON.stringify(body) }),
    { params: Promise.resolve({ id: 'co1' }) },
  );
}

beforeEach(() => vi.clearAllMocks());

describe('classesEndDateError', () => {
  it('accepts a blank date or one inside the cohort', () => {
    expect(classesEndDateError('2026-09-01', '', '2026-12-23')).toBeNull();
    expect(classesEndDateError('2026-09-01', '2026-11-23', '2026-12-23')).toBeNull();
    expect(classesEndDateError('2026-09-01', '2026-12-23', '2026-12-23')).toBeNull();
    expect(classesEndDateError('2026-09-01', '2026-11-23', null)).toBeNull();
  });

  it('rejects a date before the start or after the end', () => {
    expect(classesEndDateError('2026-09-01', '2026-08-31', '2026-12-23')).toMatch(/before the cohort starts/);
    expect(classesEndDateError('2026-09-01', '2026-12-24', '2026-12-23')).toMatch(/on or before the cohort end date/);
  });
});

describe('PATCH /api/cohorts/[id] classes_end_date', () => {
  it('saves a valid classes end date', async () => {
    const res = await patch({ classes_end_date: '2026-11-30' });
    expect(res.status).toBe(200);
    expect((await res.json()).cohort.classes_end_date).toBe('2026-11-30');
  });

  it('refuses a classes end date after the cohort end date', async () => {
    const res = await patch({ classes_end_date: '2027-01-10' });
    expect(res.status).toBe(400);
  });

  it('refuses moving the end date before the existing classes end date', async () => {
    const res = await patch({ end_date: '2026-11-01' });
    expect(res.status).toBe(400);
  });

  it('allows clearing the classes end date', async () => {
    const res = await patch({ classes_end_date: null });
    expect(res.status).toBe(200);
  });
});
