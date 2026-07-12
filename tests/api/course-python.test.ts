import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextResponse } from 'next/server';
import { createHmac } from 'crypto';

vi.mock('@/lib/api-auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api-auth')>();
  const requireUser = vi.fn();
  // The course route resolves the learner via requireStudentUser. With no Student Mode
  // header it behaves exactly like requireUser, so both share one stub in these tests.
  return { ...actual, requireUser, requireStudentUser: requireUser };
});

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(),
}));

import { requireUser } from '@/lib/api-auth';
import { createClient } from '@supabase/supabase-js';
import { POST } from '@/app/api/course/route';
import { makeSupabaseStub } from '../helpers/supabaseStub';

const mockRequireUser = vi.mocked(requireUser);
const mockCreateClient = vi.mocked(createClient);

async function post(body: Record<string, unknown>): Promise<Response> {
  const res = await POST(new Request('http://localhost/api/course', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test-token' },
    body: JSON.stringify(body),
  }) as any);
  if (!res) throw new Error('Course route returned no response');
  return res as unknown as Response;
}

function authed(supabase: any) {
  mockRequireUser.mockResolvedValue({
    user: { id: 'student1', email: 'student@example.com' },
    supabase,
    token: 'test-token',
  } as any);
  mockCreateClient.mockReturnValue(supabase);
}

function signSqlProof(query: string, courseId = 'course1', studentId = 'student1', questionId = 'sql1'): string {
  const payload = JSON.stringify({
    v: 1,
    courseId,
    studentId,
    questionId,
    query: String(query ?? '').replace(/\s+/g, ' ').trim(),
  });
  return `v1:${createHmac('sha256', process.env.SUPABASE_SERVICE_ROLE_KEY || '').update(payload).digest('hex')}`;
}

const pythonQuestion = {
  id: 'py1',
  type: 'python_exercise',
  pythonExpectedOutput: '42',
  pythonSolution: 'print(42)',
};

const sqlQuestion = {
  id: 'sql1',
  type: 'sql_exercise',
  sqlExpectedResult: { columns: ['n'], rows: [[1]] },
};

beforeEach(() => {
  mockRequireUser.mockReset();
  mockCreateClient.mockReset();
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';
});

describe('POST /api/course Python exercise security', () => {
  it('does not accept forged SQL passed answers without a server proof', async () => {
    authed(makeSupabaseStub({
      courses: {
        data: { questions: [sqlQuestion], passmark: 50, points_enabled: false, points_base: 100 },
        error: null,
      },
      course_attempts: [
        { data: { id: 'attempt1', answers: {}, hints_used: [] }, error: null },
        { data: null, error: null },
      ],
      students: { data: { full_name: 'Student One' }, error: null },
    }));

    const res = await post({
      action: 'complete-attempt',
      course_id: 'course1',
      final_answers: {
        sql1: JSON.stringify({ passed: true, query: 'SELECT 1' }),
      },
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.passed).toBe(false);
    expect(body.score).toBe(0);
  });

  it('mints a SQL proof only after the browser result matches the hidden expected result', async () => {
    authed(makeSupabaseStub({
      courses: {
        data: {
          id: 'course1',
          user_id: 'owner1',
          status: 'published',
          cohort_ids: [],
          questions: [sqlQuestion],
        },
        error: null,
      },
      students: { data: { role: 'student', cohort_id: 'co1' }, error: null },
    }));

    const res = await post({
      action: 'check-sql-answer',
      course_id: 'course1',
      question_id: 'sql1',
      query: 'SELECT 1 AS n',
      result: { columns: ['n'], rows: [[1]] },
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.passed).toBe(true);
    expect(body.proof).toMatch(/^v1:/);
    expect(body.feedback).toMatchObject({
      passed: true,
      matchedRows: 0,
      totalRows: 0,
      message: 'Your result matches the expected output.',
    });
  });

  it('does not leak expected SQL cells or row counts in check-sql-answer feedback', async () => {
    authed(makeSupabaseStub({
      courses: {
        data: {
          id: 'course1',
          user_id: 'owner1',
          status: 'published',
          cohort_ids: [],
          questions: [{ ...sqlQuestion, sqlExpectedResult: { columns: ['secret'], rows: [['hidden-value'], ['second-row']] } }],
        },
        error: null,
      },
      students: { data: { role: 'student', cohort_id: 'co1' }, error: null },
    }));

    const res = await post({
      action: 'check-sql-answer',
      course_id: 'course1',
      question_id: 'sql1',
      query: 'SELECT 1 AS secret',
      result: { columns: ['secret'], rows: [[1]] },
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.passed).toBe(false);
    expect(body.proof).toBeUndefined();
    expect(body.feedback).toMatchObject({
      passed: false,
      matchedRows: 0,
      totalRows: 0,
    });
    expect(JSON.stringify(body.feedback)).not.toContain('hidden-value');
    expect(JSON.stringify(body.feedback)).not.toContain('second-row');
    expect(body.feedback.message).toMatch(/doesn't match/i);
  });

  it('records SQL solution viewing server-side before returning the solution', async () => {
    const updates: any[] = [];
    const supabase = {
      from(table: string) {
        const state: { op: 'select' | 'update'; payload?: unknown } = { op: 'select' };
        const result = () => {
          if (table === 'courses') return { data: { id: 'course1', user_id: 'owner1', status: 'published', cohort_ids: [], questions: [{ ...sqlQuestion, sqlSolution: 'SELECT 1 AS n' }] }, error: null };
          if (table === 'students') return { data: { role: 'student', cohort_id: 'co1' }, error: null };
          if (table === 'course_attempts' && state.op === 'select') return { data: { id: 'attempt1', answers: {} }, error: null };
          return { data: null, error: null };
        };
        const builder: any = {
          select: () => builder,
          eq: () => builder,
          is: () => builder,
          order: () => builder,
          limit: () => builder,
          single: async () => result(),
          maybeSingle: async () => result(),
          update: (payload: unknown) => {
            state.op = 'update';
            state.payload = payload;
            updates.push(payload);
            return builder;
          },
          insert: (payload: unknown) => {
            state.op = 'update';
            state.payload = payload;
            updates.push(payload);
            return builder;
          },
          then: (resolve: any, reject: any) => Promise.resolve(result()).then(resolve, reject),
        };
        return builder;
      },
    };
    authed(supabase);

    const res = await post({
      action: 'get-sql-solution',
      course_id: 'course1',
      question_id: 'sql1',
      attempts: 2,
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.solution).toBe('SELECT 1 AS n');
    expect(updates).toHaveLength(1);
    expect(updates[0]).toMatchObject({
      answers: {
        sql1: expect.any(String),
      },
    });
    expect(JSON.parse(updates[0].answers.sql1)).toMatchObject({
      passed: false,
      solutionViewed: true,
      attempts: 2,
    });
  });

  it('does not persist SQL progress as passed when server proof is missing', async () => {
    const inserts: any[] = [];
    const supabase = {
      from(table: string) {
        const state: { op: 'select' | 'insert'; payload?: unknown } = { op: 'select' };
        let courseAttemptSelects = 0;
        const result = () => {
          if (table === 'courses') return { data: { id: 'course1', questions: [sqlQuestion] }, error: null };
          if (table === 'course_attempts' && state.op === 'insert') return { data: null, error: null };
          if (table === 'course_attempts') {
            courseAttemptSelects += 1;
            if (courseAttemptSelects === 1) return { data: null, error: null }; // active attempt
            if (courseAttemptSelects === 2) return { data: null, error: null }; // completed pass
            return { data: null, error: null }; // last attempt
          }
          return { data: null, error: null };
        };
        const builder: any = {
          select: () => builder,
          eq: () => builder,
          is: () => builder,
          not: () => builder,
          order: () => builder,
          limit: () => builder,
          single: async () => result(),
          maybeSingle: async () => result(),
          insert: (payload: unknown) => {
            state.op = 'insert';
            state.payload = payload;
            inserts.push(payload);
            return builder;
          },
          then: (resolve: any, reject: any) => Promise.resolve(result()).then(resolve, reject),
        };
        return builder;
      },
    };
    authed(supabase);

    const res = await post({
      action: 'save-progress',
      course_id: 'course1',
      current_question_index: 1,
      answers: {
        sql1: JSON.stringify({ passed: true, query: 'SELECT 1 AS n' }),
      },
    });

    expect(res.status).toBe(200);
    expect(inserts).toHaveLength(1);
    const saved = JSON.parse(inserts[0].answers.sql1);
    expect(saved).toMatchObject({
      passed: false,
      verificationFailed: true,
      query: 'SELECT 1 AS n',
    });
    expect(saved.proof).toBeUndefined();
  });

  it('does not persist SQL progress as passed when server proof is invalid', async () => {
    const inserts: any[] = [];
    const supabase = {
      from(table: string) {
        const state: { op: 'select' | 'insert'; payload?: unknown } = { op: 'select' };
        let courseAttemptSelects = 0;
        const result = () => {
          if (table === 'courses') return { data: { id: 'course1', questions: [sqlQuestion] }, error: null };
          if (table === 'course_attempts' && state.op === 'insert') return { data: null, error: null };
          if (table === 'course_attempts') {
            courseAttemptSelects += 1;
            if (courseAttemptSelects === 1) return { data: null, error: null };
            if (courseAttemptSelects === 2) return { data: null, error: null };
            return { data: null, error: null };
          }
          return { data: null, error: null };
        };
        const builder: any = {
          select: () => builder,
          eq: () => builder,
          is: () => builder,
          not: () => builder,
          order: () => builder,
          limit: () => builder,
          single: async () => result(),
          maybeSingle: async () => result(),
          insert: (payload: unknown) => {
            state.op = 'insert';
            state.payload = payload;
            inserts.push(payload);
            return builder;
          },
          then: (resolve: any, reject: any) => Promise.resolve(result()).then(resolve, reject),
        };
        return builder;
      },
    };
    authed(supabase);

    const res = await post({
      action: 'save-progress',
      course_id: 'course1',
      current_question_index: 1,
      answers: {
        sql1: JSON.stringify({ passed: true, query: 'SELECT 1 AS n', proof: 'v1:fake-proof' }),
      },
    });

    expect(res.status).toBe(200);
    expect(inserts).toHaveLength(1);
    const saved = JSON.parse(inserts[0].answers.sql1);
    expect(saved).toMatchObject({
      passed: false,
      verificationFailed: true,
      query: 'SELECT 1 AS n',
      proof: 'v1:fake-proof',
    });
  });

  it('falls back to full course questions when computed question_types is unavailable', async () => {
    const inserts: any[] = [];
    let courseSelects = 0;
    const supabase = {
      from(table: string) {
        const state: { op: 'select' | 'insert'; payload?: unknown } = { op: 'select' };
        let courseAttemptSelects = 0;
        const result = () => {
          if (table === 'courses') {
            courseSelects += 1;
            if (courseSelects === 1) return { data: null, error: { code: '42703', message: 'column does not exist' } };
            return { data: { id: 'course1', questions: [sqlQuestion] }, error: null };
          }
          if (table === 'course_attempts' && state.op === 'insert') return { data: null, error: null };
          if (table === 'course_attempts') {
            courseAttemptSelects += 1;
            if (courseAttemptSelects === 1) return { data: null, error: null };
            if (courseAttemptSelects === 2) return { data: null, error: null };
            return { data: null, error: null };
          }
          return { data: null, error: null };
        };
        const builder: any = {
          select: () => builder,
          eq: () => builder,
          is: () => builder,
          not: () => builder,
          order: () => builder,
          limit: () => builder,
          single: async () => result(),
          maybeSingle: async () => result(),
          insert: (payload: unknown) => {
            state.op = 'insert';
            state.payload = payload;
            inserts.push(payload);
            return builder;
          },
          then: (resolve: any, reject: any) => Promise.resolve(result()).then(resolve, reject),
        };
        return builder;
      },
    };
    authed(supabase);

    const res = await post({
      action: 'save-progress',
      course_id: 'course1',
      current_question_index: 1,
      answers: {
        sql1: JSON.stringify({ passed: true, query: 'SELECT 1 AS n' }),
      },
    });

    expect(res.status).toBe(200);
    expect(courseSelects).toBe(2);
    expect(inserts).toHaveLength(1);
    const saved = JSON.parse(inserts[0].answers.sql1);
    expect(saved).toMatchObject({
      passed: false,
      verificationFailed: true,
    });
  });

  it('allows verified SQL progress to replace an old unverified passed answer', async () => {
    const updates: any[] = [];
    const proof = signSqlProof('SELECT 1 AS n');
    const supabase = {
      from(table: string) {
        const state: { op: 'select' | 'update'; payload?: unknown } = { op: 'select' };
        const result = () => {
          if (table === 'courses') return { data: { id: 'course1', questions: [sqlQuestion] }, error: null };
          if (table === 'course_attempts' && state.op === 'update') return { data: null, error: null };
          if (table === 'course_attempts') {
            return {
              data: {
                id: 'attempt1',
                current_question_index: 0,
                answers: {
                  sql1: JSON.stringify({ passed: true, query: 'SELECT 1 AS n' }),
                },
                hints_used: [],
                points: 0,
                streak: 0,
              },
              error: null,
            };
          }
          return { data: null, error: null };
        };
        const builder: any = {
          select: () => builder,
          eq: () => builder,
          is: () => builder,
          not: () => builder,
          order: () => builder,
          limit: () => builder,
          single: async () => result(),
          maybeSingle: async () => result(),
          update: (payload: unknown) => {
            state.op = 'update';
            state.payload = payload;
            updates.push(payload);
            return builder;
          },
          then: (resolve: any, reject: any) => Promise.resolve(result()).then(resolve, reject),
        };
        return builder;
      },
    };
    authed(supabase);

    const res = await post({
      action: 'save-progress',
      course_id: 'course1',
      current_question_index: 1,
      answers: {
        sql1: JSON.stringify({ passed: true, query: 'SELECT 1 AS n', proof }),
      },
    });

    expect(res.status).toBe(200);
    expect(updates).toHaveLength(1);
    const saved = JSON.parse(updates[0].answers.sql1);
    expect(saved).toMatchObject({
      passed: true,
      query: 'SELECT 1 AS n',
      proof,
    });
    expect(saved.verificationFailed).toBeUndefined();
  });

  it('does not accept forged Python passed answers without a server proof', async () => {
    authed(makeSupabaseStub({
      courses: {
        data: { questions: [pythonQuestion], passmark: 50, points_enabled: false, points_base: 100 },
        error: null,
      },
      course_attempts: [
        { data: { id: 'attempt1', answers: {}, hints_used: [] }, error: null },
        { data: null, error: null },
      ],
      students: { data: { full_name: 'Student One' }, error: null },
    }));

    const res = await post({
      action: 'complete-attempt',
      course_id: 'course1',
      final_answers: {
        py1: JSON.stringify({ passed: true, output: '42' }),
      },
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.passed).toBe(false);
    expect(body.score).toBe(0);
  });

  it('accepts Python answers only with a valid proof from the private check endpoint', async () => {
    authed(makeSupabaseStub({
      courses: {
        data: {
          id: 'course1',
          user_id: 'owner1',
          status: 'published',
          cohort_ids: [],
          questions: [pythonQuestion],
        },
        error: null,
      },
      students: { data: { role: 'student', cohort_id: 'co1' }, error: null },
      course_attempts: { data: { answers: {} }, error: null },
    }));

    const checkRes = await post({
      action: 'check-python-answer',
      course_id: 'course1',
      question_id: 'py1',
      output: '42',
    });
    expect(checkRes.status).toBe(200);
    const checkBody = await checkRes.json();
    expect(checkBody.passed).toBe(true);
    expect(checkBody.proof).toMatch(/^v1:/);

    authed(makeSupabaseStub({
      courses: {
        data: { questions: [pythonQuestion], passmark: 50, points_enabled: false, points_base: 100 },
        error: null,
      },
      course_attempts: [
        { data: { id: 'attempt1', answers: {}, hints_used: [] }, error: null },
        { data: null, error: null },
      ],
      students: { data: { full_name: 'Student One' }, error: null },
      certificates: { data: { id: 'cert1' }, error: null },
    }));

    const completeRes = await post({
      action: 'complete-attempt',
      course_id: 'course1',
      final_answers: {
        py1: JSON.stringify({ passed: true, output: '42', proof: checkBody.proof }),
      },
    });

    expect(completeRes.status).toBe(200);
    const completeBody = await completeRes.json();
    expect(completeBody.passed).toBe(true);
    expect(completeBody.score).toBe(100);
  });

  it('subtracts solution-view penalties during final server scoring', async () => {
    authed(makeSupabaseStub({
      courses: {
        data: {
          id: 'course1',
          user_id: 'owner1',
          status: 'published',
          cohort_ids: [],
          questions: [pythonQuestion],
        },
        error: null,
      },
      students: { data: { role: 'student', cohort_id: 'co1' }, error: null },
      course_attempts: { data: { answers: {} }, error: null },
    }));

    const checkRes = await post({
      action: 'check-python-answer',
      course_id: 'course1',
      question_id: 'py1',
      output: '42',
    });
    const checkBody = await checkRes.json();

    const secondQuestion = { ...pythonQuestion, id: 'py2' };
    authed(makeSupabaseStub({
      courses: {
        data: {
          questions: [pythonQuestion, secondQuestion],
          passmark: 50,
          points_enabled: true,
          points_base: 100,
        },
        error: null,
      },
      course_attempts: [
        {
          data: {
            id: 'attempt1',
            answers: {
              py2: JSON.stringify({ solutionViewed: true, passed: false, attempts: 0 }),
            },
            hints_used: [],
          },
          error: null,
        },
        { data: null, error: null },
      ],
      students: { data: { full_name: 'Student One' }, error: null },
      certificates: { data: { id: 'cert1' }, error: null },
    }));

    const completeRes = await post({
      action: 'complete-attempt',
      course_id: 'course1',
      final_answers: {
        py1: JSON.stringify({ passed: true, output: '42', proof: checkBody.proof }),
      },
    });

    expect(completeRes.status).toBe(200);
    const completeBody = await completeRes.json();
    expect(completeBody.score).toBe(50);
    expect(completeBody.points).toBe(70);
  });

  it('honors persisted time bonus settings when finalizing XP', async () => {
    authed(makeSupabaseStub({
      courses: {
        data: {
          id: 'course1',
          user_id: 'owner1',
          status: 'published',
          cohort_ids: [],
          questions: [pythonQuestion],
        },
        error: null,
      },
      students: { data: { role: 'student', cohort_id: 'co1' }, error: null },
      course_attempts: { data: { answers: {} }, error: null },
    }));

    const checkRes = await post({
      action: 'check-python-answer',
      course_id: 'course1',
      question_id: 'py1',
      output: '42',
    });
    const checkBody = await checkRes.json();

    authed(makeSupabaseStub({
      courses: {
        data: {
          questions: [pythonQuestion],
          passmark: 50,
          points_enabled: true,
          points_base: 100,
          points_system: {
            enabled: true,
            basePoints: 100,
            timeBonusEnabled: true,
            timeBonusSeconds: 10,
            timeBonusMultiplier: 1.5,
            streakEnabled: false,
            streakCount: 3,
            streakBonus: 0,
            hintPenalty: 20,
            solutionPenalty: 30,
            milestones: [],
          },
        },
        error: null,
      },
      course_attempts: [
        { data: { id: 'attempt1', answers: {}, hints_used: [] }, error: null },
        { data: null, error: null },
      ],
      students: { data: { full_name: 'Student One' }, error: null },
      certificates: { data: { id: 'cert1' }, error: null },
    }));

    const completeRes = await post({
      action: 'complete-attempt',
      course_id: 'course1',
      final_answers: {
        py1: JSON.stringify({
          passed: true,
          output: '42',
          proof: checkBody.proof,
          elapsedSeconds: 5,
          checkedAt: '2026-01-01T00:00:00.000Z',
        }),
      },
    });

    expect(completeRes.status).toBe(200);
    const completeBody = await completeRes.json();
    expect(completeBody.score).toBe(100);
    expect(completeBody.points).toBe(150);
  });

  it('does not reveal Python solutions to authenticated students without course access', async () => {
    authed(makeSupabaseStub({
      courses: {
        data: {
          id: 'course1',
          user_id: 'owner1',
          status: 'published',
          cohort_ids: ['co1'],
          questions: [pythonQuestion],
        },
        error: null,
      },
      students: { data: { role: 'student', cohort_id: 'co2' }, error: null },
    }));

    const res = await post({
      action: 'get-python-solution',
      course_id: 'course1',
      question_id: 'py1',
      attempts: 3,
    });

    expect(res.status).toBe(403);
  });

  it('reveals Python solutions without requiring failed attempts', async () => {
    authed(makeSupabaseStub({
      courses: {
        data: {
          id: 'course1',
          user_id: 'owner1',
          status: 'published',
          cohort_ids: [],
          questions: [pythonQuestion],
        },
        error: null,
      },
      students: { data: { role: 'student', cohort_id: 'co1' }, error: null },
      course_attempts: [
        { data: { id: 'attempt1', answers: {} }, error: null },
        { data: null, error: null },
      ],
    }));

    const res = await post({
      action: 'get-python-solution',
      course_id: 'course1',
      question_id: 'py1',
      attempts: 0,
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.solution).toBe('print(42)');
  });

  it('returns 401 for anonymous Python checks', async () => {
    mockRequireUser.mockResolvedValue({ error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) });
    const res = await post({
      action: 'check-python-answer',
      course_id: 'course1',
      question_id: 'py1',
      output: '42',
    });
    expect(res.status).toBe(401);
  });
});
