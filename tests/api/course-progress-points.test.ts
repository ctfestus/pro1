import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/api-auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api-auth')>();
  const requireUser = vi.fn();
  return { ...actual, requireUser, requireStudentUser: requireUser };
});

vi.mock('@supabase/supabase-js', () => ({ createClient: vi.fn() }));

import { requireUser } from '@/lib/api-auth';
import { createClient } from '@supabase/supabase-js';
import { POST } from '@/app/api/course/route';

const mockRequireUser = vi.mocked(requireUser);
const mockCreateClient = vi.mocked(createClient);

const question = (id: string) => ({ id, type: 'multiple_choice', options: ['A', 'B'], correctAnswer: 'A' });

const POINTS_SYSTEM = {
  enabled: true, basePoints: 50,
  timeBonusEnabled: false, timeBonusSeconds: 0, timeBonusMultiplier: 1,
  streakEnabled: false, streakCount: 0, streakBonus: 0,
  hintPenalty: 0, solutionPenalty: 0, milestones: [],
};

/**
 * Captures what save-progress writes, so the stored `points` can be asserted. The shared stub helper
 * cannot do this -- it discards call arguments.
 */
function capturingStub(questions: any[], existingAttempt: any) {
  const writes: any[] = [];
  const supabase = {
    from(table: string) {
      const state: { op: 'select' | 'insert' | 'update' } = { op: 'select' };
      const result = () => {
        if (table === 'courses') {
          return { data: { id: 'course1', user_id: 'owner1', status: 'published', cohort_ids: [], available_to_everyone: true, questions, points_system: POINTS_SYSTEM }, error: null };
        }
        if (table === 'students') return { data: { role: 'student', cohort_id: null }, error: null };
        if (table === 'linkedin_shares') return { data: [], error: null };
        if (table === 'course_attempts') return { data: existingAttempt, error: null };
        return { data: null, error: null };
      };
      const builder: any = {
        select: () => builder, eq: () => builder, is: () => builder, not: () => builder,
        order: () => builder, limit: () => builder, contains: () => builder,
        insert: (payload: unknown) => { state.op = 'insert'; writes.push({ table, payload }); return builder; },
        update: (payload: unknown) => { state.op = 'update'; writes.push({ table, payload }); return builder; },
        single: () => Promise.resolve(result()),
        maybeSingle: () => Promise.resolve(result()),
        then: (res: any, rej: any) => Promise.resolve(result()).then(res, rej),
      };
      return builder;
    },
  };
  return { supabase, writes };
}

async function post(body: Record<string, unknown>): Promise<Response> {
  const res = await POST(new Request('http://localhost/api/course', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test-token' },
    body: JSON.stringify(body),
  }) as any);
  return res as unknown as Response;
}

beforeEach(() => {
  mockRequireUser.mockReset();
  mockCreateClient.mockReset();
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';
});

// course_attempts.points feeds student_xp, and in-progress attempts count toward it again
// (migration 158). That is only safe because save-progress computes the total itself.
describe('POST /api/course save-progress: points are computed, not accepted', () => {
  it('ignores an inflated client points value and stores what the answers earn', async () => {
    const { supabase, writes } = capturingStub(
      [question('q1'), question('q2')],
      { id: 'attempt1', current_question_index: 0, answers: {}, hints_used: [], points: 0, streak: 0 },
    );
    mockRequireUser.mockResolvedValue({ user: { id: 'student1', email: 's@example.com' }, serviceDb: supabase, token: 't' } as any);
    mockCreateClient.mockReturnValue(supabase as any);

    const res = await post({
      action: 'save-progress',
      course_id: 'course1',
      current_question_index: 1,
      answers: { q1: 'A' },      // one correct answer -> 50 points
      points: 999999,            // and a wildly inflated claim
    });

    expect(res.status).toBe(200);
    const update = writes.find(w => w.table === 'course_attempts');
    expect(update).toBeDefined();
    expect(update.payload.points).toBe(50);
  });

  it('awards nothing for a wrong answer, however much the client claims', async () => {
    const { supabase, writes } = capturingStub(
      [question('q1')],
      { id: 'attempt1', current_question_index: 0, answers: {}, hints_used: [], points: 0, streak: 0 },
    );
    mockRequireUser.mockResolvedValue({ user: { id: 'student1', email: 's@example.com' }, serviceDb: supabase, token: 't' } as any);
    mockCreateClient.mockReturnValue(supabase as any);

    await post({
      action: 'save-progress',
      course_id: 'course1',
      answers: { q1: 'B' },      // wrong
      points: 5000,
    });

    const update = writes.find(w => w.table === 'course_attempts');
    expect(update.payload.points).toBe(0);
  });

  // Previously the stored value was max(existing, incoming), so an inflated number could never be
  // walked back. A recomputed total can go down as well as up.
  it('does not preserve a previously inflated total', async () => {
    const { supabase, writes } = capturingStub(
      [question('q1')],
      { id: 'attempt1', current_question_index: 0, answers: {}, hints_used: [], points: 999999, streak: 0 },
    );
    mockRequireUser.mockResolvedValue({ user: { id: 'student1', email: 's@example.com' }, serviceDb: supabase, token: 't' } as any);
    mockCreateClient.mockReturnValue(supabase as any);

    await post({ action: 'save-progress', course_id: 'course1', answers: { q1: 'A' }, points: 999999 });

    const update = writes.find(w => w.table === 'course_attempts');
    expect(update.payload.points).toBe(50);
  });
});
