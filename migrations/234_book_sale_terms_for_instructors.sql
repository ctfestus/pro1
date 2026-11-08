-- 234: instructors manage their own books' sale terms.
--
-- Migration 232 reserved whether a book is sold, its royalty and its prices for admins, via the
-- guard_book_commercial_terms trigger and an admin-only book_prices policy. On this platform
-- instructors are trusted as admins are, so an instructor now sets the sale terms of the books they
-- own, exactly as they edit the rest of the book; an admin still manages every book.
--
-- With the trigger gone, the existing owner policies are the whole rule: "books: instructor update"
-- (is_instructor_or_admin() AND (owner OR admin)) for purchasable and royalty_pct, and the policy
-- below for prices. book_purchases.royalty_pct still snapshots the royalty at sale time, so a later
-- change never rewrites past sales.

DROP TRIGGER IF EXISTS trg_guard_book_commercial_terms ON public.books;
DROP FUNCTION IF EXISTS public.guard_book_commercial_terms();

DROP POLICY IF EXISTS "book_prices: admin manage" ON public.book_prices;
DROP POLICY IF EXISTS "book_prices: instructor manage" ON public.book_prices;
CREATE POLICY "book_prices: instructor manage"
  ON public.book_prices FOR ALL TO authenticated
  USING      ((SELECT public.is_instructor_or_admin()) AND EXISTS (SELECT 1 FROM public.books b WHERE b.id = book_id AND (b.user_id = (SELECT auth.uid()) OR (SELECT public.is_admin()))))
  WITH CHECK ((SELECT public.is_instructor_or_admin()) AND EXISTS (SELECT 1 FROM public.books b WHERE b.id = book_id AND (b.user_id = (SELECT auth.uid()) OR (SELECT public.is_admin()))));
