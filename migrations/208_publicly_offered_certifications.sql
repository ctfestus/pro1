-- migration 208: the certification CARD, for the certifications a visitor may actually be shown.
--
-- publicly_offered_content has always had a certifications branch, so the gate already agrees
-- which certifications are public. The landing page still could not list them: there is no
-- published_certifications view, and certifications.* denies anon SELECT on purpose because the
-- base table holds the exam question bank and its answer keys.
--
-- So this exposes the card, and only the card. The column list is the same one
-- app/api/catalogue-preview already pins as safe to serve a signed-out visitor, plus cert_type,
-- which the card needs to group Career apart from Technology. Nothing here reaches questions,
-- practice_questions, passmark, cohort_ids or any other exam internals.
--
-- Same shape as publicly_offered_learning_paths (migration 204): a view, because the landing page
-- reads with the anonymous key and anonymous callers cannot evaluate plan coverage themselves --
-- the RLS policy on subscription_plan_content requires a matching subscription. A view runs with
-- its owner's rights, which is how the existing published_* views already serve visitors.

CREATE OR REPLACE VIEW public.publicly_offered_certifications
WITH (security_barrier = true)
AS
  SELECT ce.id, ce.title, ce.description, ce.cover_image, ce.slug, ce.cert_type
  FROM   public.certifications ce
  JOIN   public.publicly_offered_content o
    ON   o.content_table = 'certifications' AND o.content_id = ce.id;

GRANT SELECT ON public.publicly_offered_certifications TO anon, authenticated;
