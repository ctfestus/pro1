/**
 * The one gate every AI feature goes through.
 *
 * Replaces a pattern that used to be copied into nine routes: read a constant, bump a counter,
 * build a refusal. Each route now names its feature and this decides the rest, so the settings
 * page is the only place any of these numbers live.
 *
 * Three answers are possible, and they are not the same thing:
 *
 *   null   -- go ahead, they are under their limit.
 *   402    -- the limit is 0. This feature is off for them. Nothing to wait for.
 *   429    -- the limit is above 0 and they have spent it. It comes back when the window rolls.
 *
 * Those two refusals must never be worded alike. "Turned off" tells someone to stop asking;
 * "you have used today's" tells them to come back. The UI keeps them apart too: a lock for the
 * first, a countdown for the second.
 *
 * An upgrade is offered only when upgrading would actually get them more of THIS feature. A
 * subscriber has nothing above them, and an admin is free to set paid below free -- offering an
 * upgrade there would sell someone a reduction.
 *
 * failOpen covers metering only. Not knowing who someone is, or what their plan allows, is a
 * different kind of failure: it always refuses, because the alternative is running a feature that
 * may be switched off.
 */
import { NextResponse } from 'next/server';
import type { Redis } from '@upstash/redis';
import type { AuthedUser } from '@/lib/api-auth';
import { bumpRateLimit } from '@/lib/rate-limit';
import { AI_REVIEW_UPGRADE_URL } from '@/lib/ai-review-upgrade';
import {
  aiFeature,
  limitForAudience,
  upgradeImproves,
  windowSeconds,
  windowWording,
  type AiFeatureKey,
} from '@/lib/ai-limits';
import { aiTierFor, getAiLimits } from '@/lib/ai-limits-server';

interface GateOptions {
  /**
   * What to do when the COUNTER cannot be reached.
   *
   * Most routes fail closed: an outage is exactly when an unbounded bill would be run up. The
   * cheap text reviewers fail open, because refusing every learner over a Redis blip costs more
   * in trust than the requests cost in money. Each route keeps the stance it already had.
   *
   * This never applies to a feature that is switched off. Being off is policy, not metering, so
   * it holds whether or not the counter is reachable.
   */
  failOpen?: boolean;
  unavailableMessage?: string;
}

export async function enforceAiFeatureLimit(
  auth: Pick<AuthedUser, 'actor' | 'serviceDb'>,
  redis: Redis | null,
  key: AiFeatureKey,
  options: GateOptions = {},
): Promise<NextResponse | null> {
  const unavailable = options.unavailableMessage ?? 'This AI feature is unavailable right now. Please try again shortly.';

  // Without an identity there is no per-learner counter to spend, and an unmeterable request is
  // exactly what the fail-closed routes exist to refuse. requireUser always supplies this, so in
  // practice it only catches a malformed caller.
  const actorId = auth.actor?.id;
  if (!actorId) {
    return options.failOpen ? null : NextResponse.json({ error: unavailable }, { status: 503 });
  }

  // Two different failures, and failOpen answers only one of them.
  //
  // Who this caller is, and what their plan allows, are POLICY. If either lookup fails we do not
  // know whether this feature is switched off, and running it anyway is how a fail-open route
  // quietly reopens something an admin closed. That refuses regardless of failOpen.
  let who;
  let limits;
  try {
    who = await aiTierFor(auth);
    limits = await getAiLimits();
  } catch {
    return NextResponse.json({ error: unavailable }, { status: 503 });
  }

  const spec = aiFeature(key);
  const limit = limitForAudience(limits, key, who);
  const canUpgrade = upgradeImproves(limits, key, who);
  const upgrade = canUpgrade ? { upgradeUrl: AI_REVIEW_UPGRADE_URL } : {};

  // Checked before the counter, and before Redis is even consulted. A feature set to 0 is off, and
  // an unreachable limiter is no reason to run it anyway.
  if (limit <= 0) {
    return NextResponse.json({
      error: canUpgrade
        ? 'This AI feature is not included in your plan. Upgrade to unlock it.'
        // Says nothing about a plan: this also reaches bootcamp learners and staff, who are not on
        // one. And nothing about waiting, because waiting will not help.
        : 'This AI feature is currently turned off.',
      code: 'paid_plan_required',
      ...upgrade,
    }, { status: 402 });
  }

  // From here on the only question is METERING, which is what failOpen was written for: refusing
  // every learner over a Redis blip costs more in trust than the requests cost in money.
  if (!redis) {
    return options.failOpen ? null : NextResponse.json({ error: unavailable }, { status: 503 });
  }

  try {
    if (await bumpRateLimit(redis, `${spec.rateKey}:${actorId}`, limit, windowSeconds(key))) {
      return NextResponse.json({
        // Says what they had and when it returns -- never that the feature is off, which would
        // tell someone to stop asking for something they get back in a few hours.
        error: `You have used your ${limit} ${spec.noun} ${windowWording(key)}. This resets ${spec.window === 'hour' ? 'within the hour' : 'within a day of your first one'}.`,
        code: 'daily_limit_reached',
        ...upgrade,
      }, { status: 429 });
    }
  } catch {
    return options.failOpen ? null : NextResponse.json({ error: unavailable }, { status: 503 });
  }

  return null;
}

/**
 * What a learner has left, WITHOUT spending any of it.
 *
 * So a surface can say "you have none left today" before a learner writes an answer or uploads a
 * workbook, rather than taking the work and refusing it. Deliberately not `bumpRateLimit`: asking
 * how many are left must never be the thing that uses one up.
 */
export interface AiFeatureBudget {
  limit: number;
  remaining: number;
  /** Seconds until the window rolls over, or null when nothing has been spent yet. */
  resetsInSeconds: number | null;
}

export async function peekAiFeatureBudget(
  actorId: string,
  redis: Redis,
  key: AiFeatureKey,
  limit: number,
): Promise<AiFeatureBudget> {
  const counterKey = `${aiFeature(key).rateKey}:${actorId}`;
  const [rawCount, ttl] = await Promise.all([redis.get(counterKey), redis.ttl(counterKey)]);
  const used = Number(rawCount ?? 0);
  return {
    limit,
    remaining: Math.max(0, limit - (Number.isFinite(used) ? used : 0)),
    // -1 is a key with no expiry and -2 is no key at all; neither is a countdown worth showing.
    resetsInSeconds: typeof ttl === 'number' && ttl > 0 ? ttl : null,
  };
}
