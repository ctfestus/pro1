-- 207: delete a bootcamp cohort in one transaction.
--
-- Deleting a cohort takes several steps, because two references refuse the delete rather than
-- follow it (payments is ON DELETE RESTRICT, payment_config.outstanding_cohort_id has no rule at
-- all) and one representation of an assignment is not a foreign key at all. Run as separate
-- statements over PostgREST, a failure part-way through leaves receipts deleted and the cohort
-- still standing, with no way back. In here they are one transaction: all of it, or none.
--
-- The denormalized half matters as much as the cascade. cohort_assignments rows go with the cohort
-- because they reference it, but the same assignment is also recorded as a uuid inside each content
-- table's cohort_ids array, which no cascade touches. Left behind, those ids grant nothing (no
-- student has that cohort any more) but they do keep counting: available_to_everyone carries a
-- CHECK that a public item holds no cohorts, so an orphan id can leave a course permanently unable
-- to be opened to everyone.
--
-- Student accounts are deliberately NOT deleted here. Removing a login is an Auth API call, not
-- SQL, so it can never be part of this transaction. The route does that afterwards, once this has
-- committed, so the irreversible half is last and everything before it is all-or-nothing.

CREATE OR REPLACE FUNCTION public.delete_bootcamp_cohort(p_cohort_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_kind            text;
  v_payments        integer := 0;
  v_untagged        integer := 0;
  v_released        integer := 0;
  v_member_ids      uuid[];
  v_table           text;
  v_rows            integer;
  -- Every table that records a cohort assignment as an array member rather than a row.
  v_content_tables  text[] := ARRAY[
    'forms', 'courses', 'events', 'virtual_experiences', 'certifications', 'assignments',
    'communities', 'announcements', 'recordings', 'schedules', 'learning_paths'
  ];
BEGIN
  SELECT cohort_kind INTO v_kind FROM public.cohorts WHERE id = p_cohort_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'cohort % not found', p_cohort_id; END IF;
  IF v_kind <> 'bootcamp' THEN
    RAISE EXCEPTION 'cohort % is not a bootcamp intake', p_cohort_id USING ERRCODE = 'check_violation';
  END IF;

  -- Defence in depth: the route refuses these too, but a plan's payment history hangs off the plan
  -- through several restricted references and must never be reachable from here.
  IF EXISTS (SELECT 1 FROM public.subscription_plans WHERE cohort_id = p_cohort_id)
     OR EXISTS (SELECT 1 FROM public.individual_subscriptions WHERE cohort_id = p_cohort_id) THEN
    RAISE EXCEPTION 'cohort % backs a subscription plan', p_cohort_id USING ERRCODE = 'check_violation';
  END IF;

  -- Who this delete actually detaches, captured under lock so the caller acts on the set that was
  -- really affected rather than on a list read moments earlier. Locking first and aggregating
  -- second because FOR UPDATE and array_agg cannot share a query level.
  PERFORM 1 FROM public.students
   WHERE (cohort_id = p_cohort_id OR original_cohort_id = p_cohort_id)
     AND role = 'student'
   ORDER BY id
     FOR UPDATE;

  SELECT COALESCE(array_agg(id ORDER BY id), '{}'::uuid[]) INTO v_member_ids
    FROM public.students
   WHERE (cohort_id = p_cohort_id OR original_cohort_id = p_cohort_id)
     AND role = 'student';

  -- A student held over an unpaid balance sits in the outstanding-payments cohort with
  -- original_cohort_id pointing back here. The foreign key would null only that pointer, leaving
  -- them parked in the outstanding cohort with nowhere to be restored to, and a non-null cohort_id
  -- blocks any later move onto an individual subscription. Release them properly instead. This runs
  -- before the cohort goes so trg_prune_group_memberships_on_cohort_change (migration 206) sees the
  -- hold already lifted and treats it as the departure it now is.
  UPDATE public.students
     SET cohort_id = NULL, original_cohort_id = NULL, enrollment_model = NULL
   WHERE original_cohort_id = p_cohort_id;
  GET DIAGNOSTICS v_released = ROW_COUNT;

  UPDATE public.payment_config SET outstanding_cohort_id = NULL
   WHERE outstanding_cohort_id = p_cohort_id;

  DELETE FROM public.payments WHERE cohort_id = p_cohort_id;
  GET DIAGNOSTICS v_payments = ROW_COUNT;

  FOREACH v_table IN ARRAY v_content_tables LOOP
    EXECUTE format(
      'UPDATE public.%I SET cohort_ids = array_remove(cohort_ids, $1) WHERE $1 = ANY(cohort_ids)',
      v_table
    ) USING p_cohort_id;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    v_untagged := v_untagged + v_rows;
  END LOOP;

  DELETE FROM public.cohorts WHERE id = p_cohort_id;

  RETURN jsonb_build_object('ok', true, 'paymentsDeleted', v_payments,
                            'contentUntagged', v_untagged, 'holdsReleased', v_released,
                            'memberIds', to_jsonb(v_member_ids));
END;
$$;

REVOKE EXECUTE ON FUNCTION public.delete_bootcamp_cohort(uuid) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.delete_bootcamp_cohort(uuid) TO service_role;

-- ── one-time cleanup of orphan cohort ids left by earlier deletes ──
--
-- To see what this will remove before running the migration, per table:
--
--   SELECT id, title, cohort_ids FROM public.courses c
--    WHERE EXISTS (
--      SELECT 1 FROM unnest(c.cohort_ids) AS cid
--       WHERE NOT EXISTS (SELECT 1 FROM public.cohorts WHERE id = cid)
--    );
DO $$
DECLARE
  v_table text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'forms', 'courses', 'events', 'virtual_experiences', 'certifications', 'assignments',
    'communities', 'announcements', 'recordings', 'schedules', 'learning_paths'
  ] LOOP
    EXECUTE format($fmt$
      UPDATE public.%I t
         SET cohort_ids = COALESCE((
               SELECT array_agg(cid)
                 FROM unnest(t.cohort_ids) AS cid
                WHERE EXISTS (SELECT 1 FROM public.cohorts WHERE id = cid)
             ), '{}'::uuid[])
       WHERE EXISTS (
               SELECT 1 FROM unnest(t.cohort_ids) AS cid
                WHERE NOT EXISTS (SELECT 1 FROM public.cohorts WHERE id = cid)
             )
    $fmt$, v_table);
  END LOOP;
END $$;
