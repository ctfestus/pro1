-- 252_claim_guest_book_purchases.sql
--
-- A product bought as a guest (238) becomes the buyer's once they have an account with that email:
-- the next time they open My Products or a product page, each paid guest sale to their address gets
-- an entitlement, as if they had bought it signed in. That ends the double purchase a guest who
-- later signs up could make, and gives them the product for good instead of the link's 7 days.
--
-- Only a confirmed email counts (auth.users.email_confirmed_at: the confirmation link, or a Google
-- sign-in), so signing up with someone else's address claims nothing. The guest link itself is
-- unchanged and keeps its own allowance.
--
-- The entitlement's source_ref is the purchase id, like a signed-in purchase. A purchase that already
-- has an entitlement, live or revoked (a refund), is never claimed again, so revoking sticks.
--
-- Safe to run again. Mirrored into festman-fresh-schema.sql.

CREATE OR REPLACE FUNCTION public.claim_guest_book_purchases(p_student_id uuid)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_email text;
  v_count integer;
BEGIN
  SELECT lower(u.email) INTO v_email
  FROM auth.users u
  WHERE u.id = p_student_id AND u.email_confirmed_at IS NOT NULL;
  IF v_email IS NULL OR NOT EXISTS (SELECT 1 FROM public.students s WHERE s.id = p_student_id) THEN
    RETURN 0;
  END IF;

  INSERT INTO public.book_entitlements (student_id, book_id, source, source_ref)
  SELECT DISTINCT ON (p.book_id) p_student_id, p.book_id, 'purchase', p.id::text
  FROM public.book_purchases p
  WHERE p.is_guest AND p.kind = 'sale' AND p.status = 'paid' AND p.guest_email = v_email
    AND NOT EXISTS (
      SELECT 1 FROM public.book_entitlements e WHERE e.source = 'purchase' AND e.source_ref = p.id::text
    )
  ORDER BY p.book_id, p.paid_at
  ON CONFLICT (student_id, book_id) WHERE revoked_at IS NULL DO NOTHING;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.claim_guest_book_purchases(uuid) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.claim_guest_book_purchases(uuid) TO service_role;
