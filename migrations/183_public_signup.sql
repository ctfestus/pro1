-- Public self-serve signup, off by default.
--
-- Until now an account could only become usable if an admin had pre-added the email to a cohort
-- allowlist AND a matching bootcamp_enrollments row existed. app/auth/callback is deliberately
-- fail-closed about that: anything it cannot positively admit is marked denied. This flag adds a
-- second, narrower way in -- a free account with no cohort, which sees only content tagged
-- available_to_everyone.
--
-- DEFAULT false is the whole point. Deploying this migration opens nothing; signups stay invite
-- only until someone flips the switch in the dashboard, and flipping it back closes them again
-- with no deploy. A launch that goes wrong needs to be reversible in seconds, not in a review
-- cycle.
--
-- Deliberately NOT nullable: a null would be a third state ("unset") that every reader would have
-- to decide how to interpret, and the safe interpretation is the same as false, so encode it once
-- here instead of at each call site.

BEGIN;

ALTER TABLE public.platform_settings
  ADD COLUMN IF NOT EXISTS public_signup_enabled boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.platform_settings.public_signup_enabled IS
  'When true, app/auth/callback admits a confirmed signup that is on no cohort allowlist as a free '
  'account: access_state active, cohort_id null, enrollment_model left null. When false, such a '
  'signup is denied exactly as before. Read server-side per request, never from a cached copy, so '
  'turning it off takes effect immediately.';

COMMIT;
