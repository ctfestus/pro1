// What the reviewer surfaces need to know BEFORE a learner does the work: may this account use
// the upload-based AI reviewers, how many of today's free short reviews are left, and which plan
// to send them to, at what price. Answering that up front is the whole point -- the alternative
// is taking an answer or a workbook and only then refusing it.
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
  priceAmount: null,
  priceCurrency: null,
  priceMonths: null,
};

interface ViewPrice {
  durationMonths: number;
  amount: number;
  currency: string;
}

export async function GET(req: NextRequest) {
  const auth = await requireUser(req);
  if (isAuthError(auth)) return auth.error;

  try {
    if (!(await studentUsesStarterReviewBudget(auth))) return NextResponse.json(UNLOCKED);

    const redis = getRedis();
    const budget = redis ? await peekStarterReviewBudget(auth, redis) : null;

    // Read the same view the pricing page reads, rather than the tables underneath it.
    //
    // Sellable is more than active-and-not-archived: the plan's access cohort has to really be an
    // individual subscription cohort, and it has to grant at least one piece of published content.
    // Querying subscription_plans directly passed plans that /pricing does not list, so a learner
    // could be sent to buy something they would never find. The view also applies any live
    // promotion, so the figure quoted here is the figure they are charged.
    const { data: plan } = await auth.serviceDb
      .from('public_pricing_plans')
      .select('plan_name, prices')
      .eq('recommended', true)
      .maybeSingle();

    // The cheapest way in, shown with its own term rather than converted to a monthly rate. A
    // monthly figure derived from a yearly plan appears nowhere else in the product and is not
    // what anyone is charged; the smallest real payment is.
    let price: ViewPrice | null = null;
    const rows = (plan?.prices ?? []) as ViewPrice[];

    // A plan may be priced in more than one currency, and "lowest amount" across currencies is
    // meaningless -- USD 5 would beat GHS 60 and quote a learner a price in money they are not
    // paying. Rather than guess which one is theirs, say nothing: every surface omits the line
    // when there is no price, which is the right outcome for an unanswerable question.
    const currencies = new Set(rows.map(row => row.currency));
    if (currencies.size === 1) {
      for (const row of rows) {
        const amount = Number(row.amount);
        if (!Number.isFinite(amount)) continue;
        if (!price || amount < Number(price.amount)) price = { ...row, amount };
      }
    }

    return NextResponse.json({
      locked: true,
      planName: plan?.plan_name ?? null,
      upgradeUrl: AI_REVIEW_UPGRADE_URL,
      dailyLimit: budget?.limit ?? null,
      dailyRemaining: budget?.remaining ?? null,
      resetsInSeconds: budget?.resetsInSeconds ?? null,
      priceAmount: price?.amount ?? null,
      priceCurrency: price?.currency ?? null,
      priceMonths: price?.durationMonths ?? null,
    });
  } catch {
    // The lock is an affordance, not the gate. A failed lookup must never paint a lock over a
    // reviewer the learner is entitled to -- enforceStudentAiReviewPlanLimit still refuses the
    // request itself if they are not.
    return NextResponse.json(UNLOCKED);
  }
}
