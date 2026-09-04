-- A public view of the learning paths a visitor is actually allowed to be shown.
--
-- "Explore more learning paths" needs each path's card: cover, badge, title, blurb and skills.
-- The obvious source, published_learning_paths, is the wrong one -- it lists EVERY published
-- path, including one built for a single client's private cohort, and it is granted to anon.
-- Reading it directly would put those titles, covers, descriptions, badges and skills in front of
-- anybody, which is exactly what /api/catalogue-preview refuses to do.
--
-- published_learning_paths is deliberately left as it is: the authoring and taking screens rely
-- on an instructor still seeing bootcamp content through it.
--
-- So this view applies the rule the rest of the public surface already uses -- publicly_offered_
-- content: open to everyone, or sold by a plan that is genuinely on sale. Content nobody can buy
-- stays as invisible here as it is everywhere else.
--
-- Depends on migration 203, which adds learning_paths.skills.

CREATE OR REPLACE VIEW public.publicly_offered_learning_paths
WITH (security_barrier = true)
AS
  SELECT lp.id, lp.title, lp.description, lp.cover_image, lp.badge_image_url, lp.skills
  FROM   public.learning_paths lp
  JOIN   public.publicly_offered_content o
    ON   o.content_table = 'learning_paths' AND o.content_id = lp.id;

GRANT SELECT ON public.publicly_offered_learning_paths TO anon, authenticated;
