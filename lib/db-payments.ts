import { SupabaseClient } from '@supabase/supabase-js';
import { computeAccess, EnrollmentState } from './enrollment-access';
import { Resend } from 'resend';
import { getTenantSettings } from './get-tenant-settings';
import { paymentReceiptEmail } from './email-templates';
import { sendOverdueNotice, loadOverdueNoticeSettings } from './overdue-notice';

const resend = new Resend(process.env.RESEND_API_KEY);

// ---
// Types
// ---

export interface EnrollmentRow {
  enrollment_id: string;
  student_id: string | null;
  student_name: string;
  email: string;
  cohort_id: string;
  cohort_name: string;
  original_cohort_id: string | null;
  original_cohort_name: string | null;
  payment_plan: string;
  total_fee: number;
  deposit_required: number;
  paid_total: number;
  balance: number;
  access_status: string;
  access_until: string | null;
  next_due_date: string | null;
  bootcamp_starts_at: string | null;
  bootcamp_ends_at: string | null;
  payment_exempt: boolean;
  currency: string;
  is_presignup: boolean;
}

export interface RecordPaymentInput {
  enrollmentId: string;
  amount: number;
  paidAt?: string;
  method?: string;
  reference?: string;
  notes?: string;
  payerEmail: string;
  cohortId: string;
  studentId?: string;
  confirmationId?: string;
}

// ---
// CohortAction
// Pure decision helper -- no DB access, no side effects.
// Single source of truth for move/restore rules.
// ---

export type CohortAction =
  | { type: 'move';    studentId: string; fromCohortId: string; toCohortId: string }
  | { type: 'restore'; studentId: string; toCohortId: string };

// Exported for the daily outstanding sweep (app/api/cron/outstanding-sweep). The sweep applies the
// same move/restore rules as the Payments page rather than restating them, so the two can never
// disagree about who belongs in the outstanding cohort.
export function getOutstandingCohortAction(input: {
  studentId: string | null;
  accessStatus: string;
  studentCohortId: string;
  studentOriginalCohortId: string | null;
  paymentExempt: boolean;
  outstandingCohortId: string | null;
}): CohortAction | null {
  const { studentId, accessStatus, studentCohortId, studentOriginalCohortId, paymentExempt, outstandingCohortId } = input;
  if (!studentId || !outstandingCohortId) return null;

  if (
    !paymentExempt &&
    !studentOriginalCohortId &&
    studentCohortId !== outstandingCohortId &&
    (accessStatus === 'overdue' || accessStatus === 'pending_deposit')
  ) {
    return { type: 'move', studentId, fromCohortId: studentCohortId, toCohortId: outstandingCohortId };
  }

  if (
    studentOriginalCohortId &&
    studentCohortId === outstandingCohortId &&
    (accessStatus === 'active' || accessStatus === 'completed' || accessStatus === 'waived')
  ) {
    return { type: 'restore', studentId, toCohortId: studentOriginalCohortId };
  }

  return null;
}

export async function applyCohortAction(db: SupabaseClient, action: CohortAction): Promise<void> {
  if (action.type === 'move') {
    const { error } = await db.from('students').update({
      original_cohort_id: action.fromCohortId,
      cohort_id:          action.toCohortId,
    }).eq('id', action.studentId);
    if (error) throw error;
  } else {
    const { error } = await db.from('students').update({
      cohort_id:          action.toCohortId,
      original_cohort_id: null,
    }).eq('id', action.studentId);
    if (error) throw error;
  }
}

// ---
// getEnrollmentRows
// Returns all post-signup enrollments enriched with cohort and student info.
// ---

export async function getEnrollmentRows(db: SupabaseClient): Promise<{ rows: EnrollmentRow[]; cohorts: { id: string; name: string; cohort_kind: string }[] }> {
  const [enrollRes, cohortsRes, settingsRes, psRes] = await Promise.all([
    db
      .from('bootcamp_enrollments')
      .select(`
        id,
        student_id,
        cohort_id,
        email,
        full_name,
        total_fee,
        currency,
        payment_plan,
        deposit_required,
        paid_total,
        access_status,
        access_until,
        bootcamp_starts_at,
        bootcamp_ends_at,
        students ( full_name, email, original_cohort_id, payment_exempt, cohort_id ),
        cohorts ( name ),
        payment_installments ( due_date, status )
      `)
      // Released enrollments (migration 171) are retained as financial history, not live
      // enrollments. Including them would list a removed student under the cohort they
      // left, with a balance and a reminder button, and recompute access on that row.
      .is('released_at', null)
      .order('created_at', { ascending: false }),
    db.from('cohorts').select('id, name, cohort_kind').order('name'),
    db.from('cohort_payment_settings').select('cohort_id, post_bootcamp_access_months, grace_period_days'),
    db.from('payment_config').select('outstanding_cohort_id').eq('id', 'default').maybeSingle(),
  ]);

  const cohortMap: Record<string, string> = {};
  for (const c of cohortsRes.data ?? []) cohortMap[c.id] = c.name;

  const settingsMap: Record<string, number> = {};
  const gracePeriodMap: Record<string, number | null> = {};
  for (const s of settingsRes.data ?? []) {
    settingsMap[s.cohort_id] = s.post_bootcamp_access_months ?? 3;
    gracePeriodMap[s.cohort_id] = s.grace_period_days ?? null;
  }

  const outstandingCohortId: string | null = (psRes as any).data?.outstanding_cohort_id ?? null;

  const toUpdate: { id: string; access_status: string; access_until: string | null }[] = [];

  const rows: EnrollmentRow[] = (enrollRes.data ?? []).map((e: any) => {
    const isPresignup     = !e.student_id;
    const student         = e.students ?? {};
    const rawInstallments = e.payment_installments ?? [];

    const nextUnpaid = rawInstallments
      .filter((i: any) => i.status === 'unpaid' || i.status === 'partial')
      .sort((a: any, b: any) => new Date(a.due_date).getTime() - new Date(b.due_date).getTime())[0];

    const originalCohortId = student.original_cohort_id ?? null;
    const resolvedCohortId = isPresignup ? e.cohort_id : (student.cohort_id ?? e.cohort_id);
    const paymentExempt    = student.payment_exempt ?? false;

    const state: EnrollmentState = {
      payment_plan:                e.payment_plan as any,
      total_fee:                   Number(e.total_fee),
      deposit_required:            Number(e.deposit_required),
      paid_total:                  Number(e.paid_total),
      bootcamp_ends_at:            e.bootcamp_ends_at ? new Date(e.bootcamp_ends_at) : null,
      post_bootcamp_access_months: settingsMap[e.cohort_id] ?? 3,
      grace_period_days:           gracePeriodMap[e.cohort_id] ?? null,
      installments:                rawInstallments.map((i: any) => ({ due_date: new Date(i.due_date), status: i.status })),
    };
    const liveAccess = computeAccess(state);
    const liveStatus = liveAccess.access_status;
    const liveUntil  = liveAccess.access_until ? liveAccess.access_until.toISOString().slice(0, 10) : null;

    if (liveStatus !== e.access_status || liveUntil !== (e.access_until ?? null)) {
      toUpdate.push({ id: e.id, access_status: liveStatus, access_until: liveUntil });
    }

    return {
      enrollment_id:        e.id,
      student_id:           e.student_id ?? null,
      student_name:         isPresignup ? (e.full_name ?? '') : (student.full_name ?? ''),
      email:                isPresignup ? e.email : (student.email ?? e.email),
      cohort_id:            resolvedCohortId,
      cohort_name:          cohortMap[resolvedCohortId] ?? 'Unknown',
      original_cohort_id:   originalCohortId,
      original_cohort_name: originalCohortId ? (cohortMap[originalCohortId] ?? 'Unknown') : null,
      payment_plan:         e.payment_plan,
      total_fee:            Number(e.total_fee),
      deposit_required:     Number(e.deposit_required),
      paid_total:           Number(e.paid_total),
      balance:              Math.max(0, Number(e.total_fee) - Number(e.paid_total)),
      access_status:        liveStatus,
      access_until:         liveUntil,
      next_due_date:        nextUnpaid?.due_date ?? null,
      bootcamp_starts_at:   e.bootcamp_starts_at ?? null,
      bootcamp_ends_at:     e.bootcamp_ends_at ?? null,
      payment_exempt:       paymentExempt,
      currency:             e.currency ?? 'GHS',
      is_presignup:         isPresignup,
    };
  });

  // Persist changed access statuses -- fire-and-forget, non-blocking
  if (toUpdate.length > 0) {
    Promise.all(
      toUpdate.map(u => db.from('bootcamp_enrollments').update({
        access_status: u.access_status,
        access_until:  u.access_until,
        updated_at:    new Date().toISOString(),
      }).eq('id', u.id))
    ).catch(() => {});
  }

  // Collect cohort actions using in-memory data (no extra DB queries)
  const cohortActions: CohortAction[] = rows
    .filter(r => !r.is_presignup)
    .map(r => getOutstandingCohortAction({
      studentId:               r.student_id,
      accessStatus:            r.access_status,
      studentCohortId:         r.cohort_id,
      studentOriginalCohortId: r.original_cohort_id,
      paymentExempt:           r.payment_exempt,
      outstandingCohortId,
    }))
    .filter((a): a is CohortAction => a !== null);

  // Apply cohort moves; only patch rows where the DB write actually succeeded
  if (cohortActions.length > 0) {
    const results = await Promise.allSettled(cohortActions.map(a => applyCohortAction(db, a)));

    for (let i = 0; i < cohortActions.length; i++) {
      if (results[i].status !== 'fulfilled') continue;
      const action = cohortActions[i];
      const row = rows.find(r => r.student_id === action.studentId);
      if (!row) continue;
      if (action.type === 'move') {
        row.original_cohort_id   = action.fromCohortId;
        row.original_cohort_name = cohortMap[action.fromCohortId] ?? 'Unknown';
        row.cohort_id            = action.toCohortId;
        row.cohort_name          = cohortMap[action.toCohortId] ?? 'Unknown';
      } else {
        row.cohort_id            = action.toCohortId;
        row.cohort_name          = cohortMap[action.toCohortId] ?? 'Unknown';
        row.original_cohort_id   = null;
        row.original_cohort_name = null;
      }
    }
  }

  return { rows, cohorts: cohortsRes.data ?? [] };
}

// ---
// createAdmissionRecord
// Creates or updates an enrollment row for an admitted email.
// New rows start as pre-signup (student_id = null), while existing provisioned
// rows keep their student_id and only have admission/payment fields refreshed.
// ---

export async function createAdmissionRecord(
  db: SupabaseClient,
  input: {
    email: string;
    fullName?: string | null;
    cohortId: string;
    totalFee: number;
    currency?: string;
    paymentPlan: 'full' | 'flexible' | 'sponsored' | 'waived';
    depositRequired: number;
    amountPaidInitial?: number;
    paidAt?: string | null;
    paymentMethod?: string | null;
    paymentReference?: string | null;
    notes?: string | null;
    bootcampStartsAt?: string | null;
    bootcampEndsAt?: string | null;
  },
): Promise<string> {
  const email = input.email.toLowerCase();
  const amountPaid = input.amountPaidInitial ?? 0;

  const { data: existing } = await db
    .from('bootcamp_enrollments')
    .select('id')
    .eq('email', email)
    .eq('cohort_id', input.cohortId)
    .maybeSingle();

  const payload: any = {
    email,
    full_name:           input.fullName ?? null,
    cohort_id:           input.cohortId,
    total_fee:           input.totalFee,
    currency:            input.currency ?? 'GHS',
    payment_plan:        input.paymentPlan,
    deposit_required:    input.depositRequired,
    amount_paid_initial: amountPaid,
    paid_at:             input.paidAt ?? null,
    payment_method:      input.paymentMethod ?? null,
    payment_reference:   input.paymentReference ?? null,
    notes:               input.notes ?? null,
    paid_total:          amountPaid,
    access_status:       'pending_deposit',
    bootcamp_starts_at:  input.bootcampStartsAt ?? null,
    bootcamp_ends_at:    input.bootcampEndsAt ?? null,
    updated_at:          new Date().toISOString(),
  };

  if (existing?.id) {
    // If a payment record already exists, treat amount_paid_initial as immutable --
    // do not update it or paid_total to avoid desyncing payment history from the enrollment total.
    const { data: existingPayment } = await db
      .from('payments')
      .select('id')
      .eq('enrollment_id', existing.id)
      .maybeSingle();

    const updatePayload = existingPayment
      ? (({ amount_paid_initial, paid_total, paid_at, payment_method, payment_reference, access_status, ...rest }) => rest)(payload)
      : (({ access_status, ...rest }) => rest)(payload);

    const { error } = await db
      .from('bootcamp_enrollments')
      .update(updatePayload)
      .eq('id', existing.id);
    if (error) throw error;
    return existing.id;
  }

  const { data, error } = await db
    .from('bootcamp_enrollments')
    .insert(payload)
    .select('id')
    .single();
  if (error) throw error;
  return data.id;
}

// ---
// activateEnrollment
// Called from auth/callback when a student signs up.
// Sets student_id on the pre-signup row, generates installments,
// applies any initial payment, and computes access_status.
// ---

export async function activateEnrollment(
  db: SupabaseClient,
  email: string,
  cohortId: string,
  studentId: string,
): Promise<void> {
  const { data: enrollment, error } = await db
    .from('bootcamp_enrollments')
    .select('id, student_id, total_fee, deposit_required, payment_plan, amount_paid_initial, bootcamp_starts_at, cohort_id')
    .eq('email', email.toLowerCase())
    .eq('cohort_id', cohortId)
    .maybeSingle();

  if (error) throw error;
  if (!enrollment) throw new Error('No admission record found for this email and cohort.');
  if (enrollment.student_id && enrollment.student_id !== studentId) {
    throw new Error('This admission record is already linked to a different student account.');
  }

  // Claim only after read-only validation, immediately before the first bootcamp
  // mutation. A missing or conflicting reservation must not classify the student.
  const { error: claimError } = await db.rpc('claim_student_enrollment_model', {
    p_student_id: studentId,
    p_requested_model: 'bootcamp',
  });
  if (claimError) throw claimError;

  if (!enrollment.student_id) {
    const { error: activateErr } = await db
      .from('bootcamp_enrollments')
      .update({ student_id: studentId, updated_at: new Date().toISOString() })
      .eq('id', enrollment.id);
    if (activateErr) throw activateErr;
  }

  const { data: settings } = await db
    .from('cohort_payment_settings')
    .select('installment_count, post_bootcamp_access_months')
    .eq('cohort_id', cohortId)
    .maybeSingle();

  // Activation is retryable. Linking student_id may have succeeded before a later
  // database call failed, so resume from existing installments instead of treating the
  // admission as missing or inserting a duplicate schedule.
  const { data: existingInstallments, error: existingInstallmentsError } = await db
    .from('payment_installments')
    .select('id, amount_paid')
    .eq('enrollment_id', enrollment.id);
  if (existingInstallmentsError) throw existingInstallmentsError;

  let installmentRows = existingInstallments ?? [];
  if (installmentRows.length === 0) {
    const installments = generateInstallments(
      enrollment.id,
      Number(enrollment.total_fee),
      Number(enrollment.amount_paid_initial),
      settings?.installment_count ?? 3,
      enrollment.bootcamp_starts_at ? new Date(enrollment.bootcamp_starts_at) : null,
    );
    if (installments.length > 0) {
      const { data: inserted, error: instErr } = await db
        .from('payment_installments')
        .insert(installments)
        .select('id, amount_paid');
      if (instErr) throw instErr;
      installmentRows = inserted ?? [];
    }
  }

  const initialAmount = Number(enrollment.amount_paid_initial);
  const alreadyApplied = installmentRows.reduce(
    (sum: number, row: { amount_paid?: number | string | null }) => sum + Number(row.amount_paid ?? 0),
    0,
  );
  const initialAmountRemaining = Math.max(0, initialAmount - alreadyApplied);
  if (initialAmountRemaining > 0) {
    await applyAmountToInstallments(db, enrollment.id, initialAmountRemaining);
  }

  await recomputeEnrollmentAccess(db, enrollment.id, settings?.post_bootcamp_access_months ?? 3);
}

// ---
// recordPayment
// Inserts a payment, applies it to installments oldest-first,
// updates paid_total, recomputes access_status + access_until.
// ---

export async function recordPayment(db: SupabaseClient, input: RecordPaymentInput): Promise<void> {
  const { error: payErr } = await db.from('payments').insert({
    enrollment_id:   input.enrollmentId,
    student_id:      input.studentId ?? null,
    payer_email:     input.payerEmail,
    cohort_id:       input.cohortId,
    amount:          input.amount,
    paid_at:         input.paidAt ?? new Date().toISOString().slice(0, 10),
    method:          input.method ?? null,
    reference:       input.reference ?? null,
    notes:           input.notes ?? null,
    confirmation_id: input.confirmationId ?? null,
  });
  if (payErr) throw payErr;

  const { data: installments, error: instErr } = await db
    .from('payment_installments')
    .select('id, due_date, amount_due, amount_paid, status')
    .eq('enrollment_id', input.enrollmentId)
    .in('status', ['unpaid', 'partial'])
    .order('due_date', { ascending: true });
  if (instErr) throw instErr;

  let remaining = input.amount;
  for (const inst of installments ?? []) {
    if (remaining <= 0) break;
    const owed = Number(inst.amount_due) - Number(inst.amount_paid);
    const applying = Math.min(remaining, owed);
    const newPaid = Number(inst.amount_paid) + applying;
    const newStatus = newPaid >= Number(inst.amount_due) ? 'paid' : 'partial';
    const { error: updErr } = await db
      .from('payment_installments')
      .update({ amount_paid: newPaid, status: newStatus, updated_at: new Date().toISOString() })
      .eq('id', inst.id);
    if (updErr) throw updErr;
    remaining -= applying;
  }

  const { data: enroll, error: enErr } = await db
    .from('bootcamp_enrollments')
    .select('paid_total, cohort_id, currency')
    .eq('id', input.enrollmentId)
    .single();
  if (enErr || !enroll) throw enErr ?? new Error('Enrollment not found');

  const { data: settings } = await db
    .from('cohort_payment_settings')
    .select('post_bootcamp_access_months')
    .eq('cohort_id', enroll.cohort_id)
    .maybeSingle();

  const newPaidTotal = Number(enroll.paid_total) + input.amount;

  // Write paid_total first so recomputeEnrollmentAccess reads the correct value
  const { error: enrollUpdErr } = await db
    .from('bootcamp_enrollments')
    .update({ paid_total: newPaidTotal, updated_at: new Date().toISOString() })
    .eq('id', input.enrollmentId);
  if (enrollUpdErr) throw enrollUpdErr;

  // Recompute access_status, access_until, and sync cohort membership
  await recomputeEnrollmentAccess(db, input.enrollmentId, settings?.post_bootcamp_access_months ?? 3);

  // Fire-and-forget payment receipt to student
  if (process.env.RESEND_API_KEY) {
    ;(async () => {
      try {
        let studentName = 'there';
        if (input.studentId) {
          const { data: s } = await db.from('students').select('full_name').eq('id', input.studentId).maybeSingle();
          if (s?.full_name) studentName = s.full_name;
        }
        const t = await getTenantSettings();
        const FROM = process.env.RESEND_FROM_EMAIL || `${t.senderName} <${t.supportEmail}>`;
        const dashboardUrl = t.appUrl || process.env.APP_URL || '';
        const branding = { logoUrl: t.logoUrl, emailBannerUrl: t.emailBannerUrl, teamName: t.teamName, appName: t.appName, appUrl: t.appUrl };

        // Resend reports API failures by resolving with { error }, not by throwing.
        const { error: sendErr } = await resend.emails.send({
          from:    FROM,
          to:      input.payerEmail,
          subject: 'Payment received on your account',
          html:    paymentReceiptEmail({
            name:      studentName,
            amount:    input.amount,
            currency:  enroll.currency ?? 'GHS',
            paidAt:    input.paidAt ?? new Date().toISOString().slice(0, 10),
            method:    input.method ?? null,
            reference: input.reference ?? null,
            dashboardUrl,
            branding,
          }),
        });
        if (sendErr) console.error('[db-payments] payment receipt email failed', sendErr);
      } catch { /* non-blocking */ }
    })();
  }
}

// ---
// generateInstallments
// ---

export function generateInstallments(
  enrollmentId: string,
  totalFee: number,
  amountPaidInitial: number,
  installmentCount: number,
  bootcampStartsAt: Date | null,
): { enrollment_id: string; due_date: string; amount_due: number; amount_paid: number; status: string }[] {
  const rows = [];
  if (!bootcampStartsAt) throw new Error('Cohort start date must be set before installments can be generated. Update the cohort start date in Payment Settings.');

  const today = new Date().toISOString().slice(0, 10);

  rows.push({
    enrollment_id: enrollmentId,
    due_date:      today,
    amount_due:    amountPaidInitial,
    amount_paid:   0,
    status:        'unpaid',
  });

  if (installmentCount <= 1 || amountPaidInitial >= totalFee) return rows;

  const remainder = totalFee - amountPaidInitial;
  const count = installmentCount - 1;
  const perInstallment = Math.round((remainder / count) * 100) / 100;
  const base = bootcampStartsAt;

  for (let i = 1; i <= count; i++) {
    const d = new Date(base);
    d.setMonth(d.getMonth() + i);
    rows.push({
      enrollment_id: enrollmentId,
      due_date:      d.toISOString().slice(0, 10),
      amount_due:    i === count ? Math.round((remainder - perInstallment * (count - 1)) * 100) / 100 : perInstallment,
      amount_paid:   0,
      status:        'unpaid',
    });
  }

  return rows;
}

// ---
// markOutstanding
// ---

export async function markOutstanding(
  db: SupabaseClient,
  studentId: string,
  outstandingCohortId: string,
): Promise<{ alreadyMoved: boolean }> {
  const { data: student, error } = await db
    .from('students')
    .select('cohort_id, original_cohort_id')
    .eq('id', studentId)
    .single();
  if (error || !student) throw error ?? new Error('Student not found');
  if (student.cohort_id === outstandingCohortId) return { alreadyMoved: true };

  const { error: moveErr } = await db
    .from('students')
    .update({
      original_cohort_id: student.cohort_id,
      cohort_id:          outstandingCohortId,
    })
    .eq('id', studentId);
  if (moveErr) throw moveErr;

  return { alreadyMoved: false };
}

// ---
// restoreAccess
// ---

export async function restoreAccess(db: SupabaseClient, studentId: string): Promise<void> {
  const { data: student, error } = await db
    .from('students')
    .select('original_cohort_id')
    .eq('id', studentId)
    .single();
  if (error || !student) throw error ?? new Error('Student not found');
  if (!student.original_cohort_id) throw new Error('No original cohort saved for this student');

  const { error: restoreErr } = await db
    .from('students')
    .update({
      cohort_id:          student.original_cohort_id,
      original_cohort_id: null,
      payment_exempt:     true,
    })
    .eq('id', studentId);
  if (restoreErr) throw restoreErr;
}

// ---
// getPaymentHistory
// Returns all payment records for a single enrollment, newest first.
// ---

export async function getPaymentHistory(
  db: SupabaseClient,
  enrollmentId: string,
): Promise<{ id: string; amount: number; paid_at: string; method: string | null; reference: string | null; notes: string | null; created_at: string }[]> {
  const { data, error } = await db
    .from('payments')
    .select('id, amount, paid_at, method, reference, notes, created_at')
    .eq('enrollment_id', enrollmentId)
    .order('paid_at', { ascending: false });
  if (error) throw error;
  return data ?? [];
}

// ---
// editPayment
// Updates a payment record then recomputes paid_total + access.
// ---

export async function editPayment(
  db: SupabaseClient,
  paymentId: string,
  updates: { amount?: number; paid_at?: string; method?: string | null; reference?: string | null; notes?: string | null },
): Promise<void> {
  const { data: existing, error: fetchErr } = await db
    .from('payments')
    .select('enrollment_id')
    .eq('id', paymentId)
    .single();
  if (fetchErr || !existing) throw fetchErr ?? new Error('Payment not found');

  const { error: updErr } = await db
    .from('payments')
    .update(updates)
    .eq('id', paymentId);
  if (updErr) throw updErr;

  await reapplyAllPayments(db, existing.enrollment_id);
}

// ---
// deletePayment
// Deletes a payment record then recomputes paid_total + access.
// ---

export async function deletePayment(
  db: SupabaseClient,
  paymentId: string,
): Promise<void> {
  const { data: existing, error: fetchErr } = await db
    .from('payments')
    .select('enrollment_id')
    .eq('id', paymentId)
    .single();
  if (fetchErr || !existing) throw fetchErr ?? new Error('Payment not found');

  const { error: delErr } = await db.from('payments').delete().eq('id', paymentId);
  if (delErr) throw delErr;

  await reapplyAllPayments(db, existing.enrollment_id);
}

// ---
// Internal helpers
// ---

// Resets all installments to unpaid, then re-applies every payment in
// paid_at order so paid_total and installment statuses are always consistent.
async function reapplyAllPayments(db: SupabaseClient, enrollmentId: string): Promise<void> {
  const { data: settings_enrollment, error: enErr } = await db
    .from('bootcamp_enrollments')
    .select('cohort_id')
    .eq('id', enrollmentId)
    .single();
  if (enErr || !settings_enrollment) throw enErr ?? new Error('Enrollment not found');

  const { data: settings } = await db
    .from('cohort_payment_settings')
    .select('post_bootcamp_access_months')
    .eq('cohort_id', settings_enrollment.cohort_id)
    .maybeSingle();

  // Reset all installments
  const { error: resetErr } = await db
    .from('payment_installments')
    .update({ amount_paid: 0, status: 'unpaid', updated_at: new Date().toISOString() })
    .eq('enrollment_id', enrollmentId);
  if (resetErr) throw resetErr;

  // Fetch all remaining payments in chronological order
  const { data: allPayments, error: payErr } = await db
    .from('payments')
    .select('amount')
    .eq('enrollment_id', enrollmentId)
    .order('paid_at', { ascending: true });
  if (payErr) throw payErr;

  const newPaidTotal = (allPayments ?? []).reduce((sum, p) => sum + Number(p.amount), 0);

  // Re-apply each payment to installments in order
  for (const p of allPayments ?? []) {
    await applyAmountToInstallments(db, enrollmentId, Number(p.amount));
  }

  // Update paid_total on enrollment
  const { error: totErr } = await db
    .from('bootcamp_enrollments')
    .update({ paid_total: newPaidTotal, updated_at: new Date().toISOString() })
    .eq('id', enrollmentId);
  if (totErr) throw totErr;

  await recomputeEnrollmentAccess(db, enrollmentId, settings?.post_bootcamp_access_months ?? 3);
}

async function applyAmountToInstallments(
  db: SupabaseClient,
  enrollmentId: string,
  amount: number,
): Promise<void> {
  const { data: installments, error } = await db
    .from('payment_installments')
    .select('id, amount_due, amount_paid')
    .eq('enrollment_id', enrollmentId)
    .order('due_date', { ascending: true });
  if (error) throw error;

  let remaining = amount;
  for (const inst of installments ?? []) {
    if (remaining <= 0) break;
    const owed = Number(inst.amount_due) - Number(inst.amount_paid);
    if (owed <= 0) continue;
    const applying = Math.min(remaining, owed);
    const newPaid = Number(inst.amount_paid) + applying;
    const { error: updErr } = await db
      .from('payment_installments')
      .update({
        amount_paid: newPaid,
        status: newPaid >= Number(inst.amount_due) ? 'paid' : 'partial',
        updated_at: new Date().toISOString(),
      })
      .eq('id', inst.id);
    if (updErr) throw updErr;
    remaining -= applying;
  }
}

export async function recomputeEnrollmentAccessPublic(
  db: SupabaseClient,
  enrollmentId: string,
  postBootcampAccessMonths = 3,
): Promise<void> {
  return recomputeEnrollmentAccess(db, enrollmentId, postBootcampAccessMonths);
}

async function recomputeEnrollmentAccess(
  db: SupabaseClient,
  enrollmentId: string,
  postBootcampAccessMonths = 3,
): Promise<void> {
  const { data: enroll, error } = await db
    .from('bootcamp_enrollments')
    .select('total_fee, deposit_required, paid_total, payment_plan, bootcamp_ends_at, student_id, cohort_id, released_at')
    .eq('id', enrollmentId)
    .single();
  if (error || !enroll) throw error ?? new Error('Enrollment not found');

  const [installmentsRes, cohortSettingsRes] = await Promise.all([
    db.from('payment_installments').select('due_date, status').eq('enrollment_id', enrollmentId),
    db.from('cohort_payment_settings').select('grace_period_days').eq('cohort_id', enroll.cohort_id).maybeSingle(),
  ]);
  if (installmentsRes.error) throw installmentsRes.error;

  const access = computeAccess({
    payment_plan: enroll.payment_plan as any,
    total_fee: Number(enroll.total_fee),
    deposit_required: Number(enroll.deposit_required),
    paid_total: Number(enroll.paid_total),
    bootcamp_ends_at: enroll.bootcamp_ends_at ? new Date(enroll.bootcamp_ends_at) : null,
    post_bootcamp_access_months: postBootcampAccessMonths,
    grace_period_days: cohortSettingsRes.data?.grace_period_days ?? null,
    installments: (installmentsRes.data ?? []).map((i: any) => ({ due_date: new Date(i.due_date), status: i.status })),
  });

  const { error: accessUpdErr } = await db
    .from('bootcamp_enrollments')
    .update({
      access_status: access.access_status,
      access_until: access.access_until ? access.access_until.toISOString().slice(0, 10) : null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', enrollmentId);
  if (accessUpdErr) throw accessUpdErr;

  // A released enrollment (migration 171) keeps student_id so its payment history stays
  // attached, but the student has left the cohort. Outstanding-cohort enforcement must
  // not act on it: students.cohort_id is NULL after release, so the move would write an
  // empty fromCohortId, and re-attaching a removed student to the outstanding cohort is
  // wrong regardless.
  if (enroll.student_id && !enroll.released_at) {
    const [psResult, studentResult] = await Promise.all([
      db.from('payment_config').select('outstanding_cohort_id').eq('id', 'default').maybeSingle(),
      db.from('students').select('cohort_id, original_cohort_id, payment_exempt, email, full_name').eq('id', enroll.student_id).maybeSingle(),
    ]);

    const action = getOutstandingCohortAction({
      studentId:               enroll.student_id,
      accessStatus:            access.access_status,
      studentCohortId:         studentResult.data?.cohort_id ?? '',
      studentOriginalCohortId: studentResult.data?.original_cohort_id ?? null,
      paymentExempt:           studentResult.data?.payment_exempt ?? false,
      outstandingCohortId:     psResult.data?.outstanding_cohort_id ?? null,
    });

    if (action) await applyCohortAction(db, action).catch(() => {});

    // Fire-and-forget overdue notification. Claimed per overdue episode by the same helper the
    // daily sweep uses, so the two paths cannot both mail one debt: whichever reaches it first
    // takes the claim and the other stands down. access_until is the due date of the installment
    // that caused the overdue status, which is what identifies the episode.
    const episodeDueDate = access.access_until ? access.access_until.toISOString().slice(0, 10) : null;
    if (access.access_status === 'overdue' && episodeDueDate && studentResult.data?.email) {
      const studentEmail = (studentResult.data.email as string).trim().toLowerCase();
      const studentName  = (studentResult.data.full_name as string | null) || 'there';
      ;(async () => {
        try {
          const settings = await loadOverdueNoticeSettings();
          await sendOverdueNotice(db, {
            enrollmentId,
            studentName,
            email:   studentEmail,
            dueDate: episodeDueDate,
          }, settings);
        } catch { /* non-blocking */ }
      })();
    }
  }
}
