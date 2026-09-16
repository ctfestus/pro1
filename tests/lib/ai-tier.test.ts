import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/admin-client', () => ({ adminClient: vi.fn() }));

import { aiTierFor } from '@/lib/ai-limits-server';

/**
 * Answers the two lookups aiTierFor makes, keyed by whichever id it asks for.
 *
 * Keyed rather than fixed, so a Student Mode test can prove which id was used: the staff actor and
 * the learner being previewed return different rows.
 */
function dbStub(args: {
  studentsById?: Record<string, any>;
  subscription?: any;
  studentError?: any;
  subscriptionError?: any;
}) {
  return {
    from(table: string) {
      let askedFor = '';
      const chain: any = {
        select: () => chain,
        eq: (_col: string, value: string) => { askedFor = value; return chain; },
        maybeSingle: async () => {
          if (table === 'students') {
            const byId = args.studentsById ?? { 'student-1': { role: 'student', cohort_id: null, enrollment_model: null } };
            return { data: byId[askedFor] ?? null, error: args.studentError ?? null };
          }
          return { data: args.subscription ?? null, error: args.subscriptionError ?? null };
        },
      };
      return chain;
    },
  };
}

const authFor = (db: any, actorId = 'student-1') =>
  ({ actor: { id: actorId }, serviceDb: db }) as any;

const future = '2099-01-01T00:00:00Z';
const past = '2020-01-01T00:00:00Z';

describe('which plan a caller is on', () => {
  it('puts a learner with no subscription on the free plan', async () => {
    expect(await aiTierFor(authFor(dbStub({})))).toBe('free');
  });

  it('puts an active subscriber on the paid plan', async () => {
    const tier = await aiTierFor(authFor(dbStub({
      subscription: { status: 'active', current_period_end: future },
    })));
    expect(tier).toBe('paid');
  });

  it('keeps an active subscriber paid even when their plan is retired from sale', async () => {
    // Plan status gates BUYING, not access. Someone mid-subscription on a withdrawn plan is still
    // paying, and their courses still open -- their AI should not quietly drop to the free column.
    const tier = await aiTierFor(authFor(dbStub({
      subscription: { status: 'active', current_period_end: future },
    })));
    expect(tier).toBe('paid');
  });

  it('drops a lapsed subscriber back to free', async () => {
    expect(await aiTierFor(authFor(dbStub({
      subscription: { status: 'active', current_period_end: past },
    })))).toBe('free');
    expect(await aiTierFor(authFor(dbStub({
      subscription: { status: 'expired', current_period_end: future },
    })))).toBe('free');
  });

  it('treats a caller with no students row as free rather than ungoverned', async () => {
    // Close to unreachable, since a trigger creates the row. The safe reading of "unknown" is the
    // tightest plan, not no plan at all.
    expect(await aiTierFor(authFor(dbStub({ studentsById: {} })))).toBe('free');
  });

  it('keeps staff out of the learner settings entirely', async () => {
    // Staff are still counted -- they were before any of this existed -- but against the shipped
    // numbers. An instructor should not lose the ability to preview their own course because they
    // closed a reviewer for students.
    expect(await aiTierFor(authFor(dbStub({
      studentsById: { 'student-1': { role: 'instructor', cohort_id: null, enrollment_model: null } },
    })))).toBe('staff');
  });

  it('puts bootcamp learners on the paid column, not outside the limits', async () => {
    // They bought a programme rather than a plan, but they are learners: the paid allowances are
    // theirs, and skipping the counter entirely would hand a whole population uncapped AI.
    expect(await aiTierFor(authFor(dbStub({
      studentsById: { 'student-1': { role: 'student', cohort_id: null, enrollment_model: 'bootcamp' } },
    })))).toBe('paid');
  });

  it('puts manually cohorted learners on the paid column', async () => {
    // A cohort with no subscription row is someone an admin placed by hand, not a subscriber --
    // and not someone to sell an upgrade to either.
    expect(await aiTierFor(authFor(dbStub({
      studentsById: { 'student-1': { role: 'student', cohort_id: 'cohort-1', enrollment_model: null } },
    })))).toBe('paid');
  });

  it('reads the real actor in Student Mode, not the learner being previewed', async () => {
    // An instructor previewing a course is read as staff, so the free-plan restrictions of the
    // learner they are impersonating never apply to them.
    const tier = await aiTierFor(authFor(dbStub({
      studentsById: {
        'staff-1': { role: 'instructor', cohort_id: null, enrollment_model: null },
        'student-1': { role: 'student', cohort_id: null, enrollment_model: null },
      },
    }), 'staff-1'));
    expect(tier).toBe('staff');
  });

  it('falls back to the paid column when there is nothing to look the caller up with', () => {
    // A malformed auth object is not a reason to start applying free-plan restrictions.
    return expect(aiTierFor({ actor: undefined, serviceDb: undefined } as any)).resolves.toBe('paid');
  });
});
