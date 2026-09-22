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
import { refundRateLimit, spendRateLimit } from '@/lib/rate-limit';
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

export interface AiFeatureReservation {
  actorId: string;
  canUpgrade: boolean;
  failOpen: boolean;
  key: AiFeatureKey;
  limit: number;
  redis: Redis | null;
  unavailableMessage: string;
}

function limitReachedResponse(key: AiFeatureKey, limit: number, canUpgrade: boolean): NextResponse {
  const spec = aiFeature(key);
  return NextResponse.json({
    error: `You have used your ${limit} ${spec.noun} ${windowWording(key)}. This resets ${spec.window === 'hour' ? 'within the hour' : 'within a day of your first one'}.`,
    code: 'daily_limit_reached',
    ...(canUpgrade ? { upgradeUrl: AI_REVIEW_UPGRADE_URL } : {}),
  }, { status: 429 });
}

export async function reserveAiFeatureLimit(
  auth: Pick<AuthedUser, 'actor' | 'serviceDb'>,
  redis: Redis | null,
  key: AiFeatureKey,
  options: GateOptions = {},
): Promise<AiFeatureReservation | NextResponse> {
  const unavailableMessage = options.unavailableMessage ?? 'This AI feature is unavailable right now. Please try again shortly.';
  const failOpen = options.failOpen === true;

  // Without an identity there is no per-learner counter to reserve. Fail-closed routes refuse;
  // fail-open routes carry an empty reservation so the spend phase preserves their old behavior.
  const actorId = auth.actor?.id;
  if (!actorId) return failOpen ? { actorId: '', canUpgrade: false, failOpen, key, limit: 1, redis: null, unavailableMessage } : NextResponse.json({ error: unavailableMessage }, { status: 503 });

  // Tier and limit lookups are policy, not metering. If either is unavailable we cannot know
  // whether an administrator switched the feature off, so even fail-open routes refuse here.
  let who;
  let limits;
  try {
    who = await aiTierFor(auth);
    limits = await getAiLimits();
  } catch {
    return NextResponse.json({ error: unavailableMessage }, { status: 503 });
  }

  const limit = limitForAudience(limits, key, who);
  const canUpgrade = upgradeImproves(limits, key, who);
  // A zero limit means the feature is disabled. Check it before touching Redis so a limiter outage
  // cannot quietly reopen a feature that policy has closed.
  if (limit <= 0) {
    return NextResponse.json({
      error: canUpgrade
        ? 'This AI feature is not included in your plan. Upgrade to unlock it.'
        : 'This AI feature is currently turned off.',
      code: 'paid_plan_required',
      ...(canUpgrade ? { upgradeUrl: AI_REVIEW_UPGRADE_URL } : {}),
    }, { status: 402 });
  }

  if (!redis) {
    // failOpen applies only to the counter. Policy and identity were already resolved above.
    return failOpen
      ? { actorId, canUpgrade, failOpen, key, limit, redis, unavailableMessage }
      : NextResponse.json({ error: unavailableMessage }, { status: 503 });
  }

  try {
    // Reservation reads the current budget without incrementing it. Expensive validation can now
    // happen before spend, while callers who are already out of allowance still stop immediately.
    const budget = await peekAiFeatureBudget(actorId, redis, key, limit);
    if (budget.remaining <= 0) return limitReachedResponse(key, limit, canUpgrade);
  } catch {
    if (!failOpen) return NextResponse.json({ error: unavailableMessage }, { status: 503 });
  }

  return { actorId, canUpgrade, failOpen, key, limit, redis, unavailableMessage };
}

/**
 * Proof that an attempt was really taken, and which window took it.
 *
 * Only a spend can issue one, and only a holder of one can refund. That makes the mistake
 * unavailable rather than merely discouraged: nothing can hand back an attempt it did not take.
 */
export interface AiFeatureReceipt {
  counterKey: string;
  redis: Redis;
  /**
   * Local clock reading after which the charged window has certainly rolled.
   *
   * A model call can outlive the window it was charged in. Refunding after that point would credit
   * whichever window is running by then, which is somebody's fresh allowance. Infinity is a counter
   * with no expiry, left by an older failure: it never rolls, so a refund always lands on the same
   * one.
   */
  windowEndsAt: number;
}

export interface AiFeatureCharge {
  /** The refusal to return, or null to carry on. */
  response: NextResponse | null;
  /**
   * The receipt, or null when the counter never moved -- a refusal, or a fail-open route waved
   * through because the limiter could not be reached. Only the spend itself knows which.
   */
  receipt: AiFeatureReceipt | null;
}

export async function spendAiFeatureReservation(reservation: AiFeatureReservation): Promise<AiFeatureCharge> {
  const { actorId, canUpgrade, failOpen, key, limit, redis, unavailableMessage } = reservation;
  // Nothing was counted on this path, whichever way the route leans.
  const notCounted = (): AiFeatureCharge => ({
    response: failOpen ? null : NextResponse.json({ error: unavailableMessage }, { status: 503 }),
    receipt: null,
  });
  if (!redis || !actorId) return notCounted();
  const counterKey = `${aiFeature(key).rateKey}:${actorId}`;
  try {
    // Refusing and incrementing are one step, so a request that is turned away never adds to the
    // counter -- otherwise a concurrent refund would only undo somebody else's refusal.
    const spend = await spendRateLimit(redis, counterKey, limit, windowSeconds(key));
    if (!spend.allowed) return { response: limitReachedResponse(key, limit, canUpgrade), receipt: null };
    return {
      response: null,
      receipt: {
        counterKey,
        redis,
        windowEndsAt: spend.ttlSeconds === null ? Infinity : Date.now() + spend.ttlSeconds * 1000,
      },
    };
  } catch {
    return notCounted();
  }
}

/**
 * How close to the end of a window a refund is still trusted.
 *
 * The deadline compares a local clock against an expiry Redis keeps by its own, so the two can
 * disagree slightly. A margin wider than any plausible drift means the last moments of a window are
 * skipped rather than credited to the next one.
 */
const REFUND_SAFETY_MS = 5_000;

/**
 * Give an attempt back, because the work it paid for never happened.
 *
 * The counter has to be spent BEFORE the model runs -- otherwise it is not a spend limit at all,
 * and a caller could run expensive requests and only be stopped afterwards. The cost of that order
 * is that a model failure took an attempt for a review nobody received. On the free plan that is
 * someone's whole day, for a timeout they did not cause.
 *
 * So the refusal path refunds. Deliberately quiet: a refund that fails must not turn a model error
 * into a second error, and the counter expires within the window regardless.
 */
export async function refundAiFeature(receipt: AiFeatureReceipt): Promise<void> {
  if (Date.now() + REFUND_SAFETY_MS >= receipt.windowEndsAt) return;
  try {
    await refundRateLimit(receipt.redis, receipt.counterKey);
  } catch {
    // Nothing to do. The window rolls the counter anyway.
  }
}

/** Charge an attempt, and hand back the receipt if one was really taken. */
export async function chargeAiFeature(
  auth: Pick<AuthedUser, 'actor' | 'serviceDb'>,
  redis: Redis | null,
  key: AiFeatureKey,
  options: GateOptions = {},
): Promise<AiFeatureCharge> {
  const reservation = await reserveAiFeatureLimit(auth, redis, key, options);
  if (reservation instanceof NextResponse) return { response: reservation, receipt: null };
  return spendAiFeatureReservation(reservation);
}

/**
 * What a learner has left, WITHOUT spending any allowance.
 *
 * So a surface can say "you have none left today" before a learner writes an answer or uploads a
 * workbook, rather than taking the work and refusing it. Deliberately not a spend: asking
 * how many are left must never be the thing that uses one up. A peek may repair a missing expiry
 * on an existing counter so an old Redis failure cannot block the learner forever.
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
  // A failed EXPIRE after an earlier increment can leave an immortal counter. Reservations do not
  // increment, but they must retain the limiter's self-healing behavior when they encounter one.
  if (used > 0 && ttl === -1) await redis.expire(counterKey, windowSeconds(key)).catch(() => {});
  return {
    limit,
    remaining: Math.max(0, limit - (Number.isFinite(used) ? used : 0)),
    // -1 is a key with no expiry and -2 is no key at all; neither is a countdown worth showing.
    resetsInSeconds: typeof ttl === 'number' && ttl > 0 ? ttl : null,
  };
}
