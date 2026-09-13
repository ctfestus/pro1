// What the reviewer surfaces need to know BEFORE a learner does the work: may this account use
// the upload-based AI reviewers, how many of today's free short reviews are left, and which plan
// to send them to. Answering that up front is the whole point -- the alternative is taking an
// answer or a workbook and only then refusing it.
//
// Deliberately small. /api/student-subscriptions answers a superset of this, but it also loads
// payment options, plan contents and any open checkout -- far too much to run once per review
// activity in a course.
import { NextRequest, NextResponse } from 'next/server';
import { requireUser, isAuthError } from '@/lib/api-auth';
import { studentUsesStarterReviewBudget, peekStarterReviewBudget } from '@/lib/ai-review-plan-limit';
import { getRedis } from '@/lib/redis';
import { AI_REVIEW_UPGRADE_URL } from '@/lib/ai-review-upgrade';

export const dynamic = 'force-dynamic';

// A learner who is not on the free tier has no shared daily cap -- each reviewer keeps its own
// budget -- so there is no countdown to report for them.
const UNLOCKED = {
  locked: false,
  planName: null,
  upgradeUrl: AI_REVIEW_UPGRADE_URL,
  dailyLimit: null,
  dailyRemaining: null,
  resetsInSeconds: null,
};

export async function GET(req: NextRequest) {
  const auth = await requireUser(req);
  if (isAuthError(auth)) return auth.error;

  try {
    if (!(await studentUsesStarterReviewBudget(auth))) return NextResponse.json(UNLOCKED);

    const redis = getRedis();
    const budget = redis ? await peekStarterReviewBudget(auth, redis) : null;

    // The plan the tenant wants people to choose, so the lock can name it rather than saying
    // "upgrade" at a learner who then has to work out which plan that meant. Plan names are
    // tenant-authored, so there is nothing to fall back on: no recommendation, no name.
    const { data: plan } = await auth.serviceDb
      .from('subscription_plans')
      .select('name')
      .eq('recommended', true)
      .eq('status', 'active')
      .is('archived_at', null)
      .maybeSingle();

    return NextResponse.json({
      locked: true,
      planName: plan?.name ?? null,
      upgradeUrl: AI_REVIEW_UPGRADE_URL,
      dailyLimit: budget?.limit ?? null,
      dailyRemaining: budget?.remaining ?? null,
      resetsInSeconds: budget?.resetsInSeconds ?? null,
    });
  } catch {
    // The lock is an affordance, not the gate. A failed lookup must never paint a lock over a
    // reviewer the learner is entitled to -- enforceStudentAiReviewPlanLimit still refuses the
    // request itself if they are not.
    return NextResponse.json(UNLOCKED);
  }
}
