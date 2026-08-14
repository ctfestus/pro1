import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const requireRole = vi.hoisted(() => vi.fn());
const createClient = vi.hoisted(() => vi.fn());
const createAdmissionRecord = vi.hoisted(() => vi.fn());
const activateEnrollment = vi.hoisted(() => vi.fn());

vi.mock('@/lib/api-auth', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/api-auth')>()),
  requireRole,
}));
vi.mock('@supabase/supabase-js', () => ({ createClient }));
vi.mock('@/lib/provision-individual-student', () => ({ provisionIndividualStudent: vi.fn() }));
vi.mock('@/lib/db-payments', () => ({ createAdmissionRecord, activateEnrollment }));

import { POST } from '@/app/api/admissions/route';

function assignTo(cohortId: string) {
  return new NextRequest('http://localhost/api/admissions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer token' },
    body: JSON.stringify({ action: 'assign-student', studentId: 'student-1', cohortId }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://supabase.test';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key';
  requireRole.mockResolvedValue({ user: { id: 'admin-1' }, role: 'admin' });
});

// Migration 167 detached the enrollment on removal by nulling student_id, so re-adding a
// released student to a different cohort found nothing and wrote a second full-fee
// enrollment. Migration 171 keeps the link and flags released_at instead. These pin the
// reattach path, because the failure mode is silent: the student is simply billed twice.
describe('re-adding a released bootcamp student', () => {
  function stub(releasedAt: string | null, enrollmentCohort: string) {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: null });
    const calls: Array<{ table: string; method: string; args: unknown[] }> = [];
    const results: Record<string, Array<{ data: unknown; error: unknown }>> = {
      students: [
        { data: { email: 'student@example.com' }, error: null },
        { data: null, error: null },
      ],
      bootcamp_enrollments: [
        { data: { id: 'enrollment-1', cohort_id: enrollmentCohort, released_at: releasedAt }, error: null },
        { data: null, error: null },
      ],
    };
    const cursors: Record<string, number> = {};
    function builder(table: string) {
      const chain: any = new Proxy({}, {
        get(_target, prop) {
          if (prop === 'then') {
            const index = cursors[table] ?? 0;
            cursors[table] = index + 1;
            const result = results[table]?.[index];
            if (!result) throw new Error(`Unexpected awaited query ${table} #${index + 1}`);
            return Promise.resolve(result).then.bind(Promise.resolve(result));
          }
          return (...args: unknown[]) => {
            calls.push({ table, method: String(prop), args });
            return chain;
          };
        },
      });
      return chain;
    }
    createClient.mockReturnValue({
      from: (table: string) => builder(table),
      rpc,
    });
    return { rpc, calls };
  }

  it('reattaches the existing enrollment instead of creating a second one', async () => {
    const { rpc, calls } = stub('2026-07-01T00:00:00Z', 'cohort-old');

    const response = await POST(assignTo('cohort-new'));

    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith('reattach_released_enrollment', { p_enrollment_id: 'enrollment-1' });
    expect(rpc).toHaveBeenCalledWith('claim_student_enrollment_model', {
      p_student_id: 'student-1',
      p_requested_model: 'bootcamp',
    });
    expect(calls).toContainEqual({
      table: 'bootcamp_enrollments', method: 'select', args: ['id, cohort_id, released_at'],
    });
    expect(createAdmissionRecord).not.toHaveBeenCalled();
    expect(activateEnrollment).not.toHaveBeenCalled();
    expect(calls.some(call => call.table === 'bootcamp_enrollments' && call.method === 'insert')).toBe(false);
  });

  it('reattaches even when the student returns to the same cohort', async () => {
    const { rpc } = stub('2026-07-01T00:00:00Z', 'cohort-same');

    const response = await POST(assignTo('cohort-same'));

    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith('reattach_released_enrollment', { p_enrollment_id: 'enrollment-1' });
  });

  it('leaves an active enrollment alone', async () => {
    const { rpc } = stub(null, 'cohort-old');

    const response = await POST(assignTo('cohort-new'));

    expect(response.status).toBe(200);
    expect(rpc).not.toHaveBeenCalledWith('reattach_released_enrollment', expect.anything());
  });
});
