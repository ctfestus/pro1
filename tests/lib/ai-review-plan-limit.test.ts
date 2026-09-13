import { describe, expect, it, vi } from 'vitest';
import { enforceStudentAiReviewPlanLimit, peekStarterReviewBudget } from '@/lib/ai-review-plan-limit';

function redisStub(count = 1) {
  return {
    incr: vi.fn(async (_key: string) => count),
    expire: vi.fn(async () => 1),
    del: vi.fn(async () => 1),
    ttl: vi.fn(async () => 86000),
  };
}

function dbStub(args: {
  student?: any;
  studentsById?: Record<string, any>;
  subscription?: any;
  studentError?: any;
  subscriptionError?: any;
}) {
  let tableName = '';
  let eqColumn = '';
  let eqValue = '';
  return {
    from(table: string) {
      tableName = table;
      return {
        select() { return this; },
        eq(column: string, value: string) { eqColumn = column; eqValue = value; return this; },
        maybeSingle: async () => {
          if (tableName === 'students') {
            const fallback = { role: 'student', cohort_id: null, enrollment_model: null };
            return {
              data: args.studentsById ? args.studentsById[eqValue] ?? null : args.student === undefined ? fallback : args.student,
              error: args.studentError ?? null,
            };
          }
          if (tableName === 'individual_subscriptions') {
            expect(eqColumn).toBe('student_id');
            return { data: args.subscription ?? null, error: args.subscriptionError ?? null };
          }
          return { data: null, error: null };
        },
      };
    },
  };
}

function authFor(db: any, ids = { userId: 'student-1', actorId: 'student-1' }) {
  return { user: { id: ids.userId }, actor: { id: ids.actorId }, serviceDb: db } as any;
}

const future = '2099-01-01T00:00:00Z';

describe('student AI review plan limiter', () => {
  it('uses one shared daily counter for free individual learners', async () => {
    const redis = redisStub(2);
    const res = await enforceStudentAiReviewPlanLimit(authFor(dbStub({})), redis as any);

    expect(res?.status).toBe(429);
    expect(redis.incr).toHaveBeenCalledWith('rate:student-ai-review:starter:student-1');
  });

  it('requires a paid plan for heavy reviewers on free individual learners', async () => {
    const redis = redisStub(1);
    const res = await enforceStudentAiReviewPlanLimit(authFor(dbStub({})), redis as any, {
      paidOnly: true,
    });

    expect(res?.status).toBe(402);
    expect(await res?.json()).toEqual({
      error: 'This AI reviewer requires an active paid plan. Upgrade to unlock it.',
      code: 'paid_plan_required',
      upgradeUrl: '/pricing',
    });
    expect(redis.incr).not.toHaveBeenCalled();
  });

  it('does not spend the shared counter for an active paid subscription', async () => {
    const redis = redisStub(1);
    const res = await enforceStudentAiReviewPlanLimit(authFor(dbStub({
      subscription: {
        status: 'active',
        current_period_end: future,
      },
    })), redis as any);

    expect(res).toBeNull();
    expect(redis.incr).not.toHaveBeenCalled();
  });

  it('keeps an active subscriber paid even when their plan is retired from sale', async () => {
    const redis = redisStub(1);
    const res = await enforceStudentAiReviewPlanLimit(authFor(dbStub({
      subscription: {
        status: 'active',
        current_period_end: future,
      },
    })), redis as any, { paidOnly: true });

    expect(res).toBeNull();
    expect(redis.incr).not.toHaveBeenCalled();
  });

  it('treats an authenticated caller with no students row as a free learner', async () => {
    const redis = redisStub(2);
    const res = await enforceStudentAiReviewPlanLimit(authFor(dbStub({ student: null })), redis as any);

    expect(res?.status).toBe(429);
    expect(redis.incr).toHaveBeenCalledWith('rate:student-ai-review:starter:student-1');
  });

  it('does not apply the subscription-tier cap to manually cohorted learners', async () => {
    const redis = redisStub(2);
    const res = await enforceStudentAiReviewPlanLimit(authFor(dbStub({
      student: { role: 'student', cohort_id: 'cohort-1', enrollment_model: null },
    })), redis as any);

    expect(res).toBeNull();
    expect(redis.incr).not.toHaveBeenCalled();
  });

  it('does not apply the subscription-tier cap to bootcamp learners', async () => {
    const redis = redisStub(2);
    const res = await enforceStudentAiReviewPlanLimit(authFor(dbStub({
      student: { role: 'student', cohort_id: null, enrollment_model: 'bootcamp' },
    })), redis as any);

    expect(res).toBeNull();
    expect(redis.incr).not.toHaveBeenCalled();
  });

  it('keeps bootcamp learners out even if a subscription row exists', async () => {
    const redis = redisStub(2);
    const res = await enforceStudentAiReviewPlanLimit(authFor(dbStub({
      student: { role: 'student', cohort_id: 'bootcamp-cohort', enrollment_model: 'bootcamp' },
      subscription: {
        status: 'active',
        current_period_end: future,
      },
    })), redis as any);

    expect(res).toBeNull();
    expect(redis.incr).not.toHaveBeenCalled();
  });

  it('uses the real actor role in Student Mode and does not spend the selected learner quota', async () => {
    const redis = redisStub(2);
    const res = await enforceStudentAiReviewPlanLimit(authFor(dbStub({
      studentsById: {
        'staff-1': { role: 'instructor', cohort_id: null, enrollment_model: null },
        'student-1': { role: 'student', cohort_id: null, enrollment_model: null },
      },
    }), { actorId: 'staff-1', userId: 'student-1' }), redis as any);

    expect(res).toBeNull();
    expect(redis.incr).not.toHaveBeenCalled();
  });

  it('does not apply the learner subscription cap to staff', async () => {
    const redis = redisStub(2);
    const res = await enforceStudentAiReviewPlanLimit(authFor(dbStub({
      student: { role: 'instructor', cohort_id: null, enrollment_model: null },
    })), redis as any);

    expect(res).toBeNull();
    expect(redis.incr).not.toHaveBeenCalled();
  });
});

describe('starter review budget peek', () => {
  function peekRedis(count: string | null, ttl: number) {
    return { get: vi.fn(async () => count), ttl: vi.fn(async () => ttl), incr: vi.fn() };
  }

  it('reports the remaining review without spending one', async () => {
    const redis = peekRedis(null, -2);
    const budget = await peekStarterReviewBudget({ actor: { id: 'student-1' } } as any, redis as any);

    expect(budget).toEqual({ limit: 1, remaining: 1, resetsInSeconds: null });
    // Asking how many are left must never be the thing that uses one up.
    expect(redis.incr).not.toHaveBeenCalled();
  });

  it('reports an exhausted allowance with the time until it rolls over', async () => {
    const budget = await peekStarterReviewBudget(
      { actor: { id: 'student-1' } } as any,
      peekRedis('1', 7200) as any,
    );

    expect(budget).toEqual({ limit: 1, remaining: 0, resetsInSeconds: 7200 });
  });

  it('reports no countdown for a key with no expiry', async () => {
    const budget = await peekStarterReviewBudget(
      { actor: { id: 'student-1' } } as any,
      peekRedis('1', -1) as any,
    );

    expect(budget.resetsInSeconds).toBeNull();
  });
});
