-- Google Analytics 4, configured per deployment rather than compiled in.
--
-- A tenant that wants visitor numbers should not need an environment variable and a redeploy to
-- get them. The measurement ID lives beside the rest of the branding row, so an admin pastes it
-- into Settings and it is live within the 60 second tenant-settings cache.
--
-- Null means analytics are off, so deploying this column changes nothing on its own. There is
-- deliberately no environment fallback: it could not be told apart from a column an admin had
-- just cleared, which would have switched tracking straight back on. The format is checked by
-- lib/analytics.ts on the way in and again before the tag is configured, so the row alone is
-- never enough to decide what the page loads.

ALTER TABLE public.platform_settings
  ADD COLUMN IF NOT EXISTS google_analytics_id text;

COMMENT ON COLUMN public.platform_settings.google_analytics_id IS
  'GA4 measurement ID (G-XXXXXXXXXX). Null disables analytics. Format-validated on write and on render.';
