/**
 * Reading the AI limits, and deciding which plan a caller is on.
 *
 * Split from lib/ai-limits.ts because the settings tab is a client component: it needs the feature
 * list and the ceilings, and anything importing the service-role client alongside them would be
 * bundled into the browser. tests/lib/client-server-boundary.test.ts enforces that separation.
 */
import type { AuthedUser } from '@/lib/api-auth';
import { adminClient } from '@/lib/admin-client';
import { mergeAiLimits, type AiAudience, type AiLimits } from '@/lib/ai-limits';

// Read once a minute rather than once a request. A limit is not an access gate -- the worst a
// stale value costs is a few extra requests at the old number, whereas reading the row on every
// AI call adds a query to the hot path of every reviewer.
const CACHE_MS = 60_000;
let cached: { at: number; value: AiLimits } | null = null;
// The last configuration that was actually read. Kept separately from the cache so a failed read
// can fall back to real policy rather than to the shipped defaults.
let lastGood: AiLimits | null = null;

/** Drop the cache so the next read is fresh. Called when the settings are saved. */
export function clearAiLimitsCache() {
  cached = null;
}

export async function getAiLimits(): Promise<AiLimits> {
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.value;
  try {
    const { data, error } = await adminClient()
      .from('platform_settings')
      .select('ai_limits')
      .eq('id', 'default')
      .maybeSingle();
    // Supabase reports failure in the payload, not by throwing. Ignoring it read as "no settings
    // yet", which quietly reopened every feature an admin had turned off.
    if (error) throw error;
    const value = mergeAiLimits(data?.ai_limits);
    cached = { at: Date.now(), value };
    lastGood = value;
    return value;
  } catch (cause) {
    // Hold the last configuration that was really read, and do NOT cache it, so the next request
    // tries again rather than serving a guess for a minute.
    if (lastGood) return lastGood;

    // Nothing has ever been read -- a cold instance whose first lookup failed. The shipped
    // defaults are PERMISSIVE relative to a tenant that has closed things down, so returning them
    // would reopen a reviewer an admin had turned off, at exactly the moment nobody can tell.
    // Reporting the failure lets each caller decide: the gate refuses, the UI simply does not lock.
    throw cause instanceof Error ? cause : new Error('AI limits are unavailable');
  }
}

/**
 * Whose allowance this caller spends.
 *
 * Three answers, and the third is the one that is easy to get wrong.
 *
 * 'free' means precisely one thing: an individual learner with no active subscription -- the only
 * population that can be sold an upgrade. 'paid' covers subscribers, bootcamp learners and anyone
 * an admin placed in a cohort by hand: not all on a subscription, but all entitled to the fuller
 * allowance, and none of them sellable an upgrade.
 *
 * 'staff' is separate because the settings page is scoped to LEARNERS. An instructor previewing
 * their own course should not lose the ability to test a reviewer because they set the paid column
 * to 0 for students. Staff are still counted -- they were before any of this existed -- but
 * against the shipped numbers rather than whatever learners are given.
 *
 * Reads the ACTOR throughout, not the Student Mode target. An instructor previewing a course as a
 * learner should not spend that learner's allowance, and reading one id for the role and another
 * for the subscription would only be correct by accident.
 */
export async function aiTierFor(
  auth: Pick<AuthedUser, 'actor' | 'serviceDb'>,
): Promise<AiAudience> {
  // Nothing to look the caller up with. The paid column is the permissive of the two, and a
  // malformed auth object is not a reason to start charging someone the free-plan restrictions.
  if (!auth.serviceDb || !auth.actor?.id) return 'paid';

  const { data: student, error: studentError } = await auth.serviceDb
    .from('students')
    .select('role, cohort_id, enrollment_model')
    .eq('id', auth.actor.id)
    .maybeSingle();
  if (studentError) throw studentError;

  // No row at all is treated as a free learner rather than skipped. Every auth user gets one from
  // a trigger, so this is close to unreachable -- but the safe reading of "unknown" is the
  // tightest plan, not no plan.
  if (!student) return 'free';
  // Staff read the shipped numbers, not the learner settings -- see the note above.
  if (student.role !== 'student') return 'staff';
  // A bootcamp learner bought a programme rather than a plan, but they are a learner: the paid
  // allowances are theirs, and they are never shown an upgrade.
  if (student.enrollment_model === 'bootcamp') return 'paid';

  const { data: subscription, error: subscriptionError } = await auth.serviceDb
    .from('individual_subscriptions')
    .select('status, current_period_end')
    .eq('student_id', auth.actor.id)
    .maybeSingle();
  if (subscriptionError) throw subscriptionError;

  // Manually-cohorted learners are not on a subscription tier, so they read the paid column.
  // Individual subscribers also have a synthetic cohort, which is why this only applies when there
  // is no subscription row tying the learner to the subscription system at all.
  if (!subscription && student.cohort_id) return 'paid';

  if (subscription?.status !== 'active') return 'free';
  const endMs = new Date(subscription.current_period_end ?? '').getTime();
  return Number.isFinite(endMs) && endMs > Date.now() ? 'paid' : 'free';
}
