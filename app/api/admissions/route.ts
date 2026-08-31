import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { requireRole, isAuthError } from '@/lib/api-auth';
import { revalidatePricingPage } from '@/lib/revalidate-pricing';
import { admitStudents } from '@/lib/admit-students';
import { provisionIndividualStudent } from '@/lib/provision-individual-student';

export const dynamic = 'force-dynamic';

// Content tables a reusable subscription plan can tag with its shared access cohort.
// Enrolling in a learning_paths row doesn't need its own per-item
// tagging: courses/virtual_experiences/certifications already grant access through
// any published learning path containing them, so tagging just the path cascades to
// everything inside it. cohort_assignments.content_type has no 'learning_path' value
// (see festman-fresh-schema.sql), so that bookkeeping upsert is skipped for paths --
// same as POST /api/cohort-content-assignment already does.
/** What to call each type in a message a person reads. */
const CONTENT_LABEL: Record<string, string> = {
  courses: 'course',
  virtual_experiences: 'virtual experience',
  certifications: 'certification',
  learning_paths: 'learning path',
};

const SUBSCRIPTION_PLAN_CONTENT: Record<string, {
  selectCols: string;
  ownerCol: string;
  caContentType: string | null;
  notify: (db: ReturnType<typeof adminClient>, content: any, cohortId: string) => Promise<void>;
}> = {
  courses: {
    selectCols: 'id, title, slug, status, cohort_ids, available_to_everyone, user_id',
    ownerCol: 'user_id',
    caContentType: 'course',
    notify: async (db, content, cohortId) => {
      const { sendAssignmentNotifications } = await import('@/lib/send-assignment-notification');
      await sendAssignmentNotifications({ cohortIds: [cohortId], title: content.title, slug: content.slug, contentType: 'course' });
    },
  },
  virtual_experiences: {
    selectCols: 'id, title, slug, status, cohort_ids, available_to_everyone, user_id',
    ownerCol: 'user_id',
    caContentType: 'virtual_experience',
    notify: async (db, content, cohortId) => {
      const { sendAssignmentNotifications } = await import('@/lib/send-assignment-notification');
      await sendAssignmentNotifications({ cohortIds: [cohortId], title: content.title, slug: content.slug, contentType: 'virtual_experience' });
    },
  },
  certifications: {
    // available_to_everyone is read by the open-access guard below; without it here the
    // guard silently never fires.
    selectCols: 'id, title, slug, status, cohort_ids, available_to_everyone, user_id',
    ownerCol: 'user_id',
    caContentType: 'certification',
    notify: async (db, content, cohortId) => {
      const { sendAssignmentNotifications } = await import('@/lib/send-assignment-notification');
      await sendAssignmentNotifications({ cohortIds: [cohortId], title: content.title, slug: content.slug, contentType: 'certification' });
    },
  },
  learning_paths: {
    selectCols: 'id, title, description, item_ids, status, cohort_ids, available_to_everyone, instructor_id',
    ownerCol: 'instructor_id',
    caContentType: null,
    notify: async (db, content, cohortId) => {
      const { sendPathNotification } = await import('@/lib/send-path-notification');
      const result = await sendPathNotification(db, content, [cohortId]);
      if (result.failed > 0) throw new Error(`Failed to send ${result.failed} learning path notification(s)`);
    },
  },
};

function adminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  if (!url || !key) throw new Error('Supabase service role key not configured');
  return createClient(url, key);
}

export async function POST(req: NextRequest) {
  const auth = await requireRole(req, ['instructor', 'admin']);
  if (isAuthError(auth)) return auth.error;

  let body: any;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { cohortId, rows } = body;
  const db = adminClient();

  if (body.action === 'create-individual-student') {
    if (!body.email?.trim()) return NextResponse.json({ error: 'Email is required' }, { status: 400 });
    try {
      return NextResponse.json(await provisionIndividualStudent(db, {
        email: body.email,
        fullName: body.fullName,
      }));
    } catch (err: any) {
      const conflict = err?.code === '23505' || String(err?.message ?? '').includes('already belongs');
      return NextResponse.json({ error: err.message ?? 'Failed to create individual student' }, { status: conflict ? 409 : 500 });
    }
  }

  if (body.action === 'save-settings') {
    if (!cohortId || !body.settings) {
      return NextResponse.json({ error: 'cohortId and settings are required' }, { status: 400 });
    }

    const totalFee = Number(body.settings.total_fee);
    if (!totalFee || totalFee <= 0) {
      return NextResponse.json({ error: 'Total fee must be greater than 0.' }, { status: 400 });
    }

    const graceDaysRaw = body.settings.grace_period_days;
    let gracePeriodDays: number | null = null;
    if (graceDaysRaw !== '' && graceDaysRaw != null) {
      const parsed = Number(graceDaysRaw);
      if (!Number.isInteger(parsed) || parsed < 0 || parsed > 365) {
        return NextResponse.json({ error: 'Grace period must be a whole number between 0 and 365.' }, { status: 400 });
      }
      gracePeriodDays = parsed;
    }

    const payload = {
      cohort_id:                   cohortId,
      total_fee:                   totalFee,
      currency:                    String(body.settings.currency || 'GHS').trim() || 'GHS',
      deposit_percent:             Number(body.settings.deposit_percent ?? 50),
      payment_plan:                body.settings.payment_plan || 'flexible',
      installment_count:           Number(body.settings.installment_count ?? 3),
      post_bootcamp_access_months: Number(body.settings.post_bootcamp_access_months ?? 3),
      grace_period_days:           gracePeriodDays,
      updated_at:                  new Date().toISOString(),
    };

    const { error } = await db
      .from('cohort_payment_settings')
      .upsert(payload, { onConflict: 'cohort_id' });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    // Cascade start/end date to all enrollment rows for this cohort.
    // Pre-signup rows: updated so installments generate with the correct date at signup.
    // Post-signup rows: bootcamp_ends_at drives access_until -- update it and recompute
    // access for each. Installment due dates are NOT touched here; use the Edit
    // modal's installments section to adjust those individually.
    const startDate = body.settings.start_date ?? null;
    const endDate   = body.settings.end_date   ?? null;
    if (startDate) {
      await db
        .from('bootcamp_enrollments')
        .update({ bootcamp_starts_at: startDate, bootcamp_ends_at: endDate, updated_at: new Date().toISOString() })
        .eq('cohort_id', cohortId);

      // Recompute access for every post-signup enrollment so access_until reflects
      // the new end date.
      const { data: postSignup } = await db
        .from('bootcamp_enrollments')
        .select('id')
        .eq('cohort_id', cohortId)
        .not('student_id', 'is', null)
        // Released rows are history (migration 171); do not recompute access on them.
        .is('released_at', null);

      if (postSignup && postSignup.length > 0) {
        const postBootcampMonths = Number(body.settings.post_bootcamp_access_months ?? 3);
        const { recomputeEnrollmentAccessPublic } = await import('@/lib/db-payments');
        await Promise.all(
          postSignup.map(e => recomputeEnrollmentAccessPublic(db, e.id, postBootcampMonths))
        );
      }
    }

    return NextResponse.json({ ok: true, settings: payload });
  }

  if (body.action === 'assign-student') {
    const { studentId } = body;
    if (!studentId || cohortId === undefined) {
      return NextResponse.json({ error: 'studentId and cohortId are required' }, { status: 400 });
    }

    try {
      const { data: student } = await db
        .from('students')
        .select('email')
        .eq('id', studentId)
        .single();
      if (!student?.email) throw new Error('Student email not found');

      const email = student.email.toLowerCase();

      // Do all enrollment work BEFORE touching students.cohort_id
      if (cohortId) {
        const { createAdmissionRecord, activateEnrollment } = await import('@/lib/db-payments');

        // Check if the student already has an active (post-signup) enrollment anywhere
        const { data: anyEnrollment } = await db
          .from('bootcamp_enrollments')
          .select('id, cohort_id, released_at')
          .eq('student_id', studentId)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (anyEnrollment) {
          // Student already enrolled -- just move the enrollment to the new cohort.
          // Payment history, installments, and paid amounts stay on the same row.
          // A previously released enrollment is reattached here rather than replaced,
          // which is what keeps a re-added student off a second full-fee schedule.
          const { error: claimError } = await db.rpc('claim_student_enrollment_model', {
            p_student_id: studentId,
            p_requested_model: 'bootcamp',
          });
          if (claimError) throw claimError;
          if (anyEnrollment.cohort_id !== cohortId) {
            const { error: moveError } = await db
              .from('bootcamp_enrollments')
              .update({ cohort_id: cohortId, updated_at: new Date().toISOString() })
              .eq('id', anyEnrollment.id);
            if (moveError) throw moveError;
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
          const { data: presignup } = await db
            .from('bootcamp_enrollments')
            .select('id')
            .eq('email', email)
            .eq('cohort_id', cohortId)
            .is('student_id', null)
            .maybeSingle();

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
      }

      if (cohortId) {
        // Enrollment confirmed -- now safe to update the real cohort pointer.
        const { error: assignErr } = await db
          .from('students')
          .update({ cohort_id: cohortId })
          .eq('id', studentId);
        if (assignErr) throw assignErr;
      } else {
        // Explicit removal releases the bootcamp model and detaches the current
        // enrollment link while preserving all financial rows as history.
        const { error: releaseError } = await db.rpc('release_student_from_bootcamp', {
          p_student_id: studentId,
        });
        if (releaseError) throw releaseError;
      }

      return NextResponse.json({ ok: true });
    } catch (err: any) {
      const conflict = err?.code === '23505' || String(err?.message ?? '').includes('already belongs');
      return NextResponse.json({ error: err.message ?? 'Failed to assign student' }, { status: conflict ? 409 : 500 });
    }
  }

  if (body.action === 'add-subscription-plan-content' || body.action === 'remove-subscription-plan-content') {
    const { planId, contentTable, contentId } = body;
    if (!planId || !contentId) {
      return NextResponse.json({ error: 'planId and contentId are required' }, { status: 400 });
    }
    const contentConfig = SUBSCRIPTION_PLAN_CONTENT[contentTable];
    if (!contentConfig) {
      return NextResponse.json({ error: 'Invalid content type' }, { status: 400 });
    }

    try {
      const [{ data: content, error: contentError }, { data: plan, error: planError }] = await Promise.all([
        db.from(contentTable).select(contentConfig.selectCols).eq('id', contentId).single(),
        db.from('subscription_plans')
          .select('id, cohort_id, status')
          .eq('id', planId)
          .maybeSingle(),
      ]);
      if (contentError || !content) throw contentError ?? new Error('Content not found');
      if (planError) throw planError;
      if (!plan) return NextResponse.json({ error: 'Subscription plan not found.' }, { status: 404 });
      if (auth.role !== 'admin' && (content as any)[contentConfig.ownerCol] !== auth.user.id) {
        return NextResponse.json({ error: 'You do not have permission to manage this content.' }, { status: 403 });
      }

      const adding = body.action === 'add-subscription-plan-content';
      if (adding && (content as any).status !== 'published') {
        return NextResponse.json({ error: 'Only published content can be added.' }, { status: 400 });
      }
      // Open to everyone and sold in a plan are contradictory: a plan grants access by tagging
      // the content with its cohort, and open access ignores cohorts entirely. The author can
      // resolve that from the editor now, but only by asking -- clearing it quietly would take
      // the content away from every learner relying on the open flag, part-way through included.
      // Every one of the four types carries this flag, and every one carries a CHECK that a
      // public item holds no cohorts. A plan grants access by adding its cohort, so attaching
      // public content is not merely contradictory -- the tag update fails at the database,
      // after the coverage row is already written.
      if (adding && (content as any).available_to_everyone === true) {
        if (body.clearPublicAccess !== true) {
          return NextResponse.json({
            error: `This ${CONTENT_LABEL[contentTable] ?? 'content'} is already available to everyone. Restrict it to a cohort first, then add it to the subscription plan.`,
            code: 'needs_private',
          }, { status: 400 });
        }
        // Acted on inside the transaction below, so a later failure cannot leave the content
        // closed to its learners while never joining the plan.
      }

      // One transaction for all four writes: closing open access, the coverage row, the cohort
      // tag that actually grants access, and the assignment bookkeeping. As separate calls, a
      // failure part-way left the earlier ones standing -- and the tag genuinely does fail for
      // open content, because every content table forbids a public item holding cohorts.
      const { error: applyError } = await db.rpc('set_subscription_plan_content', {
        p_plan_id: plan.id,
        p_content_table: contentTable,
        p_content_id: contentId,
        p_actor_id: auth.user.id,
        p_add: adding,
        p_clear_public: adding && body.clearPublicAccess === true,
        p_ca_content_type: contentConfig.caContentType,
      });
      if (applyError) throw applyError;

      // Here, not at the end. The catalogue has changed; what follows is notification, and both
      // an inactive plan (which returns early) and a failed send would otherwise leave the
      // public page serving the old counts.
      revalidatePricingPage();

      // Everything past this point is telling people about a change that has already happened.
      // Reporting a failed send as a failed attachment was worse than the silence it replaced:
      // the editor would keep its stale open-access state, and its next save would try to write
      // that flag back onto content the database now forbids from carrying it.
      let notificationWarning: string | null = null;
      if (adding) {
        try {
          const { data: currentPlan, error: currentPlanError } = await db
            .from('subscription_plans')
            .select('status')
            .eq('id', plan.id)
            .single();
          if (currentPlanError) throw currentPlanError;

          // An inactive plan has no learners to tell. Not an early return any more: the caller
          // still needs the applied answer below.
          if (currentPlan.status === 'active') {
            const { data: coverage, error: coverageReadError } = await db
              .from('subscription_plan_content')
              .select('id, notified_at')
              .eq('plan_id', plan.id)
              .eq('content_table', contentTable)
              .eq('content_id', contentId)
              .single();
            if (coverageReadError) throw coverageReadError;
            if (!coverage.notified_at) {
              await contentConfig.notify(db, content, plan.cohort_id);
              const { error: notifyStampError } = await db.from('subscription_plan_content')
                .update({ notified_at: new Date().toISOString() })
                .eq('id', coverage.id)
                .is('notified_at', null);
              if (notifyStampError) throw notifyStampError;
            }
          }
        } catch (notifyError: any) {
          console.error(`[admissions/${body.action}] notification`, notifyError);
          notificationWarning =
            'The change was saved. The email to learners on this plan could not be sent.';
        }
      }

      // applied says the access change is committed, whatever happened to the email. The picker
      // keys its own update on this rather than on the absence of an error.
      return NextResponse.json({
        ok: true,
        applied: true,
        ...(notificationWarning ? { notificationWarning } : {}),
      });
    } catch (err: any) {
      console.error(`[admissions/${body.action}]`, err);
      return NextResponse.json({ error: err.message ?? 'Failed to update subscription content' }, { status: 500 });
    }
  }

  if (!cohortId || !Array.isArray(rows) || rows.length === 0) {
    return NextResponse.json({ error: 'cohortId and rows are required' }, { status: 400 });
  }

  const result = await admitStudents(db, cohortId, rows);
  if ('error' in result) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  return NextResponse.json({ ok: true, ...result });
}

// GET /api/admissions?cohortId=xxx
export async function GET(req: NextRequest) {
  const auth = await requireRole(req, ['instructor', 'admin']);
  if (isAuthError(auth)) return auth.error;

  const cohortId = req.nextUrl.searchParams.get('cohortId');
  const db = adminClient();

  const { data: settings, error: settingsError } = cohortId
    ? await db.from('cohort_payment_settings').select('*').eq('cohort_id', cohortId).maybeSingle()
    : { data: null, error: null };
  if (settingsError) return NextResponse.json({ error: settingsError.message }, { status: 500 });

  // Return the full admission history for this cohort, including records that
  // have already been linked to provisioned student accounts.
  const query = db
    .from('bootcamp_enrollments')
    .select(`
      id,
      student_id,
      email,
      full_name,
      total_fee,
      currency,
      payment_plan,
      deposit_required,
      amount_paid_initial,
      paid_at,
      payment_method,
      payment_reference,
      notes,
      created_at,
      student:students(
        id,
        full_name,
        email,
        onboarding_done,
        account_provisioned_at,
        setup_email_sent_at,
        password_setup_started_at,
        password_set_at,
        onboarding_completed_at,
        last_login_at
      )
    `)
    .order('created_at', { ascending: false });

  if (cohortId) query.eq('cohort_id', cohortId);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ admissions: data ?? [], intakes: data ?? [], settings });
}
