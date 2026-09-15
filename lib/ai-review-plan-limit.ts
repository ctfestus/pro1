import { NextResponse } from 'next/server';
import type { Redis } from '@upstash/redis';
import type { AuthedUser } from '@/lib/api-auth';
import { bumpRateLimit } from '@/lib/rate-limit';
import { AI_REVIEW_UPGRADE_URL } from '@/lib/ai-review-upgrade';

const STARTER_DAILY_LIMIT = 1;
const DAY_SECONDS = 86400;
const STARTER_REVIEW_KEY = 'rate:student-ai-review:starter';

export interface StarterReviewBudget {
  /** How many reviews a free learner gets per rolling day. */
  limit: number;
  remaining: number;
  /** Seconds until the window rolls over, or null when nothing has been spent yet. */
  resetsInSeconds: number | null;
}

/**
 * Read the free-tier counter WITHOUT spending from it.
 *
 * So a surface can say "you have used today's review" before a learner writes an answer, rather
 * than taking the answer and refusing it. Deliberately not `bumpRateLimit`: asking how many are
 * left must never be the thing that uses one up.
 */
export async function peekStarterReviewBudget(
  auth: Pick<AuthedUser, 'actor'>,
  redis: Redis,
): Promise<StarterReviewBudget> {
  const key = `${STARTER_REVIEW_KEY}:${auth.actor.id}`;
  const [rawCount, ttl] = await Promise.all([redis.get(key), redis.ttl(key)]);
  const used = Number(rawCount ?? 0);
  return {
    limit: STARTER_DAILY_LIMIT,
    remaining: Math.max(0, STARTER_DAILY_LIMIT - (Number.isFinite(used) ? used : 0)),
    // -1 is a key with no expiry and -2 is no key at all; neither is a countdown worth showing.
    resetsInSeconds: typeof ttl === 'number' && ttl > 0 ? ttl : null,
  };
}

type PlanLimitOptions = {
  failOpen?: boolean;
  paidOnly?: boolean;
  unavailableMessage?: string;
};

function hasActivePaidPlan(subscription: any, nowMs: number): boolean {
  if (!subscription || subscription.status !== 'active') return false;
  const endMs = new Date(subscription.current_period_end ?? '').getTime();
  return Number.isFinite(endMs) && endMs > nowMs;
}

/**
 * Whether this caller is on the free daily review budget.
 *
 * Exported because the pre-upload lock in the reviewer players has to reach the same verdict as
 * the gate below. A second copy of this rule is how the lock and the 402 start disagreeing, and
 * the learner is the one who finds out -- shown an unlocked uploader that the server then refuses.
 */
export async function studentUsesStarterReviewBudget(auth: Pick<AuthedUser, 'actor' | 'serviceDb' | 'user'>): Promise<boolean> {
  if (!auth.serviceDb || !auth.actor?.id || !auth.user?.id) return false;

  const { data: student, error: studentError } = await auth.serviceDb
    .from('students')
    .select('role, cohort_id, enrollment_model')
    .eq('id', auth.actor.id)
    .maybeSingle();
  if (studentError) throw studentError;
  if (!student) return true;
  if (student.role !== 'student') return false;
  if (student.enrollment_model === 'bootcamp') return false;

  const { data: subscription, error: subscriptionError } = await auth.serviceDb
    .from('individual_subscriptions')
    .select('status, current_period_end')
    // The actor throughout, not the Student Mode target. Staff have already returned above, so
    // the two ids are equal by the time this runs -- but reading one id for the role and another
    // for the subscription only stayed correct because of that, and nothing said so.
    .eq('student_id', auth.actor.id)
    .maybeSingle();
  if (subscriptionError) throw subscriptionError;

  // Manually-cohorted learners are not governed by individual subscription tiers.
  // Individual subscribers also have a synthetic cohort, so only apply this exclusion when there
  // is no subscription row tying the learner to the subscription system.
  if (!subscription && student.cohort_id) return false;

  return !hasActivePaidPlan(subscription, Date.now());
}

/**
 * Starter/free learners get one AI review per day across all reviewer endpoints.
 *
 * Paid learners keep each endpoint's existing budget. Staff are skipped by checking the real
 * actor, so previewing in Student Mode does not spend the selected learner's budget.
 */
export async function enforceStudentAiReviewPlanLimit(
  auth: Pick<AuthedUser, 'actor' | 'serviceDb' | 'user'>,
  redis: Redis | null,
  options: PlanLimitOptions = {},
): Promise<NextResponse | null> {
  const unavailable = options.unavailableMessage ?? 'AI review is unavailable right now. Please try again shortly.';
  if (!redis) {
    return options.failOpen ? null : NextResponse.json({ error: unavailable }, { status: 503 });
  }

  try {
    if (!(await studentUsesStarterReviewBudget(auth))) return null;
    if (options.paidOnly) {
      return NextResponse.json(
        {
          error: 'This AI reviewer requires an active paid plan. Upgrade to unlock it.',
          code: 'paid_plan_required',
          upgradeUrl: AI_REVIEW_UPGRADE_URL,
        },
        { status: 402 },
      );
    }
    if (await bumpRateLimit(redis, `${STARTER_REVIEW_KEY}:${auth.actor.id}`, STARTER_DAILY_LIMIT, DAY_SECONDS)) {
      return NextResponse.json(
        {
          // States the limit, and stops there. What a paid plan is worth is the pricing page's
          // job -- a plan is mainly the content it unlocks, so selling it here as extra reviews
          // would understate it.
          error: 'Your free plan includes 1 AI review per day. Upgrade for more.',
          code: 'daily_limit_reached',
          upgradeUrl: AI_REVIEW_UPGRADE_URL,
        },
        { status: 429 },
      );
    }
  } catch {
    if (options.failOpen) return null;
    return NextResponse.json({ error: unavailable }, { status: 503 });
  }

  return null;
}
