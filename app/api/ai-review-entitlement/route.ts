// What the reviewer surfaces need to know BEFORE a learner does the work: which reviewers this
// plan includes, how many of each are left today, and which plan to send them to at what price.
// Answering that up front is the whole point -- the alternative is taking an answer or a workbook
// and only then refusing it.
//
// Deliberately small. /api/student-subscriptions answers a superset of the plan half, but it also
// loads payment options, plan contents and any open checkout -- far too much to run once per
// review activity in a course.
import { NextRequest, NextResponse } from 'next/server';
import { requireUser, isAuthError } from '@/lib/api-auth';
import { getRedis } from '@/lib/redis';
import { AI_REVIEWER_KEYS, limitForAudience, upgradeImproves } from '@/lib/ai-limits';
import { aiTierFor, getAiLimits } from '@/lib/ai-limits-server';
import { peekAiFeatureBudget } from '@/lib/ai-feature-gate';
import { AI_REVIEW_UPGRADE_URL } from '@/lib/ai-review-upgrade';

export const dynamic = 'force-dynamic';

/** What a failed lookup answers: nothing locked, nothing sold. */
const UNKNOWN = {
  tier: null,
  features: {},
  planName: null,
  upgradeUrl: AI_REVIEW_UPGRADE_URL,
  priceAmount: null,
  priceCurrency: null,
  priceMonths: null,
};

export async function GET(req: NextRequest) {
  const auth = await requireUser(req);
  if (isAuthError(auth)) return auth.error;

  try {
    const tier = await aiTierFor(auth);
    const limits = await getAiLimits();
    const redis = getRedis();

    // One entry per reviewer a learner can be stopped at mid-task. limit 0 is the lock; a limit
    // with nothing left is the "come back tomorrow" case. The UI tells those apart.
    const features: Record<string, { limit: number; remaining: number | null; resetsInSeconds: number | null; canUpgrade: boolean }> = {};
    for (const key of AI_REVIEWER_KEYS) {
      const limit = limitForAudience(limits, key, tier);
      // Per feature, not per learner. An admin may set paid below free, or close a feature on paid
      // while leaving it open on free -- offering an upgrade there would sell a reduction.
      const canUpgrade = upgradeImproves(limits, key, tier);
      if (!redis || limit <= 0) {
        // No counter to read, or none worth reading. Remaining stays null rather than 0 so the UI
        // never reports an exhausted allowance it has not actually measured.
        features[key] = { limit, remaining: limit <= 0 ? 0 : null, resetsInSeconds: null, canUpgrade };
        continue;
      }
      features[key] = { ...await peekAiFeatureBudget(auth.actor.id, redis, key, limit), canUpgrade };
    }

    // Only a free learner has anything to buy, so the plan lookup is skipped for everyone else.
    // Whether any individual feature is worth upgrading for is decided per feature above.
    if (tier !== 'free') {
      return NextResponse.json({ ...UNKNOWN, tier, features });
    }

    // Read the same view the pricing page reads, rather than the tables underneath it. Sellable is
    // more than active-and-not-archived: the plan's access cohort has to really be an individual
    // subscription cohort, and it has to grant at least one piece of published content. Querying
    // subscription_plans directly passed plans /pricing does not list, so a learner could be sent
    // to buy something they would never find. The view also applies any live promotion, so the
    // figure quoted here is the figure they are charged.
    const { data: plan } = await auth.serviceDb
      .from('public_pricing_plans')
      .select('plan_name, prices')
      .eq('recommended', true)
      .maybeSingle();

    // The cheapest way in, shown with its own term rather than converted to a monthly rate. A
    // plan priced in more than one currency says nothing at all: "lowest amount" across currencies
    // is meaningless, and USD 5 would beat GHS 60 to quote money they do not pay.
    const rows = (plan?.prices ?? []) as { durationMonths: number; amount: number; currency: string }[];
    let price: { durationMonths: number; amount: number; currency: string } | null = null;
    if (new Set(rows.map(r => r.currency)).size === 1) {
      for (const row of rows) {
        const amount = Number(row.amount);
        if (!Number.isFinite(amount)) continue;
        if (!price || amount < Number(price.amount)) price = { ...row, amount };
      }
    }

    return NextResponse.json({
      tier,
      features,
      planName: plan?.plan_name ?? null,
      upgradeUrl: AI_REVIEW_UPGRADE_URL,
      priceAmount: price?.amount ?? null,
      priceCurrency: price?.currency ?? null,
      priceMonths: price?.durationMonths ?? null,
    });
  } catch {
    // The lock is an affordance, not the gate. A failed lookup must never paint a lock over a
    // reviewer the learner is entitled to -- the route itself still refuses the request if they
    // are not.
    return NextResponse.json(UNKNOWN);
  }
}
