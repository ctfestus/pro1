-- Cover videos on the public cards (follows migration 253).
--
-- The landing page and the See all pages read the catalogue through these views, which list their
-- columns one by one. Each gains cover_video at the end (CREATE OR REPLACE VIEW may only append),
-- so a card can offer its video's play button. cover_video is display data: a Bunny player link,
-- an https still, a title and a length, the same fields the content page already shows a
-- signed-out visitor through app/api/catalogue-preview.

BEGIN;

CREATE OR REPLACE VIEW public.published_courses WITH (security_barrier = true) AS
  SELECT c.id, c.title, c.description, c.cover_image, c.slug, c.category,
         p.name AS partner_name, p.logo_url AS partner_logo_url,
         c.cover_video
  FROM public.courses c
  LEFT JOIN public.partners p ON p.id = c.partner_id AND p.is_active = true
  WHERE c.status = 'published';

CREATE OR REPLACE VIEW public.published_virtual_experiences WITH (security_barrier = true) AS
  SELECT id, title, tagline, cover_image, slug, industry, difficulty, cover_video
  FROM   public.virtual_experiences
  WHERE  status = 'published';

CREATE OR REPLACE VIEW public.published_learning_paths WITH (security_barrier = true) AS
  SELECT id, title, description, cover_image, cover_video
  FROM   public.learning_paths
  WHERE  status = 'published';

CREATE OR REPLACE VIEW public.publicly_offered_certifications WITH (security_barrier = true) AS
  SELECT ce.id, ce.title, ce.description, ce.cover_image, ce.slug, ce.cert_type, ce.cover_video
  FROM   public.certifications ce
  JOIN   public.publicly_offered_content o
    ON   o.content_table = 'certifications' AND o.content_id = ce.id;

COMMIT;
