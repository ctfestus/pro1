-- 241_product_announcements.sql
--
-- Launch emails for digital products: an instructor or admin announces a product to every admitted,
-- active student (/api/books/announce).
--
--   book_announcements               one row per launch email: who sent it, when, to how many, and
--                                    how far it got. One may be sending per product at a time, and
--                                    the send route refuses another within ten minutes of the last.
--   book_announcement_recipients     the audience fixed at send time, with each person's status, so
--                                    a send that is interrupted resumes without emailing anyone twice
--                                    (the hourly sweep picks up a stalled one). Both service role only.
--
-- Safe to run again. Mirrored into festman-fresh-schema.sql.

CREATE TABLE IF NOT EXISTS public.book_announcements (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  book_id    uuid        NOT NULL REFERENCES public.books(id) ON DELETE CASCADE,
  sent_by    uuid        REFERENCES public.students(id) ON DELETE SET NULL,
  subject    text        NOT NULL CHECK (length(btrim(subject)) BETWEEN 1 AND 200),
  recipients integer     NOT NULL DEFAULT 0 CHECK (recipients >= 0),
  sent       integer     NOT NULL DEFAULT 0 CHECK (sent >= 0),
  status     text        NOT NULL DEFAULT 'preparing' CHECK (status IN ('preparing', 'sending', 'sent', 'failed')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_book_announcements_book ON public.book_announcements(book_id, created_at DESC);
ALTER TABLE public.book_announcements ADD COLUMN IF NOT EXISTS message text NOT NULL DEFAULT '' CHECK (length(message) <= 5000);
ALTER TABLE public.book_announcements ADD COLUMN IF NOT EXISTS failed integer NOT NULL DEFAULT 0 CHECK (failed >= 0);
-- The email, fixed when the announcement is created (sender, subject, and the rendered HTML with a
-- placeholder for each student's name), so a send resumed later sends exactly the same thing
-- whatever changes to the product, branding or templates in between.
ALTER TABLE public.book_announcements ADD COLUMN IF NOT EXISTS email_from text NOT NULL DEFAULT '';
ALTER TABLE public.book_announcements ADD COLUMN IF NOT EXISTS email_subject text NOT NULL DEFAULT '';
ALTER TABLE public.book_announcements ADD COLUMN IF NOT EXISTS email_html text NOT NULL DEFAULT '';
ALTER TABLE public.book_announcements ADD COLUMN IF NOT EXISTS error text;
ALTER TABLE public.book_announcements ADD COLUMN IF NOT EXISTS last_progress_at timestamptz NOT NULL DEFAULT now();
-- One send at a time per product (while its list is being saved, or while it sends): two requests
-- at once cannot both start one.
DROP INDEX IF EXISTS public.idx_book_announcements_one_sending;
CREATE UNIQUE INDEX IF NOT EXISTS idx_book_announcements_one_active
  ON public.book_announcements(book_id) WHERE status IN ('preparing', 'sending');

-- Who an announcement goes to, fixed when it is sent, and how each one went. Sending works through
-- the pending rows, so an interrupted send resumes where it stopped and never emails anyone twice.
CREATE TABLE IF NOT EXISTS public.book_announcement_recipients (
  announcement_id uuid        NOT NULL REFERENCES public.book_announcements(id) ON DELETE CASCADE,
  student_id      uuid        NOT NULL,
  email           text        NOT NULL,
  name            text,
  -- 'sending': handed to the email provider, outcome not yet recorded. A batch left there by a crash
  -- is retried only inside the provider's 24-hour duplicate window (same key, so it is not
  -- delivered twice); after that it is marked failed rather than risk a second copy.
  status          text        NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sending', 'sent', 'failed', 'skipped')),
  attempted_at    timestamptz,
  error           text,
  updated_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (announcement_id, student_id)
);
CREATE INDEX IF NOT EXISTS idx_book_announcement_recipients_pending
  ON public.book_announcement_recipients(announcement_id, student_id) WHERE status = 'pending';

ALTER TABLE public.book_announcements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.book_announcement_recipients ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.book_announcements, public.book_announcement_recipients FROM anon, authenticated;
GRANT ALL ON public.book_announcements, public.book_announcement_recipients TO service_role;
