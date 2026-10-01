import { NextRequest, NextResponse } from 'next/server';
import { requireRole, isAuthError } from '@/lib/api-auth';
import { adminClient } from '@/lib/admin-client';
import { admitStudents } from '@/lib/admit-students';
import { newApplicationId } from '@/lib/application-access';
import { getApplicationForm } from '@/lib/application-form-store';
import { suggestedNameQuestionId, type ApplicationFormRecord, type ApplicationSubmissionRecord } from '@/lib/application-forms';
import { appendApplicationAudit, listApplicationFormIdsForReviewer, listApplicationSubmissions } from '@/lib/application-submissions';

// Admitting accepted applicants into the form's cohort. This goes through the same
// admitStudents pipeline as the admin admissions screen and the intake webhook (account,
// cohort enrollment with the cohort's fees, setup email), so the paths cannot drift.

export const dynamic = 'force-dynamic';

const MAX_PER_REQUEST = 100;

type CohortReadiness = { id: string; name: string; ready: boolean; problem?: string };

async function cohortReadiness(cohortId: string): Promise<CohortReadiness | null> {
  const db = adminClient();
  const [{ data: cohort }, { data: settings }] = await Promise.all([
    db.from('cohorts').select('id, name, start_date, status, cohort_kind').eq('id', cohortId).maybeSingle(),
    db.from('cohort_payment_settings').select('total_fee').eq('cohort_id', cohortId).maybeSingle(),
  ]);
  if (!cohort || cohort.cohort_kind !== 'bootcamp') return null;
  // admitStudents refuses rows without a fee and cohorts without a start date; say so up front.
  const problem = cohort.status === 'archived' ? 'This cohort is archived.'
    : !cohort.start_date ? 'Set a start date for this cohort before admitting applicants.'
      : !(Number(settings?.total_fee) > 0) ? 'Set the fee for this cohort before admitting applicants.'
        : undefined;
  return { id: cohort.id, name: cohort.name, ready: !problem, ...(problem ? { problem } : {}) };
}

/** Emails already enrolled in the cohort, read from the cohort side so the list stays small. */
async function enrolledEmails(cohortId: string): Promise<Set<string>> {
  const emails = new Set<string>();
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await adminClient().from('bootcamp_enrollments').select('email')
      .eq('cohort_id', cohortId).order('id').range(offset, offset + 999);
    if (error) throw new Error(`Could not check admissions: ${error.message}`);
    for (const row of data ?? []) emails.add(String(row.email).toLowerCase());
    if ((data ?? []).length < 1000) return emails;
  }
}

function applicantName(form: ApplicationFormRecord, submission: ApplicationSubmissionRecord): string | null {
  const questionId = form.config.admission?.nameQuestionId ?? suggestedNameQuestionId(form.config.questions);
  const value = questionId ? submission.answers[questionId] : null;
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, 200) : null;
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
    const [cohort, submissions, enrolled] = await Promise.all([
      cohortReadiness(cohortId),
      listApplicationSubmissions(form.id),
      enrolledEmails(cohortId),
    ]);
    return NextResponse.json({
      cohort,
      admittedSubmissionIds: submissions.filter(item => enrolled.has(item.email.toLowerCase())).map(item => item.id),
      canAdmit: auth.role === 'admin' || form.ownerId === auth.actor.id,
    });
  } catch (error) {
    console.error('[application-forms/id/admit/get]', error);
    return NextResponse.json({ error: (error as Error).message || 'Could not load admissions.' }, { status: 503 });
  }
}

export async function POST(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const auth = await requireRole(req, ['admin', 'instructor']);
  if (isAuthError(auth)) return auth.error;
  const { id } = await context.params;
  const body = await req.json().catch(() => null) as null | { submissionIds?: unknown };
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

    const outcome = await admitStudents(adminClient(), cohortId, targets.map(item => ({
      email: item.email,
      full_name: applicantName(form, item),
    })));
    if ('error' in outcome) return NextResponse.json({ error: outcome.error }, { status: outcome.status });

    const problems = new Map(outcome.errors.map(item => [item.email.toLowerCase(), item.error]));
    const results = targets.map(item => {
      const problem = problems.get(item.email.toLowerCase());
      // "Account created, but ..." means the admission succeeded and only the email failed.
      const admitted = !problem || problem.startsWith('Account created');
      return { submissionId: item.id, email: item.email, status: admitted ? 'admitted' as const : 'failed' as const, ...(problem ? { message: problem } : {}) };
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
