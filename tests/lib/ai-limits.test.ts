import { describe, expect, it } from 'vitest';
import {
  AI_FEATURES,
  AI_LIMIT_DEFAULTS,
  AI_REVIEWER_KEYS,
  aiFeature,
  mergeAiLimits,
  validateAiLimit,
  windowSeconds,
} from '@/lib/ai-limits';

describe('validating one limit', () => {
  it('accepts a whole number inside the ceiling', () => {
    expect(validateAiLimit('codeReview', 3)).toBe(3);
    expect(validateAiLimit('codeReview', '3')).toBe(3);
  });

  it('accepts zero, which is how a plan closes a feature', () => {
    // Zero is the whole point of the free column: "no access" is a number an admin can change,
    // not a rule compiled into a route.
    expect(validateAiLimit('excelReview', 0)).toBe(0);
  });

  it('refuses anything above the feature ceiling', () => {
    // The ceiling is the point. These numbers are money and there is no undo once spent, so a
    // typo of 1000 where 10 was meant has to be refused rather than saved with a warning.
    expect(validateAiLimit('codeReview', aiFeature('codeReview').max + 1)).toBeNull();
    expect(validateAiLimit('sqlHelper', 100_000)).toBeNull();
  });

  it('refuses negatives, fractions and nonsense', () => {
    expect(validateAiLimit('codeReview', -1)).toBeNull();
    expect(validateAiLimit('codeReview', 2.5)).toBeNull();
    expect(validateAiLimit('codeReview', 'lots')).toBeNull();
    expect(validateAiLimit('codeReview', null)).toBeNull();
  });
});

describe('merging stored limits', () => {
  it('falls back to the shipped numbers when nothing is stored', () => {
    expect(mergeAiLimits(null)).toEqual(AI_LIMIT_DEFAULTS);
    expect(mergeAiLimits({})).toEqual(AI_LIMIT_DEFAULTS);
  });

  it('takes stored values and leaves the rest alone', () => {
    const merged = mergeAiLimits({ excelReview: { free: 2, paid: 9 } });
    expect(merged.excelReview).toEqual({ free: 2, paid: 9 });
    expect(merged.codeReview).toEqual(AI_LIMIT_DEFAULTS.codeReview);
  });

  it('takes one side of a feature without discarding the other', () => {
    const merged = mergeAiLimits({ excelReview: { free: 2 } });
    expect(merged.excelReview.free).toBe(2);
    expect(merged.excelReview.paid).toBe(AI_LIMIT_DEFAULTS.excelReview.paid);
  });

  it('ignores a stored value out of range rather than trusting the row', () => {
    // The ceiling is enforced on the way in, but a row written by hand, or before a ceiling
    // changed, must not be able to raise a limit past what the code allows.
    const merged = mergeAiLimits({ codeReview: { free: 9999, paid: 'nope' } });
    expect(merged.codeReview).toEqual(AI_LIMIT_DEFAULTS.codeReview);
  });

  it('drops features no route reads', () => {
    const merged = mergeAiLimits({ somethingElse: { free: 1, paid: 1 } }) as unknown as Record<string, unknown>;
    expect(merged.somethingElse).toBeUndefined();
  });
});

describe('the feature table', () => {
  it('gives every reviewer a distinct counter key, so one cannot spend another', () => {
    const keys = AI_FEATURES.map(f => f.rateKey);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('keeps the counter keys that already exist', () => {
    // Changing one would hand every learner a fresh allowance the moment it shipped.
    expect(aiFeature('codeReview').rateKey).toBe('rate:code-review');
    expect(aiFeature('practiceChecks').rateKey).toBe('rate:written-review:brief');
    expect(aiFeature('writtenReviews').rateKey).toBe('rate:written-review:full');
  });

  it('turns a window into seconds', () => {
    expect(windowSeconds('codeReview')).toBe(86400);
    expect(windowSeconds('sqlHelper')).toBe(3600);
  });

  it('never ships a default above its own ceiling', () => {
    for (const f of AI_FEATURES) {
      expect(f.free).toBeLessThanOrEqual(f.max);
      expect(f.paid).toBeLessThanOrEqual(f.max);
    }
  });

  it('lists only real features as reviewers a surface can lock', () => {
    for (const key of AI_REVIEWER_KEYS) expect(() => aiFeature(key)).not.toThrow();
  });

  it('starts free learners with no access to the upload reviewers', () => {
    // The behaviour that used to be hardcoded, now expressed as a number an admin can change.
    for (const key of ['excelReview', 'documentReview', 'dashboardReview', 'codeReview'] as const) {
      expect(AI_LIMIT_DEFAULTS[key].free).toBe(0);
      expect(AI_LIMIT_DEFAULTS[key].paid).toBeGreaterThan(0);
    }
  });
});
