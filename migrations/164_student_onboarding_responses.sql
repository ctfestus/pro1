-- Flexible, versioned answers collected during the lightweight student onboarding flow.
ALTER TABLE public.students
  ADD COLUMN IF NOT EXISTS onboarding_responses jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.students.onboarding_responses IS
  'Versioned onboarding answers such as employment status, learning objective, and referral source.';
