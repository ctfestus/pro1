/**
 * How much AI each learner gets, per feature, per plan.
 *
 * These numbers were constants scattered across nine route files, so changing what a free learner
 * gets meant an edit and a deploy for what is a pricing decision. They live in platform_settings
 * now, and every route asks for its own feature rather than declaring a constant.
 *
 * Two things follow from the shape.
 *
 * "No access" is a 0, not a rule. The upload reviewers used to refuse free learners in code, so
 * opening one up was a deploy. A tenant that wants to give free learners a document review a day
 * can now say so, and one that wants to close practice checks entirely can do that too.
 *
 * Free and paid are the same table. There is no separate shared allowance to reason about, so a
 * pot cannot be set larger than the caps it is spent against -- a class of mistake that existed
 * only while the two plans were modelled differently.
 *
 * Deliberately NOT here: the tutor's platform-wide hourly and daily ceilings. Those are not a
 * product setting, they are the circuit breaker that stops a runaway loop draining the account,
 * and a form that can raise them is a form that can hand someone a bill. They stay in env.
 *
 * Contract only -- no database. The settings tab is a client component and imports this for the
 * field list and the ceilings, so anything that builds the service-role client would be bundled
 * into the browser with it. Reading the row lives in ai-limits-server.ts.
 */

export type AiFeatureKey =
  | 'practiceChecks'
  | 'writtenReviews'
  | 'veAnswers'
  | 'excelReview'
  | 'documentReview'
  | 'dashboardReview'
  | 'codeReview'
  | 'lessonTutor'
  | 'sqlHelper'
  | 'briefChat';

/** The two columns an admin edits. Both describe learners. */
export type AiTier = 'free' | 'paid';

/**
 * Who a caller actually is, which is a wider question than which column they read.
 *
 * Staff are counted, but against the shipped numbers rather than the learner settings: the
 * settings page is scoped to learners, and an instructor should not lose the ability to preview
 * their own course because they closed a reviewer for students.
 */
export type AiAudience = AiTier | 'staff';

/** What this audience gets of a feature. Staff read the shipped paid number, never the setting. */
export function limitForAudience(limits: AiLimits, key: AiFeatureKey, who: AiAudience): number {
  if (who === 'staff') return aiFeature(key).paid;
  return limits[key][who];
}

/**
 * Whether upgrading would actually get this learner more of THIS feature.
 *
 * Nothing stops an admin setting paid below free, or closing a feature on paid while leaving it
 * open on free. Offering an upgrade there would sell someone a reduction.
 */
export function upgradeImproves(limits: AiLimits, key: AiFeatureKey, who: AiAudience): boolean {
  return who === 'free' && limits[key].paid > limits[key].free;
}

export interface AiFeatureLimit {
  free: number;
  paid: number;
}

export type AiLimits = Record<AiFeatureKey, AiFeatureLimit>;

export interface AiFeatureSpec {
  key: AiFeatureKey;
  label: string;
  hint: string;
  /** How long the counter runs for. Not configurable: a window is a design choice, not a policy. */
  window: 'day' | 'hour';
  /**
   * The Redis key prefix, kept as it was so existing counters carry over. Changing one would hand
   * every learner a fresh allowance the moment it shipped.
   */
  rateKey: string;
  /** What a refusal calls them: "Limit reached: 3 code reviews per day." */
  noun: string;
  /** The ceiling an admin may set, on either plan. */
  max: number;
  /** The values that were hardcoded, kept as the fallback so an empty setting changes nothing. */
  free: number;
  paid: number;
}

/**
 * Every AI feature a learner can spend.
 *
 * The free column is a per-feature allowance, not a shared pot, and that is a deliberate choice
 * rather than a side effect of moving these numbers into settings. The old rule gave a free
 * learner one review a day across practice checks, written reviews and VE answers together; the
 * rule now is one of each. It is the more generous reading, chosen because the alternative takes
 * access away from people who have it today, and because a pot is the thing that made the two
 * plans behave differently and created a class of mistake all of its own.
 *
 * These are the shipped starting points, not policy. Every one of them is editable per tenant on
 * the AI features tab, so a deployment that wants the old total can set two of the three to 0.
 */
export const AI_FEATURES: AiFeatureSpec[] = [
  { key: 'practiceChecks', label: 'Practice checks', window: 'day', rateKey: 'rate:written-review:brief',
    noun: 'practice checks', max: 200, free: 1, paid: 20,
    hint: 'The short check inside a lesson knowledge check.' },
  { key: 'writtenReviews', label: 'Written reviews', window: 'day', rateKey: 'rate:written-review:full',
    noun: 'written reviews', max: 100, free: 1, paid: 10,
    hint: 'A full written answer reviewed against the rubric.' },
  { key: 'veAnswers', label: 'Virtual experience answers', window: 'day', rateKey: 'rate:ve-answer-review',
    noun: 'AI reviews', max: 100, free: 1, paid: 10,
    hint: 'The written answer check inside a virtual experience.' },
  { key: 'excelReview', label: 'Excel review', window: 'day', rateKey: 'rate:excel-review',
    noun: 'Excel reviews', max: 50, free: 0, paid: 3,
    hint: 'Reviews an uploaded workbook. Costs more to run than a text review.' },
  { key: 'documentReview', label: 'Document review', window: 'day', rateKey: 'rate:document-review',
    noun: 'document reviews', max: 50, free: 0, paid: 3,
    hint: 'Reviews an uploaded report.' },
  { key: 'dashboardReview', label: 'Dashboard review', window: 'day', rateKey: 'rate:dashboard-critique',
    noun: 'dashboard analyses', max: 50, free: 0, paid: 3,
    hint: 'Reviews an uploaded dashboard screenshot.' },
  { key: 'codeReview', label: 'Code review', window: 'day', rateKey: 'rate:code-review',
    noun: 'code reviews', max: 50, free: 0, paid: 3,
    hint: 'Reviews pasted or uploaded code.' },
  { key: 'lessonTutor', label: 'Lesson tutor', window: 'hour', rateKey: 'rate:lesson-tutor',
    noun: 'tutor questions', max: 100, free: 15, paid: 15,
    hint: 'Questions about a lesson. Platform-wide ceilings stay in env and are not editable here.' },
  { key: 'sqlHelper', label: 'SQL helper', window: 'hour', rateKey: 'rate:sql-ai',
    noun: 'requests', max: 300, free: 60, paid: 60,
    hint: 'The AI helper inside SQL exercises.' },
  { key: 'briefChat', label: 'Brief chat questions', window: 'day', rateKey: 'rate:ve-brief-chat',
    noun: 'questions', max: 200, free: 20, paid: 20,
    hint: 'Questions a learner can ask about a virtual experience brief.' },
];

/** The reviewers a learner can be stopped at mid-task, so a surface can warn them before they work. */
export const AI_REVIEWER_KEYS: AiFeatureKey[] = [
  'practiceChecks', 'writtenReviews', 'veAnswers',
  'excelReview', 'documentReview', 'dashboardReview', 'codeReview',
];

const BY_KEY = new Map(AI_FEATURES.map(f => [f.key, f]));

export function aiFeature(key: AiFeatureKey): AiFeatureSpec {
  const spec = BY_KEY.get(key);
  if (!spec) throw new Error(`Unknown AI feature: ${key}`);
  return spec;
}

export const AI_LIMIT_DEFAULTS: AiLimits = Object.fromEntries(
  AI_FEATURES.map(f => [f.key, { free: f.free, paid: f.paid }]),
) as AiLimits;

/**
 * Clamp one value, or return null when it is not usable.
 *
 * Zero is allowed and means no access on that plan. Null means "reject", not "use the default" --
 * silently substituting a default for a typo would tell an admin their change was saved when a
 * different number is in force.
 */
export function validateAiLimit(key: AiFeatureKey, value: unknown): number | null {
  // Reject absence explicitly. Number(null) and Number('') are both 0, and 0 now means "no access"
  // -- so without this, clearing a field or omitting one would silently close that feature rather
  // than being refused.
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n) || !Number.isInteger(n)) return null;
  if (n < 0 || n > aiFeature(key).max) return null;
  return n;
}

/** Whatever of a stored object is valid, with the shipped numbers filling the rest. */
export function mergeAiLimits(stored: unknown): AiLimits {
  const source = (stored ?? {}) as Record<string, any>;
  const out = {} as AiLimits;
  for (const spec of AI_FEATURES) {
    const row = source[spec.key] ?? {};
    out[spec.key] = {
      free: validateAiLimit(spec.key, row?.free) ?? spec.free,
      paid: validateAiLimit(spec.key, row?.paid) ?? spec.paid,
    };
  }
  return out;
}

/** The window in seconds, from the feature's own shape rather than a constant per route. */
export function windowSeconds(key: AiFeatureKey): number {
  return aiFeature(key).window === 'hour' ? 3600 : 86400;
}

/** "per day" / "per hour", for a refusal a learner reads. */
export function windowWording(key: AiFeatureKey): string {
  return aiFeature(key).window === 'hour' ? 'per hour' : 'per day';
}
