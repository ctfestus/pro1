-- Google Analytics 4, configured per deployment rather than compiled in.
--
-- A tenant that wants visitor numbers should not need an environment variable and a redeploy to
-- get them, and two tenants sharing a build must not share a property. The measurement ID lives
-- beside the rest of the branding row, so an admin pastes it into Settings and it is live within
-- the 60 second tenant-settings cache.
--
-- Null means analytics are off, so deploying this column changes nothing on its own. The value is
-- validated against /^G-[A-Z0-9]{4,}$/i before it is written and again before it is rendered into
-- the page: it ends up inside an inline script, so it is never trusted from the row alone.

ALTER TABLE public.platform_settings
  ADD COLUMN IF NOT EXISTS google_analytics_id text;

COMMENT ON COLUMN public.platform_settings.google_analytics_id IS
  'GA4 measurement ID (G-XXXXXXXXXX). Null disables analytics. Format-validated on write and on render.';
