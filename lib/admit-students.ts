// Shared admission pipeline: turn a list of admission rows (email + name + payment)
// into provisioned student accounts enrolled in a cohort, with their payment recorded
// and a setup/login email sent. This is the single source of truth used by BOTH the
// admin bulk-admit route (app/api/admissions) and the intake webhook
// (app/api/admissions/intake) so the two paths can never drift apart.
//
// Roles come from students.role -- never the profiles table.

import type { SupabaseClient } from '@supabase/supabase-js';
import { randomBytes } from 'crypto';
import { Resend } from 'resend';
import { createAdmissionRecord, activateEnrollment } from '@/lib/db-payments';
import { studentAccountCreatedEmail, studentAddedToCohortEmail } from '@/lib/email-templates';
import { addToResendAudience } from '@/lib/resend-audience';
import { getTenantSettings } from '@/lib/get-tenant-settings';
import { markAdmissionsProvisioned, markExistingAccountAdmitted } from '@/lib/account-state-server';

const resend = new Resend(process.env.RESEND_API_KEY);

export interface AdmitRow {
  email: string;
  full_name?: string | null;
  total_fee?: number | string | null;
  payment_plan?: 'full' | 'flexible' | 'sponsored' | 'waived' | null;
  amount_paid?: number | string | null;
  paid_at?: string | null;
  payment_method?: string | null;
  payment_reference?: string | null;
  notes?: string | null;
}

export interface AdmitResult {
  inserted: number;
  updated: number;
  provisioned: number;
  setupEmailsSent: number;
  /** Emails whose admission (account + enrollment) succeeded, even if their email then failed. */
  admittedEmails: string[];
  errors: { email: string; error: string }[];
}

function makeTemporaryPassword() {
  return `${randomBytes(32).toString('base64url')}Aa1!`;
}

function passwordSetupUrl(appUrl: string, tokenHash: string) {
  return `${appUrl}/auth/confirm?token_hash=${encodeURIComponent(tokenHash)}&type=recovery`;
}

async function provisionStudentAccount(
  db: SupabaseClient,
  input: { email: string; fullName?: string | null; cohortId: string; enrollmentId: string },
) {
  const { email, cohortId, enrollmentId } = input;
  const fullName = input.fullName?.trim() || null;

  const { data: existingStudent, error: existingStudentError } = await db
    .from('students')
    .select('id, role, full_name, account_provisioned_at, password_set_at')
    .eq('email', email)
    .maybeSingle();
  if (existingStudentError) throw existingStudentError;
  // Staff accounts are learners with grading access (they sign in to /student), so they can be
  // admitted here; admin and instructor accounts cannot.
  if (existingStudent && existingStudent.role !== 'student' && existingStudent.role !== 'staff') {
    throw new Error('This email already belongs to an admin or instructor account.');
  }

  let studentId = existingStudent?.id as string | undefined;
  let createdUserId: string | null = null;

  if (!studentId) {
    const now = new Date().toISOString();
    const { data: created, error: createUserError } = await db.auth.admin.createUser({
      email,
      password: makeTemporaryPassword(),
      email_confirm: true,
      user_metadata: fullName ? { full_name: fullName } : {},
    });
    if (createUserError || !created.user) {
      throw createUserError ?? new Error('Could not create student account.');
    }
    studentId = created.user.id;
    createdUserId = created.user.id;

    const { error: profileError } = await db
      .from('students')
      .upsert({
        id:          studentId,
        email,
        full_name:   fullName,
        role:        'student',
        cohort_id:   cohortId,
        account_provisioned_at: now,
        updated_at:  now,
      }, { onConflict: 'id' });
    if (profileError) throw profileError;

  } else {
    const profilePatch: any = { cohort_id: cohortId, updated_at: new Date().toISOString() };
    if (fullName && !existingStudent?.full_name) profilePatch.full_name = fullName;
    if (!existingStudent?.account_provisioned_at) profilePatch.account_provisioned_at = new Date().toISOString();
    const { error: profileError } = await db.from('students').update(profilePatch).eq('id', studentId);
    if (profileError) throw profileError;

  }

  try {
    const { data: enrollment, error: enrollmentError } = await db
      .from('bootcamp_enrollments')
      .select('student_id')
      .eq('id', enrollmentId)
      .single();
    if (enrollmentError) throw enrollmentError;

    if (!enrollment.student_id) {
      await activateEnrollment(db, email, cohortId, studentId);
    } else if (enrollment.student_id !== studentId) {
      throw new Error('This admission record is already linked to a different student account.');
    }

    // Clean up any stale allowlist entry from the old signup-based flow.
    await db.from('cohort_allowed_emails').delete().eq('email', email);

    // Release access only after enrollment is valid. Doing this before activation made
    // a failed admission report an error while leaving a pending/denied account active.
    // New accounts owe a password; established accounts retain their existing password
    // state and merely have an old pending/denied block lifted.
    if (createdUserId) await markAdmissionsProvisioned(db, studentId);
    else await markExistingAccountAdmitted(db, studentId);
  } catch (err) {
    if (createdUserId) await db.auth.admin.deleteUser(createdUserId).catch(() => {});
    throw err;
  }

  return {
    studentId,
    isNewAccount: Boolean(createdUserId),
    passwordSetAt: (existingStudent?.password_set_at as string | null | undefined) ?? null,
  };
}

async function assertAdmissibleAccountRole(db: SupabaseClient, email: string): Promise<void> {
  const { data: existingStudent, error } = await db
    .from('students')
    .select('role')
    .eq('email', email)
    .maybeSingle();
  if (error) throw error;
  if (existingStudent && existingStudent.role !== 'student' && existingStudent.role !== 'staff') {
    throw new Error('This email already belongs to an admin or instructor account.');
  }
}

/** Base URL for links in admission emails; empty when neither APP_URL nor the tenant sets one. */
export async function admissionAppUrl(): Promise<string> {
  const t = await getTenantSettings();
  return (process.env.APP_URL || t.appUrl || '').replace(/\/$/, '');
}

export interface CohortAccessAccount {
  email: string;
  /** Greeting name; 'there' when unknown. */
  name: string;
  studentId: string;
  isNewAccount: boolean;
  /** students.password_set_at, when already loaded. */
  passwordSetAt?: string | null;
}

/**
 * Email accounts that were just put into a cohort. Runs after admission has succeeded, so a
 * failure here is reported per account and never undoes the admission.
 *
 * Only an account that cannot sign in yet gets a set-password link. password_set_at was not
 * backfilled for older accounts, so an account that has ever signed in also counts as able to
 * sign in; those students get an added-to-cohort email instead of a reset link.
 */
export async function sendCohortAccessEmails(
  db: SupabaseClient,
  input: { cohortId: string; appUrl: string; accounts: CohortAccessAccount[] },
): Promise<{ sent: number; errors: { email: string; error: string }[] }> {
  const { cohortId, appUrl, accounts } = input;
  const errors: { email: string; error: string }[] = [];
  if (!accounts.length) return { sent: 0, errors };
  if (!process.env.RESEND_API_KEY) {
    return {
      sent: 0,
      errors: accounts.map(account => ({ email: account.email, error: 'Account created, but RESEND_API_KEY is not configured so the setup email was not sent.' })),
    };
  }

  const ready: { account: CohortAccessAccount; setupUrl: string | null }[] = [];
  for (const account of accounts) {
    try {
      let owesPassword = account.isNewAccount;
      if (!owesPassword && !account.passwordSetAt) {
        const { data: authUser } = await db.auth.admin.getUserById(account.studentId);
        owesPassword = !authUser?.user?.last_sign_in_at;
      }
      if (!owesPassword) {
        ready.push({ account, setupUrl: null });
        continue;
      }
      const { data: link, error: linkError } = await db.auth.admin.generateLink({ type: 'recovery', email: account.email });
      if (linkError || !link.properties?.hashed_token) {
        throw linkError ?? new Error('Could not generate first-access link.');
      }
      ready.push({ account, setupUrl: passwordSetupUrl(appUrl, link.properties.hashed_token) });
    } catch (err: any) {
      errors.push({ email: account.email, error: `Admitted, but the setup email could not be prepared: ${err?.message || 'unknown error'}` });
    }
  }
  if (!ready.length) return { sent: 0, errors };

  try {
    const t = await getTenantSettings();
    const { data: cohortRow } = await db.from('cohorts').select('name').eq('id', cohortId).maybeSingle();
    const cohortName = cohortRow?.name ?? 'your cohort';
    const FROM       = process.env.RESEND_FROM_EMAIL || `${t.senderName} <${t.supportEmail}>`;
    const branding   = { appName: t.appName, appUrl, logoUrl: t.logoUrl, emailBannerUrl: t.emailBannerUrl, teamName: t.teamName };

    const { error: sendError } = await resend.batch.send(
      ready.map(({ account, setupUrl }) => setupUrl
        ? {
            from: FROM,
            to: account.email,
            subject: `Your ${t.appName || cohortName} account is ready`,
            html: studentAccountCreatedEmail({
              name: account.name,
              cohortName,
              setupUrl,
              branding,
            }),
          }
        : {
            from: FROM,
            to: account.email,
            subject: `You have been added to ${cohortName}`,
            html: studentAddedToCohortEmail({
              name: account.name,
              cohortName,
              signInUrl: `${appUrl}/student`,
              branding,
            }),
          })
    );
    if (sendError) throw new Error(sendError.message || 'The email provider rejected the request.');
    const setupSent = ready.filter(item => item.setupUrl).map(item => item.account.email);
    if (setupSent.length) {
      await db
        .from('students')
        .update({ setup_email_sent_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .in('email', setupSent);
    }
    return { sent: ready.length, errors };
  } catch (err: any) {
    for (const { account } of ready) {
      errors.push({ email: account.email, error: err?.message || 'Account created, but the setup email could not be sent.' });
    }
    return { sent: 0, errors };
  }
}

/**
 * Provision accounts for a batch of admission rows in a single cohort. Each row that
 * fails is collected into `errors` without aborting the rest. Returns counts plus the
 * error list, mirroring what the admin admissions route returned inline.
 *
 * Returns `{ error, status }` only for whole-batch preconditions (no APP_URL configured).
 */
export async function admitStudents(
  db: SupabaseClient,
  cohortId: string,
  rows: AdmitRow[],
): Promise<AdmitResult | { error: string; status: number }> {
  // Load cohort payment settings for defaults
  const [{ data: settings }, { data: cohort }] = await Promise.all([
    db.from('cohort_payment_settings').select('*').eq('cohort_id', cohortId).maybeSingle(),
    db.from('cohorts').select('start_date, end_date').eq('id', cohortId).maybeSingle(),
  ]);

  let inserted = 0;
  let updated = 0;
  const errors: { email: string; error: string }[] = [];
  const accountEmails: CohortAccessAccount[] = [];
  const appUrl = await admissionAppUrl();
  if (!appUrl) {
    return { error: 'APP_URL or platform App URL must be configured before creating student accounts.', status: 500 };
  }

  for (const row of rows) {
    const email = String(row.email ?? '').trim().toLowerCase();
    if (!email) continue;

    try {
      const total_fee = Number(row.total_fee || settings?.total_fee || 0);
      if (!total_fee || total_fee <= 0) {
        throw new Error('total_fee is required when cohort payment settings are not configured.');
      }
      if (!cohort?.start_date) {
        throw new Error('Cohort start date is required before student accounts can be created.');
      }

      // Reject privileged accounts before creating or updating an enrollment record. The
      // provisioning check remains as a second guard against a role changing mid-request.
      await assertAdmissibleAccountRole(db, email);

      const deposit_percent  = Number(settings?.deposit_percent ?? 50);
      const deposit_required = Math.round(total_fee * deposit_percent) / 100;
      const payment_plan     = row.payment_plan ?? settings?.payment_plan ?? 'flexible';
      const amount_paid      = Number(row.amount_paid ?? 0);
      const currency         = settings?.currency ?? 'GHS';

      // Check if an admission/enrollment record already exists
      const { data: existing } = await db
        .from('bootcamp_enrollments')
        .select('id')
        .eq('email', email)
        .eq('cohort_id', cohortId)
        .maybeSingle();

      const enrollmentId = await createAdmissionRecord(db, {
        email,
        fullName:          row.full_name ?? null,
        cohortId,
        totalFee:          total_fee,
        currency,
        paymentPlan:       payment_plan,
        depositRequired:   deposit_required,
        amountPaidInitial: amount_paid,
        paidAt:            row.paid_at ?? null,
        paymentMethod:     row.payment_method ?? null,
        paymentReference:  row.payment_reference ?? null,
        notes:             row.notes ?? null,
        bootcampStartsAt:  cohort?.start_date ?? null,
        bootcampEndsAt:    cohort?.end_date ?? null,
      });

      if (existing) {
        updated++;
      } else {
        inserted++;
      }

      // Create payment audit record if amount paid and no record exists yet
      if (amount_paid > 0) {
        const { data: enrollment } = await db
          .from('bootcamp_enrollments')
          .select('id')
          .eq('id', enrollmentId)
          .maybeSingle();

        if (enrollment) {
          const { data: existingPayment } = await db
            .from('payments')
            .select('id')
            .eq('enrollment_id', enrollment.id)
            .maybeSingle();

          if (!existingPayment) {
            const { error: paymentErr } = await db.from('payments').insert({
              enrollment_id: enrollment.id,
              payer_email:   email,
              cohort_id:     cohortId,
              amount:        amount_paid,
              paid_at:       row.paid_at ?? new Date().toISOString().slice(0, 10),
              method:        row.payment_method ?? null,
              reference:     row.payment_reference ?? null,
              notes:         row.notes ?? null,
            });
            if (paymentErr) throw paymentErr;
          }
        }
      }

      const provisioned = await provisionStudentAccount(db, {
        email,
        fullName: row.full_name ?? null,
        cohortId,
        enrollmentId,
      });
      accountEmails.push({
        email,
        name: row.full_name || 'there',
        studentId: provisioned.studentId,
        isNewAccount: provisioned.isNewAccount,
        passwordSetAt: provisioned.passwordSetAt,
      });
    } catch (err: any) {
      errors.push({ email, error: err.message ?? 'Unknown error' });
    }
  }

  const emailed = await sendCohortAccessEmails(db, { cohortId, appUrl, accounts: accountEmails });
  errors.push(...emailed.errors);
  const setupEmailsSent = emailed.sent;

  // Add newly provisioned students to the Resend audience. Each call is
  // self-contained and never throws, so a contact failure cannot affect the
  // admission result; the onboarding workflow is a backstop for self-serve signups.
  await Promise.all(
    accountEmails
      .filter(account => account.isNewAccount)
      .map(account => addToResendAudience({
        email: account.email,
        name:  account.name === 'there' ? null : account.name,
      })),
  );

  return { inserted, updated, provisioned: accountEmails.length, setupEmailsSent, admittedEmails: accountEmails.map(account => account.email), errors };
}
