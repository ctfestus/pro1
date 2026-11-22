-- Group chat: one conversation per assignment and group, even when two members post first at once.
--
-- The group chat keeps its single conversation in one thread. The client starts it with the first
-- message (create_group_thread), but nothing stopped two members, or one member sending twice
-- quickly, from each creating a thread: the chat then flipped between them and messages seemed to
-- disappear. This makes the function find-or-create: under a lock on the assignment and group, an
-- existing (not deleted) thread gets the message as a reply instead of a second thread being made.
-- `existing` in the result tells the client to load the conversation it joined.
--
-- No unique index: groups that already have more than one thread (from before) keep them, and the
-- newest stays the one the chat shows, as listThreads orders by last_post_at.
--
-- Same signature, checks and grants as migration 151; only the find step is new.

BEGIN;

CREATE OR REPLACE FUNCTION public.create_group_thread(
  p_assignment_id uuid,
  p_group_id      uuid,
  p_author_id     uuid,
  p_title         text,
  p_body          text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_title  text := btrim(coalesce(p_title, ''));
  v_body   text := btrim(coalesce(p_body, ''));
  v_thread public.assignment_group_threads;
  v_post   public.assignment_group_posts;
BEGIN
  IF char_length(v_title) = 0 OR char_length(v_body) = 0 THEN
    RAISE EXCEPTION 'empty_content';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.assignments a
    WHERE a.id = p_assignment_id AND a.status = 'published' AND p_group_id = ANY(a.group_ids)
  ) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.group_members gm WHERE gm.group_id = p_group_id AND gm.student_id = p_author_id
  ) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  -- One creator at a time per assignment and group; the lock ends with the transaction.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_assignment_id::text || ':' || p_group_id::text, 0));

  SELECT * INTO v_thread FROM public.assignment_group_threads
  WHERE assignment_id = p_assignment_id AND group_id = p_group_id AND deleted_at IS NULL
  ORDER BY last_post_at DESC, id DESC
  LIMIT 1;

  IF FOUND THEN
    INSERT INTO public.assignment_group_posts (thread_id, author_id, body, is_opening)
    VALUES (v_thread.id, p_author_id, left(v_body, 4000), false)
    RETURNING * INTO v_post;
    RETURN jsonb_build_object('thread', to_jsonb(v_thread), 'post', to_jsonb(v_post), 'existing', true);
  END IF;

  INSERT INTO public.assignment_group_threads (assignment_id, group_id, author_id, title)
  VALUES (p_assignment_id, p_group_id, p_author_id, left(v_title, 200))
  RETURNING * INTO v_thread;

  INSERT INTO public.assignment_group_posts (thread_id, author_id, body, is_opening)
  VALUES (v_thread.id, p_author_id, left(v_body, 4000), true)
  RETURNING * INTO v_post;

  RETURN jsonb_build_object('thread', to_jsonb(v_thread), 'post', to_jsonb(v_post), 'existing', false);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.create_group_thread(uuid, uuid, uuid, text, text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.create_group_thread(uuid, uuid, uuid, text, text) TO service_role;

COMMIT;
