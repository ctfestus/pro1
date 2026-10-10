-- Migration 223: when teaching ends, separately from when the cohort ends.
--
-- A cohort's end_date includes the catch-up period students get after classes to finish their work. The
-- student My Program view needs the last day of classes to draw the weekly journey and measure
-- pace; without it the catch-up weeks count as teaching time and every student looks further ahead
-- than they are. NULL means there is no catch-up period: classes run to end_date.
-- (Called catch-up, not grace: grace_period_days already means late-payment grace.)
--
-- Deploy note: run this before shipping the code that reads it. The student dashboard selects this
-- column when loading the cohort, so without it cohort pages fail to load.
--
-- No CHECK against start_date/end_date on purpose: the payment settings panel saves cohort dates
-- without reading the error, so a constraint would turn an end-date change into a silent no-op.
-- The cohort forms and PATCH /api/cohorts/[id] validate it, and readers ignore it when out of range.

ALTER TABLE public.cohorts ADD COLUMN IF NOT EXISTS classes_end_date date;

COMMENT ON COLUMN public.cohorts.classes_end_date IS
  'Last day of classes. end_date minus this is the catch-up period. NULL = classes run to end_date.';
