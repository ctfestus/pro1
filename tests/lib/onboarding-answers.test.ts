import { describe, expect, it } from 'vitest';
import { onboardingAnswers } from '@/lib/onboarding-answers';

describe('onboarding answers as text', () => {
  it('reads labels, uses an Other answer as typed, and leaves skipped ones empty', () => {
    expect(onboardingAnswers({ employment_status: 'other', employment_status_other: ' Freelancer ', learning_objective: 'level_up', referral_source: null }))
      .toEqual({ employment: 'Freelancer', objective: 'Level up in my current role', referral: '' });
    expect(onboardingAnswers(null)).toEqual({ employment: '', objective: '', referral: '' });
  });
});
