/**
 * The onboarding questions' answers (students.onboarding_responses): their labels, shared by the
 * onboarding page, which asks them, and the admin Students page, which shows them.
 */

export const EMPLOYMENT_LABELS: Record<string, string> = {
  full_time: 'Full-time', part_time: 'Part-time', student: 'Student',
  nss: 'National service or internship', unemployed: 'Unemployed', other: 'Other',
};

export const OBJECTIVE_LABELS: Record<string, string> = {
  new_career: 'Start a new career', level_up: 'Level up in my current role',
  transition_to_tech: 'Transition into tech', explore_skills: 'Explore new skills',
};

export const REFERRAL_LABELS: Record<string, string> = {
  linkedin: 'LinkedIn', facebook: 'Facebook', x: 'X', whatsapp: 'WhatsApp',
  friend: 'A friend or colleague', other: 'Other',
};

type Responses = {
  employment_status?: string | null; employment_status_other?: string | null;
  learning_objective?: string | null;
  referral_source?: string | null; referral_source_other?: string | null;
} | null | undefined;

/** One answer as readable text: an "Other" answer shows what they typed. Empty when skipped. */
function label(value: string | null | undefined, other: string | null | undefined, labels: Record<string, string>): string {
  if (!value) return '';
  if (value === 'other' && other?.trim()) return other.trim();
  return labels[value] ?? value;
}

/** A learner's three answers as text, each '' when skipped. */
export function onboardingAnswers(r: Responses) {
  return {
    employment: label(r?.employment_status, r?.employment_status_other, EMPLOYMENT_LABELS),
    objective: label(r?.learning_objective, null, OBJECTIVE_LABELS),
    referral: label(r?.referral_source, r?.referral_source_other, REFERRAL_LABELS),
  };
}
