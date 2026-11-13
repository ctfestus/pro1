-- Public event registration.
--
-- Until now an event was cohort-only: the events policy hides it from anyone outside its cohorts,
-- and "registration" was the automatic event_registrations row each cohort member gets. This adds
-- an opt-in for an event to take registrations from anyone, with or without an account.
--
-- Public registrants live in their own table rather than in event_registrations. That table is
-- keyed on a student and is read everywhere as "the cohort roster" (attendance, absence nudges,
-- the attendance report, email blasts, /api/join's membership rule). Keeping guests out of it
-- means none of that cohort machinery can misread a guest, and none of it has to change.
--
-- Nobody writes this table directly: registration goes through /api/events/register, which calls
-- register_event_publicly() below with the service role, so the capacity check and the insert
-- happen under one lock.

ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS public_registration boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS public.event_public_registrations (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id        uuid        NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  name            text        NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80),
  -- Stored normalized (trimmed, lowercased) so one address registers once per event.
  email           text        NOT NULL CHECK (email = lower(btrim(email)) AND char_length(email) BETWEEN 3 AND 254),
  -- Set when the registrant was signed in. Kept on account deletion as a plain guest row.
  student_id      uuid        REFERENCES public.students(id) ON DELETE SET NULL,
  responses       jsonb       NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(responses) = 'object'),
  -- The key in the emailed /api/join link: 64 hex characters from two random UUIDs.
  join_token      text        NOT NULL UNIQUE
                    DEFAULT replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''),
  registered_at   timestamptz NOT NULL DEFAULT now(),
  first_joined_at timestamptz,
  last_joined_at  timestamptz,
  UNIQUE (event_id, email)
);

CREATE INDEX IF NOT EXISTS idx_event_public_registrations_event
  ON public.event_public_registrations(event_id, registered_at DESC);

ALTER TABLE public.event_public_registrations ENABLE ROW LEVEL SECURITY;

-- The event's owner (or an admin) reads its registrants from the dashboard, and may remove one
-- (someone signed up by another person, or who asks to be taken off). Inserts and updates go
-- through the service role only.
DROP POLICY IF EXISTS "event_public_registrations: owner select" ON public.event_public_registrations;
CREATE POLICY "event_public_registrations: owner select"
  ON public.event_public_registrations FOR SELECT
  USING (
    (SELECT public.is_instructor_or_admin())
    AND EXISTS (
      SELECT 1 FROM public.events e
      WHERE e.id = event_id
        AND (e.user_id = (SELECT auth.uid()) OR (SELECT public.is_admin()))
    )
  );

DROP POLICY IF EXISTS "event_public_registrations: owner delete" ON public.event_public_registrations;
CREATE POLICY "event_public_registrations: owner delete"
  ON public.event_public_registrations FOR DELETE
  USING (
    (SELECT public.is_instructor_or_admin())
    AND EXISTS (
      SELECT 1 FROM public.events e
      WHERE e.id = event_id
        AND (e.user_id = (SELECT auth.uid()) OR (SELECT public.is_admin()))
    )
  );

-- Register one address for one event, atomically.
--   { status: 'registered', id, join_token }  a new registration
--   { status: 'existing',   id, join_token, name }  this address was already registered
--   { status: 'full' }                        capacity reached (cohort and public seats together)
--   { status: 'closed' }                      not published, or not open to the public
-- The event row is locked so two registrations for the last seat cannot both succeed.
CREATE OR REPLACE FUNCTION public.register_event_publicly(
  p_event_id   uuid,
  p_name       text,
  p_email      text,
  p_responses  jsonb,
  p_student_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_status   text;
  v_public   boolean;
  v_capacity integer;
  v_taken    bigint;
  v_id       uuid;
  v_token    text;
  v_name     text;
BEGIN
  SELECT e.status, e.public_registration, e.capacity
    INTO v_status, v_public, v_capacity
    FROM public.events AS e
   WHERE e.id = p_event_id
     FOR UPDATE;

  IF NOT FOUND OR v_status <> 'published' OR NOT v_public THEN
    RETURN jsonb_build_object('status', 'closed');
  END IF;

  -- Capacity first, for every address: a full event answers "full" whether or not this address
  -- already registered, so the answer cannot be used to learn who did.
  IF v_capacity IS NOT NULL THEN
    SELECT (SELECT count(*) FROM public.event_registrations        WHERE event_id = p_event_id)
         + (SELECT count(*) FROM public.event_public_registrations WHERE event_id = p_event_id)
      INTO v_taken;
    IF v_taken >= v_capacity THEN
      RETURN jsonb_build_object('status', 'full');
    END IF;
  END IF;

  SELECT r.id, r.join_token, r.name INTO v_id, v_token, v_name
    FROM public.event_public_registrations AS r
   WHERE r.event_id = p_event_id AND r.email = p_email;
  IF FOUND THEN
    -- Link a signed-in registrant to a row first made without an account.
    IF p_student_id IS NOT NULL THEN
      UPDATE public.event_public_registrations
         SET student_id = p_student_id
       WHERE id = v_id AND student_id IS NULL;
    END IF;
    RETURN jsonb_build_object('status', 'existing', 'id', v_id, 'join_token', v_token, 'name', v_name);
  END IF;

  INSERT INTO public.event_public_registrations (event_id, name, email, responses, student_id)
  VALUES (p_event_id, p_name, p_email, COALESCE(p_responses, '{}'::jsonb), p_student_id)
  RETURNING id, join_token INTO v_id, v_token;

  RETURN jsonb_build_object('status', 'registered', 'id', v_id, 'join_token', v_token);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.register_event_publicly(uuid, text, text, jsonb, uuid) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.register_event_publicly(uuid, text, text, jsonb, uuid) TO service_role;

-- Seats taken per event, cohort and public together, for the public pages' "spots left".
CREATE OR REPLACE FUNCTION public.event_seats_taken(p_event_ids uuid[])
RETURNS TABLE(event_id uuid, taken bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT ids.id,
         (SELECT count(*) FROM public.event_registrations        r WHERE r.event_id = ids.id)
       + (SELECT count(*) FROM public.event_public_registrations p WHERE p.event_id = ids.id)
    FROM unnest(COALESCE(p_event_ids, '{}')) AS ids(id);
$$;

REVOKE EXECUTE ON FUNCTION public.event_seats_taken(uuid[]) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.event_seats_taken(uuid[]) TO service_role;
