import type { SupabaseClient } from '@supabase/supabase-js';
import { activateEnrollment, createAdmissionRecord, moveEnrollmentToCohort, recomputeEnrollmentAccessPublic } from '@/lib/db-payments';

/**
 * Put an existing student account into a bootcamp cohort without creating a duplicate
 * liability. Shared by the Cohorts screen's "assign student" action and by admitting
 * application form applicants who already have an account.
 *
 * - A student with an enrollment anywhere keeps that one row: it is moved to the new cohort
 *   (payment history, paid amounts and the agreed fee stay on it; the installments are rebuilt
 *   from the new cohort's dates), and a released row is
 *   reattached rather than replaced, so a re-added student is never put on a second
 *   full-fee schedule.
 * - Otherwise a pre-signup row for the cohort is activated, or a fresh one is created from
 *   the cohort's payment settings and activated.
 *
 * All enrollment work happens before students.cohort_id is updated.
 */
export async function assignStudentToCohort(
  db: SupabaseClient,
  input: { studentId: string; email: string; cohortId: string },
): Promise<void> {
  const { studentId, cohortId } = input;
  const email = input.email.toLowerCase();

  // Check if the student already has an active (post-signup) enrollment anywhere
  const { data: anyEnrollment, error: enrollmentLookupError } = await db
    .from('bootcamp_enrollments')
    .select('id, cohort_id, released_at')
    .eq('student_id', studentId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (enrollmentLookupError) throw enrollmentLookupError;

  let moved = false;

  if (anyEnrollment) {
    // Student already enrolled -- move the enrollment to the new cohort.
    // Payment history and paid amounts stay on the same row.
    // A previously released enrollment is reattached here rather than replaced,
    // which is what keeps a re-added student off a second full-fee schedule.
    const { error: claimError } = await db.rpc('claim_student_enrollment_model', {
      p_student_id: studentId,
      p_requested_model: 'bootcamp',
    });
    if (claimError) throw claimError;
    // The move also takes the new cohort's dates and rebuilds the unpaid installments from
    // them, keeping the agreed fee. It repoints students.cohort_id in the same transaction.
    if (anyEnrollment.cohort_id !== cohortId) {
      await moveEnrollmentToCohort(db, { enrollmentId: anyEnrollment.id, studentId, cohortId });
      moved = true;
    }
    if (anyEnrollment.released_at) {
      const { error: reattachError } = await db.rpc('reattach_released_enrollment', {
        p_enrollment_id: anyEnrollment.id,
      });
      if (reattachError) throw reattachError;
    }
  } else {
    // No existing enrollment -- create one fresh.

    // Case 1: pre-signup row exists for this cohort -- activate it
    const { data: presignup, error: presignupLookupError } = await db
      .from('bootcamp_enrollments')
      .select('id')
      .eq('email', email)
      .eq('cohort_id', cohortId)
      .is('student_id', null)
      .maybeSingle();
    if (presignupLookupError) throw presignupLookupError;

    if (presignup) {
      await activateEnrollment(db, email, cohortId, studentId);
    } else {
      // Case 2: no row at all -- create from cohort defaults then activate
      const [{ data: settings }, { data: cohortRow }] = await Promise.all([
        db.from('cohort_payment_settings').select('*').eq('cohort_id', cohortId).maybeSingle(),
        db.from('cohorts').select('start_date, end_date').eq('id', cohortId).maybeSingle(),
      ]);
      if (!settings?.total_fee || Number(settings.total_fee) <= 0) {
        throw new Error('Set payment settings for this cohort before assigning students.');
      }
      const depositRequired = Math.round(Number(settings.total_fee) * Number(settings.deposit_percent ?? 50)) / 100;
      const { error: claimError } = await db.rpc('claim_student_enrollment_model', {
        p_student_id: studentId,
        p_requested_model: 'bootcamp',
      });
      if (claimError) throw claimError;
      await createAdmissionRecord(db, {
        email,
        cohortId,
        totalFee:         Number(settings.total_fee),
        currency:         settings.currency ?? 'GHS',
        paymentPlan:      settings.payment_plan ?? 'flexible',
        depositRequired,
        bootcampStartsAt: cohortRow?.start_date ?? null,
        bootcampEndsAt:   cohortRow?.end_date ?? null,
      });
      await activateEnrollment(db, email, cohortId, studentId);
    }
  }

  // Enrollment confirmed -- now safe to update the real cohort pointer. A move already set it
  // in its own transaction.
  if (!moved) {
    const { error: assignErr } = await db
      .from('students')
      .update({ cohort_id: cohortId })
      .eq('id', studentId);
    if (assignErr) throw assignErr;
  }

  // Last, once the student's cohort and any reattachment are final: the recompute can move an
  // unpaid student to the outstanding cohort, so nothing may run after it. New enrollments were
  // already computed by activateEnrollment.
  if (anyEnrollment) {
    const { data: settings, error: settingsError } = await db
      .from('cohort_payment_settings')
      .select('post_bootcamp_access_months')
      .eq('cohort_id', cohortId)
      .maybeSingle();
    if (settingsError) throw settingsError;
    await recomputeEnrollmentAccessPublic(db, anyEnrollment.id, settings?.post_bootcamp_access_months ?? 3);
  }
}
