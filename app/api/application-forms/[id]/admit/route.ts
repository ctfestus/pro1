import { NextRequest, NextResponse } from 'next/server';
import { requireRole, isAuthError } from '@/lib/api-auth';
import { adminClient } from '@/lib/admin-client';
import { markExistingAccountAdmitted } from '@/lib/account-state-server';
import { admissionAppUrl, admitStudents, sendCohortAccessEmails, type CohortAccessAccount } from '@/lib/admit-students';
import { assignStudentToCohort } from '@/lib/assign-student-cohort';
import { newApplicationId } from '@/lib/application-access';
import { getApplicationForm } from '@/lib/application-form-store';
import type { ApplicationFormRecord, ApplicationSubmissionRecord } from '@/lib/application-forms';
import { appendApplicationAudit, listApplicationFormIdsForReviewer, listApplicationSubmissions } from '@/lib/application-submissions';

// Admitting accepted applicants into the form's cohort. New admissions go through the same
// admitStudents pipeline as the admin admissions screen and the intake webhook (account,
// cohort enrollment with the cohort's fees, setup or added-to-cohort email); accounts that
// already have an enrollment go through the Cohorts screen's assign flow, so the paths
// cannot drift. A "check" call first sorts the applicants so nobody is moved between
// cohorts, or given a student enrollment on a staff account, without the admitter seeing it.

export const dynamic = 'force-dynamic';

const MAX_PER_REQUEST = 100;

type CohortReadiness = { id: string; name: string; ready: boolean; problem?: string };

/**
 * new          no account yet: one is created and emailed a set-password link
 * no_cohort    an account without a cohort (or not yet enrolled here): added to this cohort
 * other_cohort an account in another cohort: moved only when the admitter chooses to
 * this_cohort  already admitted here: nothing changes
 * staff        a staff, instructor, or admin account: never admitted as a student
 */
type AdmissionGroup = 'new' | 'no_cohort' | 'other_cohort' | 'this_cohort' | 'staff';

type ClassifiedApplicant = {
  submission: ApplicationSubmissionRecord;
  name: string | null;
  group: AdmissionGroup;
  currentCohortName?: string;
  /** Set for existing student accounts. */
  account?: { studentId: string; passwordSetAt: string | null; hasEnrollment: boolean };
};

async function cohortReadiness(cohortId: string): Promise<CohortReadiness | null> {
  const db = adminClient();
  const [{ data: cohort }, { data: settings }] = await Promise.all([
    db.from('cohorts').select('id, name, start_date, status, cohort_kind').eq('id', cohortId).maybeSingle(),
    db.from('cohort_payment_settings').select('total_fee').eq('cohort_id', cohortId).maybeSingle(),
  ]);
  if (!cohort || cohort.cohort_kind !== 'bootcamp') return null;
  // admitStudents refuses rows without a fee and cohorts without a start date; say so up front.
  const problem = cohort.status !== 'active' ? 'This cohort is no longer active. Choose an active cohort in the Review flow settings.'
    : !cohort.start_date ? 'Set a start date for this cohort before admitting applicants.'
      : !(Number(settings?.total_fee) > 0) ? 'Set the fee for this cohort before admitting applicants.'
        : undefined;
  return { id: cohort.id, name: cohort.name, ready: !problem, ...(problem ? { problem } : {}) };
}

/**
 * Emails with a live admission in the cohort: linked to a student account and not released.
 * An admission record alone is not enough, because admitStudents writes it before the account
 * step, which can still fail. Read from the cohort side so the list stays small.
 */
async function admittedEmails(cohortId: string, emails?: string[]): Promise<Set<string>> {
  const found = new Set<string>();
  for (let offset = 0; ; offset += 1000) {
    let query = adminClient().from('bootcamp_enrollments').select('email')
      .eq('cohort_id', cohortId).not('student_id', 'is', null).is('released_at', null);
    if (emails) query = query.in('email', emails);
    const { data, error } = await query.order('id').range(offset, offset + 999);
    if (error) throw new Error(`Could not check admissions: ${error.message}`);
    for (const row of data ?? []) found.add(String(row.email).toLowerCase());
    if ((data ?? []).length < 1000) return found;
  }
}

function applicantName(form: ApplicationFormRecord, submission: ApplicationSubmissionRecord): string | null {
  // Only the question the form names; "No name question" means no name.
  const questionId = form.config.admission?.nameQuestionId;
  const value = questionId ? submission.answers[questionId] : null;
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, 200) : null;
}

async function classify(form: ApplicationFormRecord, cohortId: string, submissions: ApplicationSubmissionRecord[]): Promise<ClassifiedApplicant[]> {
  const emails = [...new Set(submissions.map(item => item.email.toLowerCase()))];
  const db = adminClient();
  const [{ data: students, error }, admitted] = await Promise.all([
    db.from('students').select('id, email, role, cohort_id, password_set_at').in('email', emails),
    admittedEmails(cohortId, emails),
  ]);
  if (error) throw new Error(`Could not check applicant accounts: ${error.message}`);
  const byEmail = new Map((students ?? []).map((row: any) => [String(row.email).toLowerCase(), row]));

  // Each account's latest enrollment, the same row the Cohorts screen's assign flow moves.
  const studentIds = (students ?? []).filter((row: any) => row.role === 'student').map((row: any) => row.id as string);
  const { data: enrollments, error: enrollmentError } = studentIds.length
    ? await db.from('bootcamp_enrollments').select('student_id, cohort_id, released_at, created_at').in('student_id', studentIds).order('created_at', { ascending: false })
    : { data: [] as any[], error: null };
  if (enrollmentError) throw new Error(`Could not check applicant enrollments: ${enrollmentError.message}`);
  const latestEnrollment = new Map<string, { cohort_id: string; released_at: string | null }>();
  for (const row of enrollments ?? []) if (!latestEnrollment.has(row.student_id)) latestEnrollment.set(row.student_id, row);

  // Where each account is now: its cohort pointer, or else a live enrollment elsewhere.
  const currentCohort = (student: any) => {
    const enrollment = latestEnrollment.get(student.id);
    return (student.cohort_id as string | null) || (enrollment && !enrollment.released_at ? enrollment.cohort_id : null);
  };
  const otherCohortIds = [...new Set((students ?? []).map(currentCohort).filter((value): value is string => Boolean(value) && value !== cohortId))];
  const { data: cohorts } = otherCohortIds.length
    ? await db.from('cohorts').select('id, name').in('id', otherCohortIds)
    : { data: [] as { id: string; name: string }[] };
  const cohortNames = new Map((cohorts ?? []).map((row: any) => [row.id as string, row.name as string]));

  return submissions.map(submission => {
    const email = submission.email.toLowerCase();
    const student = byEmail.get(email);
    const base = { submission, name: applicantName(form, submission) };
    if (!student) return { ...base, group: 'new' as const };
    if (student.role !== 'student') return { ...base, group: 'staff' as const };
    const account = {
      studentId: student.id as string,
      passwordSetAt: (student.password_set_at as string | null) ?? null,
      hasEnrollment: latestEnrollment.has(student.id),
    };
    const current = currentCohort(student);
    if (current === cohortId && admitted.has(email)) return { ...base, account, group: 'this_cohort' as const };
    if (!current || current === cohortId) return { ...base, account, group: 'no_cohort' as const };
    return { ...base, account, group: 'other_cohort' as const, currentCohortName: cohortNames.get(current) ?? 'another cohort' };
  });
}

/**
 * Put existing student accounts that already have an enrollment somewhere through the Cohorts
 * screen's assign flow: their one enrollment row is moved here (a released row is reattached),
 * so they never get a second full-fee schedule. Returns the emails admitted and any failures.
 */
async function assignExistingAccounts(cohortId: string, applicants: ClassifiedApplicant[]) {
  const db = adminClient();
  const admitted: CohortAccessAccount[] = [];
  const admittedEmails: string[] = [];
  const errors: { email: string; error: string }[] = [];
  for (const applicant of applicants) {
    const email = applicant.submission.email.toLowerCase();
    const account = applicant.account!;
    try {
      await assignStudentToCohort(db, { studentId: account.studentId, email, cohortId });
      admittedEmails.push(email);
    } catch (error: any) {
      errors.push({ email, error: error?.message || 'This applicant could not be admitted.' });
      continue;
    }

    const { error: cleanupError } = await db.from('cohort_allowed_emails').delete().eq('email', email);
    if (cleanupError) {
      errors.push({ email, error: `Admitted to the cohort, but the old allowlist entry could not be removed: ${cleanupError.message}` });
    }

    try {
      // This transition is idempotent. Retry once so a transient auth-service failure does not
      // strand an otherwise successful cohort assignment without account access.
      try {
        await markExistingAccountAdmitted(db, account.studentId);
      } catch {
        await markExistingAccountAdmitted(db, account.studentId);
      }
      admitted.push({ email, name: applicant.name || 'there', studentId: account.studentId, isNewAccount: false, passwordSetAt: account.passwordSetAt });
    } catch (error: any) {
      errors.push({ email, error: `Admitted to the cohort, but account access could not be activated: ${error?.message || 'unknown error'}` });
    }
  }
  return { admitted, admittedEmails, errors };
}

export async function GET(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const auth = await requireRole(req, ['admin', 'instructor', 'staff']);
  if (isAuthError(auth)) return auth.error;
  const { id } = await context.params;
  try {
    const form = await getApplicationForm(id);
    if (!form) return NextResponse.json({ error: 'Application form not found.' }, { status: 404 });
    if (auth.role === 'instructor' && form.ownerId !== auth.actor.id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    if (auth.role === 'staff' && !(await listApplicationFormIdsForReviewer(auth.actor.id)).includes(form.id)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    const cohortId = form.config.admission?.cohortId;
    if (!cohortId) return NextResponse.json({ cohort: null, admittedSubmissionIds: [], canAdmit: false });
    const [cohort, submissions, admitted] = await Promise.all([
      cohortReadiness(cohortId),
      listApplicationSubmissions(form.id),
      admittedEmails(cohortId),
    ]);
    return NextResponse.json({
      cohort,
      admittedSubmissionIds: submissions.filter(item => admitted.has(item.email.toLowerCase())).map(item => item.id),
      canAdmit: auth.role === 'admin' || form.ownerId === auth.actor.id,
    });
  } catch (error) {
    console.error('[application-forms/id/admit/get]', error);
    return NextResponse.json({ error: (error as Error).message || 'Could not load admissions.' }, { status: 503 });
  }
}

/**
 * Body { submissionIds, check: true }: how each applicant would be handled, changing nothing.
 * Body { submissionIds, moveFromOtherCohorts? }: admits them. Students in another cohort are
 * moved only when moveFromOtherCohorts is true, and skipped otherwise.
 */
export async function POST(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const auth = await requireRole(req, ['admin', 'instructor']);
  if (isAuthError(auth)) return auth.error;
  const { id } = await context.params;
  const body = await req.json().catch(() => null) as null | { submissionIds?: unknown; check?: unknown; moveFromOtherCohorts?: unknown };
  const submissionIds = Array.isArray(body?.submissionIds) ? [...new Set(body!.submissionIds.filter((value): value is string => typeof value === 'string'))] : [];
  if (!submissionIds.length) return NextResponse.json({ error: 'Select at least one application to admit.' }, { status: 400 });
  if (submissionIds.length > MAX_PER_REQUEST) return NextResponse.json({ error: `Admit at most ${MAX_PER_REQUEST} applications at a time.` }, { status: 400 });

  try {
    const form = await getApplicationForm(id);
    if (!form) return NextResponse.json({ error: 'Application form not found.' }, { status: 404 });
    if (auth.role !== 'admin' && form.ownerId !== auth.actor.id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    const cohortId = form.config.admission?.cohortId;
    if (!cohortId) return NextResponse.json({ error: 'Choose a cohort in this form\'s Review flow settings before admitting applicants.' }, { status: 400 });
    const cohort = await cohortReadiness(cohortId);
    if (!cohort) return NextResponse.json({ error: 'The admission cohort no longer exists. Choose another in the Review flow settings.' }, { status: 400 });
    if (!cohort.ready) return NextResponse.json({ error: cohort.problem }, { status: 400 });

    const wanted = new Set(submissionIds);
    const targets = (await listApplicationSubmissions(form.id)).filter(item => wanted.has(item.id) && item.state === 'submitted');
    if (!targets.length) return NextResponse.json({ error: 'None of the selected applications can be admitted.' }, { status: 400 });
    const classified = await classify(form, cohortId, targets);

    if (body?.check === true) {
      return NextResponse.json({
        cohort: { id: cohort.id, name: cohort.name },
        applicants: classified.map(item => ({
          submissionId: item.submission.id, email: item.submission.email, name: item.name, group: item.group,
          ...(item.currentCohortName ? { currentCohortName: item.currentCohortName } : {}),
        })),
      });
    }

    const move = body?.moveFromOtherCohorts === true;
    const toAdmit = classified.filter(item => item.group === 'new' || item.group === 'no_cohort' || (item.group === 'other_cohort' && move));
    // Accounts with an enrollment anywhere keep that row (moved or reattached); the rest get a
    // fresh admission from the shared pipeline.
    const toAssign = toAdmit.filter(item => item.account?.hasEnrollment);
    const toCreate = toAdmit.filter(item => !item.account?.hasEnrollment);

    const appUrl = await admissionAppUrl();
    if (!appUrl) return NextResponse.json({ error: 'APP_URL or platform App URL must be configured before creating student accounts.' }, { status: 500 });

    const created = toCreate.length
      ? await admitStudents(adminClient(), cohortId, toCreate.map(item => ({ email: item.submission.email, full_name: item.name })))
      : { admittedEmails: [] as string[], errors: [] as { email: string; error: string }[] };
    if ('error' in created) return NextResponse.json({ error: created.error }, { status: created.status });
    const assigned = await assignExistingAccounts(cohortId, toAssign);
    const emailed = await sendCohortAccessEmails(adminClient(), { cohortId, appUrl, accounts: assigned.admitted });

    const admittedSet = new Set([...created.admittedEmails, ...assigned.admittedEmails].map(email => email.toLowerCase()));
    const problems = new Map([...created.errors, ...assigned.errors, ...emailed.errors].map(item => [item.email.toLowerCase(), item.error]));
    const results = classified.map(item => {
      const email = item.submission.email;
      const base = { submissionId: item.submission.id, email };
      if (item.group === 'staff') return { ...base, status: 'failed' as const, message: 'This email belongs to a staff or admin account, so it cannot be admitted as a student.' };
      if (item.group === 'this_cohort') return { ...base, status: 'skipped' as const, message: 'Already in this cohort.' };
      if (item.group === 'other_cohort' && !move) return { ...base, status: 'skipped' as const, message: `Kept in ${item.currentCohortName}.` };
      const problem = problems.get(email.toLowerCase());
      // An email problem after a successful admission is reported, but the admission stands.
      return admittedSet.has(email.toLowerCase())
        ? { ...base, status: 'admitted' as const, ...(problem ? { message: problem } : {}) }
        : { ...base, status: 'failed' as const, message: problem ?? 'This applicant could not be admitted.' };
    });

    const now = new Date().toISOString();
    await Promise.all(results.filter(item => item.status === 'admitted').map(item => appendApplicationAudit({
      id: newApplicationId('audit'), entityType: 'submission', entityId: item.submissionId, action: 'admitted',
      actorId: auth.actor.id, actorEmail: auth.actor.email ?? '', occurredAt: now,
      details: { formId: form.id, cohortId, cohortName: cohort.name },
    }).catch(error => console.error('[application-forms/id/admit/audit]', error))));

    return NextResponse.json({ cohort: { id: cohort.id, name: cohort.name }, results });
  } catch (error) {
    console.error('[application-forms/id/admit/post]', error);
    return NextResponse.json({ error: (error as Error).message || 'Could not admit these applicants.' }, { status: 503 });
  }
}
