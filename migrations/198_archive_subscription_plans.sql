-- Somewhere to put a plan that is finished with.
--
-- A plan carrying any history cannot be deleted, and that is right: deleting it would orphan the
-- records of what people paid and what they got. Deactivating is the intended action, but an
-- inactive plan stays in the list beside the live ones for ever, so the list only grows.
--
-- Archiving is a separate axis from status on purpose. "Inactive" is a plan that is off right
-- now and may come back -- a seasonal offer, a plan being repriced -- and staff still need to see
-- it. "Archived" is a plan nobody expects to use again. Reusing status for both would mean an
-- admin could not tell those two apart, and hiding every inactive plan would hide the ones they
-- switched off this morning and are about to switch back on.
--
-- Nothing here changes who can be charged or what anyone already bought. An archived plan is
-- already unsellable, because the public pricing view requires status = 'active'.

ALTER TABLE public.subscription_plans
  ADD COLUMN IF NOT EXISTS archived_at timestamptz;

COMMENT ON COLUMN public.subscription_plans.archived_at IS
  'When this plan was put out of the way. Archived plans are hidden from the plan list and the '
  'content editors by default. Independent of status: archiving requires the plan to be '
  'inactive, and unarchiving leaves it inactive rather than switching it back on.';

-- Partial, because the list's default view asks for exactly this: the plans that are not
-- archived. The archived ones are a rare, deliberate lookup and can be scanned.
CREATE INDEX IF NOT EXISTS idx_subscription_plans_not_archived
  ON public.subscription_plans (created_at DESC)
  WHERE archived_at IS NULL;
