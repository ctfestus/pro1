-- How much AI each learner gets, moved out of the code and into settings.
--
-- These numbers were constants in eight route files, so changing "one free review a day" needed
-- an edit and a deploy for what is a pricing decision.
--
-- Null means "use the values compiled in", so deploying this column changes nothing on its own.
-- lib/ai-limits.ts holds the defaults and the ceilings, and validates every value on the way in --
-- an unrecognised or out-of-range key is ignored there rather than trusted from the row.

ALTER TABLE public.platform_settings
  ADD COLUMN IF NOT EXISTS ai_limits jsonb;

COMMENT ON COLUMN public.platform_settings.ai_limits IS
  'Per-feature AI request limits. Null or missing keys fall back to AI_LIMIT_DEFAULTS in lib/ai-limits.ts. Validated and clamped against AI_LIMIT_MAX before being written.';
