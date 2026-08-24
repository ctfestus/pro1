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

function authed(serviceDb: any) {
  mockRequireUser.mockResolvedValue({
    user: { id: 'student1', email: 'student@example.com' },
    serviceDb,
    token: 'test-token',
  } as any);
  mockCreateClient.mockReturnValue(serviceDb);
}

const quizQuestion = { id: 'q1', type: 'multiple_choice', options: ['A', 'B'], correctAnswer: 'A' };

const requiredShare = { id: 'share1', isLinkedInShare: true, linkedInShareRequired: true, linkedInSharePoints: 50 };
const optionalShare = { id: 'share2', isLinkedInShare: true, linkedInShareRequired: false, linkedInSharePoints: 50 };

/** Stub for a course with the given slides, plus an active attempt and its share claims. */
function stub(questions: any[], claimedItemIds: string[], attemptAnswers: Record<string, string> = { q1: 'A' }) {
  return makeSupabaseStub({
    courses: { data: { user_id: 'owner1', status: 'published', cohort_ids: [], available_to_everyone: true, questions, passmark: 50, points_enabled: true, points_base: 100, points_system: { enabled: true, basePoints: 100, timeBonusEnabled: false, timeBonusMultiplier: 1, streakEnabled: false, streakCount: 0, streakBonus: 0, hintPenalty: 0, solutionPenalty: 0, milestones: [] } }, error: null },
    course_attempts: [
      { data: { id: 'attempt1', answers: attemptAnswers, hints_used: [] }, error: null },
      { data: null, error: null },
    ],
    students: [
        { data: { role: 'student', cohort_id: null }, error: null },                                  // loadAccessibleCourse
        { data: { full_name: 'Student One' }, error: null },   // the action's own lookup
      ],
    linkedin_shares: { data: claimedItemIds.map(id => ({ item_id: id })), error: null },
  });
}

beforeEach(() => {
  mockRequireUser.mockReset();
  mockCreateClient.mockReset();
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';
});

// The player disables Continue and blocks its finish dialog, but that is only the browser. Posting
// complete-attempt directly must not complete, grade, or issue a certificate for a course whose
// required LinkedIn share was never claimed.
describe('POST /api/course complete-attempt: required LinkedIn share is enforced server-side', () => {
  it('refuses to complete when a required share has no claim', async () => {
    authed(stub([quizQuestion, requiredShare], []));

    const res = await post({
      action: 'complete-attempt',
      course_id: 'course1',
      score: 100,
      passed: true,
      final_answers: { q1: 'A' },
    });

    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toBe('share_required');
    expect(body.missing).toEqual(['share1']);
  });

  it('names every outstanding required share so the player can link to them', async () => {
    const second = { id: 'share3', isLinkedInShare: true, linkedInShareRequired: true, linkedInSharePoints: 50 };
    authed(stub([quizQuestion, requiredShare, second], []));

    const res = await post({ action: 'complete-attempt', course_id: 'course1', final_answers: { q1: 'A' } });

    expect(res.status).toBe(409);
    expect((await res.json()).missing).toEqual(['share1', 'share3']);
  });

  // linkedInShareRequired is optional in the contract, and an absent flag means OPTIONAL. The gate
  // fails open on purpose: a student with no LinkedIn account who lands behind it cannot be exempted
  // by anyone, so only a deliberate `=== true` may block a submission. Forgetting the toggle, or any
  // authoring path that never writes the field, must not strand them.
  it('treats an absent linkedInShareRequired flag as optional', async () => {
    authed(stub([quizQuestion, { id: 'share9', isLinkedInShare: true }], []));

    const res = await post({ action: 'complete-attempt', course_id: 'course1', final_answers: { q1: 'A' } });

    expect(res.status).toBe(200);
  });

  it('completes when the required share has been claimed', async () => {
    authed(stub([quizQuestion, requiredShare], ['share1']));

    const res = await post({ action: 'complete-attempt', course_id: 'course1', final_answers: { q1: 'A' } });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.passed).toBe(true);
  });

  it('completes with an unclaimed OPTIONAL share, and awards it no bonus', async () => {
    authed(stub([quizQuestion, optionalShare], []));

    const res = await post({ action: 'complete-attempt', course_id: 'course1', final_answers: { q1: 'A' } });

    expect(res.status).toBe(200);
    const body = await res.json();
    // One correct question at 100 base points, and nothing for the unshared optional slide.
    expect(body.points).toBe(100);
  });

  it('awards the bonus for a claimed share on top of quiz points', async () => {
    authed(stub([quizQuestion, requiredShare], ['share1']));

    const res = await post({ action: 'complete-attempt', course_id: 'course1', final_answers: { q1: 'A' } });

    expect((await res.json()).points).toBe(150);
  });

  // The claim table is the authority, so a URL sitting in answers with no claim behind it must not
  // satisfy the gate -- this is the shape a client-injected final_answers takes.
  it('ignores a share URL in the answers when no claim backs it', async () => {
    authed(stub([quizQuestion, requiredShare], [], { q1: 'A', share1: 'https://www.linkedin.com/posts/x_y-activity-7123456789012345678-Ab1c' }));

    const res = await post({
      action: 'complete-attempt',
      course_id: 'course1',
      final_answers: { q1: 'A', share1: 'https://www.linkedin.com/posts/x_y-activity-7123456789012345678-Ab1c' },
    });

    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe('share_required');
  });

  // A course whose only slide is an optional share the student skipped is finishable, but they will
  // have answered nothing -- so save-progress never ran and there is no attempt row. Returning
  // ignored:'no_active_attempt' looked like success while persisting nothing: no attempt, no
  // certificate, no durable completion.
  it('creates the attempt when a skippable course is finished without one', async () => {
    authed(makeSupabaseStub({
      courses: {
        data: {
          user_id: 'owner1', status: 'published', cohort_ids: [], available_to_everyone: true,
          questions: [optionalShare],
          passmark: 50, points_enabled: false, points_base: 100,
        },
        error: null,
      },
      course_attempts: [
        { data: null, error: null },                                    // no open attempt
        { data: null, error: null },                                    // no passed attempt either
        { data: null, error: null },                                    // no previous attempt_number
        { data: { id: 'created1', answers: {}, hints_used: [] }, error: null },  // insert().select().single()
        { data: null, error: null },                                    // the completing update
      ],
      students: [
        { data: { role: 'student', cohort_id: null }, error: null },                                  // loadAccessibleCourse
        { data: { full_name: 'Student One' }, error: null },   // the action's own lookup
      ],
      linkedin_shares: { data: [], error: null },
    }));

    const res = await post({ action: 'complete-attempt', course_id: 'course1', final_answers: {} });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ignored).toBeUndefined();   // must not report a no-op
    expect(body.passed).toBe(true);         // no scorable questions -> 100%
  });

  it('still refuses a REQUIRED share when there is no attempt row', async () => {
    authed(makeSupabaseStub({
      courses: { data: { user_id: 'owner1', status: 'published', cohort_ids: [], available_to_everyone: true, questions: [requiredShare], passmark: 50, points_enabled: false, points_base: 100 }, error: null },
      course_attempts: [
        { data: null, error: null },
        { data: null, error: null },
        { data: null, error: null },
        { data: { id: 'created1', answers: {}, hints_used: [] }, error: null },
      ],
      students: [
        { data: { role: 'student', cohort_id: null }, error: null },                                  // loadAccessibleCourse
        { data: { full_name: 'Student One' }, error: null },   // the action's own lookup
      ],
      linkedin_shares: { data: [], error: null },
    }));

    const res = await post({ action: 'complete-attempt', course_id: 'course1', final_answers: {} });

    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe('share_required');
  });

  it('is a no-op for courses with no share slides', async () => {
    authed(makeSupabaseStub({
      courses: { data: { user_id: 'owner1', status: 'published', cohort_ids: [], available_to_everyone: true, questions: [quizQuestion], passmark: 50, points_enabled: false, points_base: 100 }, error: null },
      course_attempts: [
        { data: { id: 'attempt1', answers: { q1: 'A' }, hints_used: [] }, error: null },
        { data: null, error: null },
      ],
      students: [
        { data: { role: 'student', cohort_id: null }, error: null },                                  // loadAccessibleCourse
        { data: { full_name: 'Student One' }, error: null },   // the action's own lookup
      ],
    }));

    const res = await post({ action: 'complete-attempt', course_id: 'course1', final_answers: { q1: 'A' } });

    expect(res.status).toBe(200);
  });
});

// These three actions run on the service-role client, which bypasses RLS. Without an explicit access
// check a signed-in user holding any course UUID could create progress on -- or complete -- a course
// they were never assigned, including an unpublished one.
describe('POST /api/course: course access is enforced on progress and completion', () => {
  const unreachable = (courseOver: Record<string, unknown>) => makeSupabaseStub({
    courses: { data: { id: 'course1', user_id: 'someone-else', questions: [quizQuestion], passmark: 50, ...courseOver }, error: null },
    students: { data: { role: 'student', cohort_id: 'not-in-this-course' }, error: null },
    course_attempts: { data: null, error: null },
    certificates: { data: null, error: null },
    learning_paths: { data: null, error: null },
  });

  for (const action of ['get-progress', 'save-progress', 'complete-attempt'] as const) {
    it(`refuses ${action} on an unpublished course`, async () => {
      authed(unreachable({ status: 'draft', cohort_ids: [] }));
      const res = await post({ action, course_id: 'course1' });
      expect(res.status).toBe(403);
    });

    it(`refuses ${action} on a course assigned to another cohort`, async () => {
      authed(unreachable({ status: 'published', cohort_ids: ['other-cohort'] }));
      const res = await post({ action, course_id: 'course1' });
      expect(res.status).toBe(403);
    });
  }
});

// A database failure must never read as success. ensureActiveAttempt used to return null both for
// "already passed" and "insert failed", and complete-attempt mapped every null to a 200.
describe('POST /api/course: persistence failures are reported, not swallowed', () => {
  const withAttemptFailure = (questions: any[]) => makeSupabaseStub({
    courses: { data: { user_id: 'owner1', status: 'published', cohort_ids: [], available_to_everyone: true, questions, passmark: 50, points_enabled: false, points_base: 100 }, error: null },
    students: [
      { data: { role: 'student', cohort_id: null }, error: null },
      { data: { full_name: 'Student One' }, error: null },
    ],
    course_attempts: [
      { data: null, error: null },                                        // no open attempt
      { data: null, error: null },                                        // no passed attempt
      { data: null, error: null },                                        // no previous attempt_number
      { data: null, error: { code: '08006', message: 'connection failure' } },  // the insert fails
    ],
    linkedin_shares: { data: [], error: null },
  });

  it('returns 500 when the attempt cannot be created during completion', async () => {
    authed(withAttemptFailure([optionalShare]));

    const res = await post({ action: 'complete-attempt', course_id: 'course1', final_answers: {} });

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.ok).toBeUndefined();
    expect(body.ignored).toBeUndefined();   // must not masquerade as already_completed
  });

  it('still reports already_completed for a genuinely passed course', async () => {
    authed(makeSupabaseStub({
      courses: { data: { user_id: 'owner1', status: 'published', cohort_ids: [], available_to_everyone: true, questions: [quizQuestion], passmark: 50, points_enabled: false, points_base: 100 }, error: null },
      students: [
        { data: { role: 'student', cohort_id: null }, error: null },
        { data: { full_name: 'Student One' }, error: null },
      ],
      course_attempts: [
        { data: null, error: null },                      // no open attempt
        { data: { id: 'passed1' }, error: null },          // but a passed one exists
      ],
      linkedin_shares: { data: [], error: null },
    }));

    const res = await post({ action: 'complete-attempt', course_id: 'course1', final_answers: {} });

    expect(res.status).toBe(200);
    expect((await res.json()).ignored).toBe('already_completed');
  });
});

// Every lookup ensureActiveAttempt performs must surface its own failure. The attempt_number lookup
// was the last one still ignoring its error: nothing would raise, the insert would quietly land on
// attempt_number 1, and the "current attempt" ranking in /api/course-progress would be wrong.
describe('POST /api/course: every attempt lookup reports its own failure', () => {
  const failingLookup = (failAt: number) => makeSupabaseStub({
    courses: { data: { user_id: 'owner1', status: 'published', cohort_ids: [], available_to_everyone: true, questions: [optionalShare], passmark: 50, points_enabled: false, points_base: 100 }, error: null },
    students: [
      { data: { role: 'student', cohort_id: null }, error: null },
      { data: { full_name: 'Student One' }, error: null },
    ],
    // Four entries, consumed in call order: open-attempt lookup, passed-attempt lookup,
    // attempt_number lookup, then the INSERT -- which must succeed, or the test would pass on the
    // insert failing instead of on the lookup it is meant to exercise.
    course_attempts: [
      ...[0, 1, 2].map(i => (
        i === failAt
          ? { data: null, error: { code: '08006', message: 'connection failure' } }
          : { data: null, error: null }
      )),
      { data: { id: 'created1', answers: {}, hints_used: [] }, error: null },
    ],
    linkedin_shares: { data: [], error: null },
  });

  const cases: Array<[string, number]> = [
    ['the open-attempt lookup', 0],
    ['the passed-attempt lookup', 1],
    ['the attempt_number lookup', 2],
  ];

  for (const [label, failAt] of cases) {
    it(`returns 500 when ${label} fails`, async () => {
      authed(failingLookup(failAt));

      const res = await post({ action: 'complete-attempt', course_id: 'course1', final_answers: {} });

      expect(res.status).toBe(500);
      const body = await res.json();
      expect(body.ok).toBeUndefined();
      expect(body.ignored).toBeUndefined();
    });
  }
});
